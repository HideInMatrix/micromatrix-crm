import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { AnnouncementVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import type { Announcement } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import type { QueryAnnouncementsDto, SaveAnnouncementDto } from './dto/announcement.dto'

const ANNOUNCEMENT_SOURCE = 'announcement'
const PUBLISH_BATCH_SIZE = 200

interface ReceiverSnapshot {
  departmentIds: string[]
  userIds: string[]
  receiverUserIds: string[]
}

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  async list(tenantId: string, query: QueryAnnouncementsDto) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20
    const keyword = query.keyword?.trim()
    const where = {
      tenantId,
      ...(keyword ? { subject: { contains: keyword, mode: 'insensitive' as const } } : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.announcement.count({ where }),
    ])
    return {
      items: await this.toVOs(tenantId, items),
      total,
      page,
      pageSize,
    }
  }

  async detail(tenantId: string, id: string): Promise<AnnouncementVO> {
    const announcement = await this.findOne(tenantId, id)
    return (await this.toVOs(tenantId, [announcement]))[0]!
  }

  async create(user: AuthUser, dto: SaveAnnouncementDto): Promise<AnnouncementVO> {
    const normalized = this.normalizeInput(dto)
    const receivers = await this.resolveReceivers(
      user.tenantId,
      normalized.departmentIds,
      normalized.userIds,
    )
    const announcement = await this.prisma.announcement.create({
      data: {
        tenantId: user.tenantId,
        subject: normalized.subject,
        content: normalized.content,
        startAt: normalized.startAt,
        endAt: normalized.endAt,
        url: normalized.url,
        linkName: normalized.linkName,
        departmentIds: receivers.departmentIds,
        userIds: receivers.userIds,
        receiverUserIds: receivers.receiverUserIds,
        notice: false,
        createUserId: user.id,
        updateUserId: user.id,
      },
    })
    await this.publishIfDue(announcement, new Date())
    return this.detail(user.tenantId, announcement.id)
  }

  async update(user: AuthUser, id: string, dto: SaveAnnouncementDto): Promise<AnnouncementVO> {
    await this.findOne(user.tenantId, id)
    const normalized = this.normalizeInput(dto)
    const receivers = await this.resolveReceivers(
      user.tenantId,
      normalized.departmentIds,
      normalized.userIds,
    )

    await this.notifications.removeBySource(user.tenantId, ANNOUNCEMENT_SOURCE, id)
    const announcement = await this.prisma.announcement.update({
      where: { id },
      data: {
        subject: normalized.subject,
        content: normalized.content,
        startAt: normalized.startAt,
        endAt: normalized.endAt,
        url: normalized.url,
        linkName: normalized.linkName,
        departmentIds: receivers.departmentIds,
        userIds: receivers.userIds,
        receiverUserIds: receivers.receiverUserIds,
        notice: false,
        updateUserId: user.id,
      },
    })
    await this.publishIfDue(announcement, new Date())
    return this.detail(user.tenantId, id)
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    await this.notifications.removeBySource(tenantId, ANNOUNCEMENT_SOURCE, id)
    await this.prisma.announcement.delete({ where: { id } })
    return { id }
  }

  /** Cordys NotifyOnJob 同频：每 5 分钟发布进入生效区间且尚未转换的公告。 */
  @Cron('0 */5 * * * *')
  async scheduledPublish(): Promise<void> {
    if (!this.coordinator) return void (await this.publishDueAnnouncements(new Date()))
    await this.coordinator.runScheduledOnce('announcement-publish', 'MINUTE', () =>
      this.publishDueAnnouncements(new Date()),
    )
  }

  async publishDueAnnouncements(now = new Date()): Promise<number> {
    const due = await this.prisma.announcement.findMany({
      where: {
        notice: false,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      orderBy: { startAt: 'asc' },
      take: PUBLISH_BATCH_SIZE,
    })
    let published = 0
    for (const announcement of due) {
      try {
        if (await this.publishIfDue(announcement, now)) published += 1
      } catch (error) {
        this.logger.error(`公告 ${announcement.id} 发布失败: ${this.errorMessage(error)}`)
      }
    }
    return published
  }

  private async publishIfDue(announcement: Announcement, now: Date): Promise<boolean> {
    if (announcement.notice || announcement.startAt > now || announcement.endAt < now) return false
    const receiverUserIds = this.jsonStringArray(announcement.receiverUserIds)
    if (receiverUserIds.length === 0) {
      this.logger.warn(`公告 ${announcement.id} 没有接收成员，跳过发布`)
      return false
    }

    try {
      await this.notifications.notifyManyFromSource(
        announcement.tenantId,
        receiverUserIds,
        ANNOUNCEMENT_SOURCE,
        announcement.id,
        {
          type: 'announcement',
          title: announcement.subject,
          content: announcement.content,
          ...(announcement.url ? { link: announcement.url } : {}),
          ...(announcement.linkName ? { linkLabel: announcement.linkName } : {}),
        },
      )
      await this.prisma.announcement.updateMany({
        where: { id: announcement.id, tenantId: announcement.tenantId, notice: false },
        data: { notice: true },
      })
      return true
    } catch (error) {
      // 允许下个调度周期完整重试，不留下半成品 source 通知。
      await this.notifications.removeBySource(
        announcement.tenantId,
        ANNOUNCEMENT_SOURCE,
        announcement.id,
      )
      throw error
    }
  }

  private normalizeInput(dto: SaveAnnouncementDto) {
    const subject = dto.subject.trim()
    const content = dto.content.trim()
    if (!subject) throw new BadRequestException('公告标题不能为空')
    if (!content) throw new BadRequestException('公告内容不能为空')

    const startAt = new Date(dto.startAt)
    const endAt = new Date(dto.endAt)
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      throw new BadRequestException('公告发布时间格式无效')
    }
    if (endAt <= startAt) throw new BadRequestException('公告结束时间必须晚于开始时间')
    if (endAt < new Date()) throw new BadRequestException('公告结束时间不能早于当前时间')

    const url = dto.url?.trim() || null
    if (url && !this.isSafeUrl(url)) {
      throw new BadRequestException('公告链接仅支持 http/https 地址')
    }
    const linkName = url ? dto.linkName?.trim() || null : null
    return {
      subject,
      content,
      startAt,
      endAt,
      url,
      linkName,
      departmentIds: this.uniqueNonEmpty(dto.departmentIds),
      userIds: this.uniqueNonEmpty(dto.userIds),
    }
  }

  private async resolveReceivers(
    tenantId: string,
    departmentIds: string[],
    userIds: string[],
  ): Promise<ReceiverSnapshot> {
    if (departmentIds.length === 0 && userIds.length === 0) {
      throw new BadRequestException('至少选择一个公告接收部门或成员')
    }

    const departments = await this.prisma.department.findMany({
      where: { tenantId },
      select: { id: true, parentId: true },
    })
    const departmentSet = new Set(departments.map((item) => item.id))
    const invalidDepartments = departmentIds.filter((id) => !departmentSet.has(id))
    if (invalidDepartments.length) throw new BadRequestException('公告接收范围包含无效或跨租户部门')

    const children = new Map<string, string[]>()
    for (const department of departments) {
      if (!department.parentId) continue
      const list = children.get(department.parentId) ?? []
      list.push(department.id)
      children.set(department.parentId, list)
    }
    const expandedDepartments = new Set<string>()
    const visit = (id: string) => {
      if (expandedDepartments.has(id)) return
      expandedDepartments.add(id)
      for (const child of children.get(id) ?? []) visit(child)
    }
    departmentIds.forEach(visit)

    const explicitUsers = userIds.length
      ? await this.prisma.user.findMany({
          where: { tenantId, status: 'ACTIVE', id: { in: userIds } },
          select: { id: true },
        })
      : []
    if (explicitUsers.length !== userIds.length) {
      throw new BadRequestException('公告接收范围包含无效、已禁用或跨租户成员')
    }

    const departmentUsers = expandedDepartments.size
      ? await this.prisma.user.findMany({
          where: {
            tenantId,
            status: 'ACTIVE',
            deptId: { in: [...expandedDepartments] },
          },
          select: { id: true },
        })
      : []
    const receiverUserIds = [
      ...new Set([...explicitUsers, ...departmentUsers].map((item) => item.id)),
    ]
    if (receiverUserIds.length === 0) {
      throw new BadRequestException('所选公告接收范围中没有有效成员')
    }
    return { departmentIds, userIds, receiverUserIds }
  }

  private async findOne(tenantId: string, id: string): Promise<Announcement> {
    const announcement = await this.prisma.announcement.findFirst({ where: { id, tenantId } })
    if (!announcement) throw new NotFoundException('公告不存在')
    return announcement
  }

  private async toVOs(tenantId: string, announcements: Announcement[]): Promise<AnnouncementVO[]> {
    if (announcements.length === 0) return []
    const departmentIds = new Set<string>()
    const userIds = new Set<string>()
    for (const item of announcements) {
      this.jsonStringArray(item.departmentIds).forEach((id) => departmentIds.add(id))
      this.jsonStringArray(item.userIds).forEach((id) => userIds.add(id))
      userIds.add(item.createUserId)
      userIds.add(item.updateUserId)
    }
    const [departments, users] = await Promise.all([
      departmentIds.size
        ? this.prisma.department.findMany({
            where: { tenantId, id: { in: [...departmentIds] } },
            select: { id: true, name: true },
          })
        : [],
      userIds.size
        ? this.prisma.user.findMany({
            where: { tenantId, id: { in: [...userIds] } },
            select: { id: true, name: true },
          })
        : [],
    ])
    const departmentNames = new Map(departments.map((item) => [item.id, item.name]))
    const userNames = new Map(users.map((item) => [item.id, item.name]))
    return announcements.map((item) => {
      const selectedDepartmentIds = this.jsonStringArray(item.departmentIds)
      const selectedUserIds = this.jsonStringArray(item.userIds)
      return {
        id: item.id,
        subject: item.subject,
        content: item.content,
        startAt: item.startAt.toISOString(),
        endAt: item.endAt.toISOString(),
        url: item.url,
        linkName: item.linkName,
        notice: item.notice,
        departmentIds: selectedDepartmentIds,
        userIds: selectedUserIds,
        departments: selectedDepartmentIds.map((id) => ({
          id,
          name: departmentNames.get(id) ?? id,
        })),
        users: selectedUserIds.map((id) => ({ id, name: userNames.get(id) ?? id })),
        createUserId: item.createUserId,
        createUserName: userNames.get(item.createUserId) ?? null,
        updateUserId: item.updateUserId,
        updateUserName: userNames.get(item.updateUserId) ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }
    })
  }

  private jsonStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  }

  private uniqueNonEmpty(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  }

  private isSafeUrl(value: string): boolean {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
