import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  FollowUpPlanStatus as SharedFollowUpPlanStatus,
  FollowUpPlanVO,
  PaginatedResult,
  hasPermission,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { CustomerAccessService } from '../../customers/customer-access.service'
import {
  FollowUpPlan,
  FollowUpPlanStatus,
  Prisma,
} from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import {
  CreateFollowUpPlanDto,
  QueryFollowUpPlansDto,
  UpdateFollowUpPlanDto,
} from './dto/follow-up-plan.dto'

type TargetType = CreateFollowUpPlanDto['targetType']

interface TargetContext {
  name: string
  customerId: string | null
  collaboratorOnly: boolean
}

@Injectable()
export class FollowUpPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly customerAccess: CustomerAccessService,
    private readonly pools: ResourcePoolsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    user: AuthUser,
    query: QueryFollowUpPlansDto,
  ): Promise<PaginatedResult<FollowUpPlanVO>> {
    const { page = 1, pageSize = 10, keyword, status, targetType, targetId, mine } = query
    if (targetId && !targetType) throw new BadRequestException('指定业务对象时必须同时提供类型')

    let accessWhere: Prisma.FollowUpPlanWhereInput
    if (targetType && targetId) {
      const context = await this.assertTargetAccess(user, targetType, targetId, false)
      accessWhere = {
        targetType,
        targetId,
        ...(context.collaboratorOnly ? { createdById: user.id } : {}),
      }
    } else {
      accessWhere = await this.globalAccessWhere(user)
    }

    const keywordWhere = keyword ? await this.keywordWhere(user.tenantId, keyword) : undefined
    const where: Prisma.FollowUpPlanWhereInput = {
      tenantId: user.tenantId,
      AND: [
        accessWhere,
        ...(keywordWhere ? [keywordWhere] : []),
        ...(mine ? [{ ownerId: user.id }] : []),
      ],
      ...(status ? { status } : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.followUpPlan.findMany({
        where,
        orderBy: [{ estimatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.followUpPlan.count({ where }),
    ])
    return { items: await this.toVOs(user, items), total, page, pageSize }
  }

  async get(user: AuthUser, id: string): Promise<FollowUpPlanVO> {
    const plan = await this.ensurePlan(user, id)
    const context = await this.assertTargetAccess(
      user,
      plan.targetType as TargetType,
      plan.targetId,
      false,
    )
    if (context.collaboratorOnly && plan.createdById !== user.id) {
      throw new NotFoundException('跟进计划不存在或无权访问')
    }
    return (await this.toVOs(user, [plan]))[0]
  }

  async create(user: AuthUser, dto: CreateFollowUpPlanDto): Promise<FollowUpPlanVO> {
    await this.assertTargetAccess(user, dto.targetType, dto.targetId, true)
    await this.assertContact(user.tenantId, dto.targetType, dto.targetId, dto.contactId)
    const owner = await this.resolveOwner(user, dto.ownerId)
    const plan = await this.prisma.followUpPlan.create({
      data: {
        tenantId: user.tenantId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        contactId: dto.contactId ?? null,
        content: dto.content,
        method: dto.method ?? null,
        estimatedAt: dto.estimatedAt ? new Date(dto.estimatedAt) : null,
        ownerId: owner.id,
        deptId: owner.deptId,
        createdById: user.id,
        customData: (dto.customData ?? {}) as Prisma.InputJsonValue,
      },
    })
    return (await this.toVOs(user, [plan]))[0]
  }

  async update(user: AuthUser, id: string, dto: UpdateFollowUpPlanDto): Promise<FollowUpPlanVO> {
    const existing = await this.ensureManageablePlan(user, id)
    const targetType = dto.targetType ?? (existing.targetType as TargetType)
    const targetId = dto.targetId ?? existing.targetId
    await this.assertTargetAccess(user, targetType, targetId, true)
    const contactId = dto.contactId === undefined ? existing.contactId : dto.contactId || null
    await this.assertContact(user.tenantId, targetType, targetId, contactId ?? undefined)
    const owner = dto.ownerId ? await this.resolveOwner(user, dto.ownerId) : null
    const estimatedAt =
      dto.estimatedAt === undefined
        ? existing.estimatedAt
        : dto.estimatedAt
          ? new Date(dto.estimatedAt)
          : null
    const dueDateChanged = estimatedAt?.getTime() !== existing.estimatedAt?.getTime()

    const plan = await this.prisma.followUpPlan.update({
      where: { id },
      data: {
        targetType,
        targetId,
        contactId,
        content: dto.content,
        method: dto.method,
        estimatedAt,
        ...(owner ? { ownerId: owner.id, deptId: owner.deptId } : {}),
        ...(dto.customData
          ? {
              customData: {
                ...((existing.customData as Record<string, unknown> | null) ?? {}),
                ...dto.customData,
              } as Prisma.InputJsonValue,
            }
          : {}),
        ...(dueDateChanged ? { dueNotifiedAt: null } : {}),
      },
    })
    return (await this.toVOs(user, [plan]))[0]
  }

  async updateStatus(
    user: AuthUser,
    id: string,
    status: SharedFollowUpPlanStatus,
  ): Promise<FollowUpPlanVO> {
    const existing = await this.ensureManageablePlan(user, id)
    if (existing.status === 'COMPLETED' && existing.converted) {
      throw new ConflictException('已转为跟进记录的计划不能再变更状态')
    }
    const plan = await this.prisma.followUpPlan.update({
      where: { id },
      data: { status: status as FollowUpPlanStatus },
    })
    return (await this.toVOs(user, [plan]))[0]
  }

  async convert(user: AuthUser, id: string): Promise<FollowUpPlanVO> {
    const existing = await this.ensureManageablePlan(user, id)
    if (existing.status !== 'COMPLETED') {
      throw new BadRequestException('只有已完成计划才能转为跟进记录')
    }
    if (existing.converted) throw new ConflictException('该计划已转为跟进记录')
    const owner = await this.prisma.user.findFirst({
      where: { id: existing.ownerId, tenantId: user.tenantId },
      select: { name: true },
    })
    if (!owner) throw new BadRequestException('计划负责人不存在')

    const converted = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.followUpPlan.updateMany({
        where: {
          id,
          tenantId: user.tenantId,
          status: 'COMPLETED',
          converted: false,
        },
        data: { converted: true },
      })
      if (claimed.count !== 1) throw new ConflictException('该计划已转为跟进记录')
      const record = await tx.followUpRecord.create({
        data: {
          tenantId: user.tenantId,
          targetType: existing.targetType,
          targetId: existing.targetId,
          type: existing.method ?? '其他',
          content: existing.content,
          ownerId: existing.ownerId,
          ownerName: owner.name,
        },
      })
      await this.touchTarget(tx, user.tenantId, existing.targetType, existing.targetId)
      return tx.followUpPlan.update({
        where: { id },
        data: { convertedRecordId: record.id },
      })
    })
    return (await this.toVOs(user, [converted]))[0]
  }

  async remove(user: AuthUser, id: string) {
    const plan = await this.ensureManageablePlan(user, id)
    await this.prisma.followUpPlan.delete({ where: { id } })
    return { id: plan.id }
  }

  /** 每日 09:00 扫描当天到期的未结束计划。 */
  @Cron('0 0 9 * * *')
  async scheduledReminder(): Promise<void> {
    await this.runDueReminders(new Date())
  }

  async runDueReminders(now: Date): Promise<number> {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const plans = await this.prisma.followUpPlan.findMany({
      where: {
        estimatedAt: { gte: start, lt: end },
        status: { in: ['PREPARED', 'UNDERWAY'] },
        OR: [{ dueNotifiedAt: null }, { dueNotifiedAt: { lt: start } }],
      },
      orderBy: { estimatedAt: 'asc' },
    })
    const names = await this.targetNames(plans)
    let notified = 0
    for (const plan of plans) {
      const claimed = await this.prisma.followUpPlan.updateMany({
        where: {
          id: plan.id,
          OR: [{ dueNotifiedAt: null }, { dueNotifiedAt: { lt: start } }],
        },
        data: { dueNotifiedAt: now },
      })
      if (claimed.count !== 1) continue
      try {
        await this.notifications.notify(plan.tenantId, plan.ownerId, {
          type: 'follow_plan',
          title: '跟进计划到期提醒',
          content: `${names.get(`${plan.targetType}:${plan.targetId}`) ?? '业务对象'}：${plan.content}`,
          link: `/follow-plans?id=${plan.id}`,
        })
        notified += 1
      } catch (error) {
        await this.prisma.followUpPlan.updateMany({
          where: { id: plan.id, dueNotifiedAt: now },
          data: { dueNotifiedAt: null },
        })
        throw error
      }
    }
    return notified
  }

  private async ensurePlan(user: AuthUser, id: string): Promise<FollowUpPlan> {
    const plan = await this.prisma.followUpPlan.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!plan) throw new NotFoundException('跟进计划不存在')
    return plan
  }

  private async ensureManageablePlan(user: AuthUser, id: string): Promise<FollowUpPlan> {
    const plan = await this.ensurePlan(user, id)
    if (plan.ownerId !== user.id && !hasPermission(user.permissions, '*')) {
      throw new ForbiddenException('只有计划负责人可以执行此操作')
    }
    return plan
  }

  private async assertTargetAccess(
    user: AuthUser,
    type: TargetType,
    id: string,
    write: boolean,
  ): Promise<TargetContext> {
    if (type === 'customer') {
      const permission = write ? 'customer:update' : 'menu:customer'
      if (!hasPermission(user.permissions, permission)) throw new ForbiddenException('无客户权限')
      const access = write
        ? await this.customerAccess.assertCollaborateWrite(user, id, permission)
        : await this.customerAccess.assertRead(user, id)
      return {
        name: access.customer.name,
        customerId: id,
        collaboratorOnly: !access.dataScope && access.collaborationType !== null,
      }
    }
    if (type === 'lead') {
      const permission = write ? 'lead:update' : 'menu:lead'
      if (!hasPermission(user.permissions, permission)) throw new ForbiddenException('无线索权限')
      const lead = await this.prisma.lead.findFirst({ where: { id, tenantId: user.tenantId } })
      if (!lead) throw new NotFoundException('线索不存在')
      if (lead.inPool) {
        const poolIds = (await this.pools.options(user, 'lead')).map((pool) => pool.id)
        if (lead.poolId && !poolIds.includes(lead.poolId)) throw new NotFoundException('线索不存在或无权访问')
      } else if (!(await this.dataScope.matchesResource(user, lead.ownerId, lead.deptId, permission))) {
        throw new NotFoundException('线索不存在或不在你的数据范围内')
      }
      return { name: lead.name, customerId: null, collaboratorOnly: false }
    }
    const permission = write ? 'opportunity:update' : 'menu:opportunity'
    if (!hasPermission(user.permissions, permission)) throw new ForbiddenException('无商机权限')
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (
      !opportunity ||
      !(await this.dataScope.matchesResource(user, opportunity.ownerId, opportunity.deptId, permission))
    ) {
      throw new NotFoundException('商机不存在或不在你的数据范围内')
    }
    return { name: opportunity.name, customerId: opportunity.customerId, collaboratorOnly: false }
  }

  private async assertContact(
    tenantId: string,
    type: TargetType,
    targetId: string,
    contactId?: string,
  ): Promise<void> {
    if (!contactId) return
    let customerId: string | null = type === 'customer' ? targetId : null
    if (type === 'opportunity') {
      customerId = (
        await this.prisma.opportunity.findFirst({
          where: { id: targetId, tenantId },
          select: { customerId: true },
        })
      )?.customerId ?? null
    }
    if (!customerId) throw new BadRequestException('当前业务对象不能关联客户联系人')
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, tenantId, customerId },
    })
    if (!contact) throw new BadRequestException('联系人不属于当前客户')
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id, deptId: user.deptId }
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true, deptId: true },
    })
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner
  }

  private async globalAccessWhere(user: AuthUser): Promise<Prisma.FollowUpPlanWhereInput> {
    const [lead, customer, opportunity, collaborations] = await Promise.all([
      this.dataScope.scopeFilter(user, 'menu:lead'),
      this.dataScope.scopeFilter(user, 'menu:customer'),
      this.dataScope.scopeFilter(user, 'menu:opportunity'),
      this.prisma.customerTeamMember.findMany({
        where: { tenantId: user.tenantId, userId: user.id },
        select: { customerId: true },
      }),
    ])
    return {
      OR: [
        { targetType: 'lead', ...(lead as Prisma.FollowUpPlanWhereInput) },
        { targetType: 'customer', ...(customer as Prisma.FollowUpPlanWhereInput) },
        { targetType: 'opportunity', ...(opportunity as Prisma.FollowUpPlanWhereInput) },
        {
          targetType: 'customer',
          targetId: { in: collaborations.map((item) => item.customerId) },
          createdById: user.id,
        },
      ],
    }
  }

  private async keywordWhere(tenantId: string, keyword: string): Promise<Prisma.FollowUpPlanWhereInput> {
    const contains = { contains: keyword, mode: 'insensitive' as const }
    const [leads, customers, opportunities] = await Promise.all([
      this.prisma.lead.findMany({ where: { tenantId, name: contains }, select: { id: true } }),
      this.prisma.customer.findMany({ where: { tenantId, name: contains }, select: { id: true } }),
      this.prisma.opportunity.findMany({ where: { tenantId, name: contains }, select: { id: true } }),
    ])
    return {
      OR: [
        { content: contains },
        { targetType: 'lead', targetId: { in: leads.map((item) => item.id) } },
        { targetType: 'customer', targetId: { in: customers.map((item) => item.id) } },
        { targetType: 'opportunity', targetId: { in: opportunities.map((item) => item.id) } },
      ],
    }
  }

  private async touchTarget(
    tx: Prisma.TransactionClient,
    tenantId: string,
    targetType: string,
    targetId: string,
  ): Promise<void> {
    const where = { id: targetId, tenantId }
    const data = { lastFollowedAt: new Date() }
    if (targetType === 'lead') await tx.lead.updateMany({ where, data })
    if (targetType === 'customer') await tx.customer.updateMany({ where, data })
    if (targetType === 'opportunity') await tx.opportunity.updateMany({ where, data })
  }

  private async targetNames(plans: FollowUpPlan[]): Promise<Map<string, string>> {
    const groups = {
      lead: plans.filter((p) => p.targetType === 'lead').map((p) => p.targetId),
      customer: plans.filter((p) => p.targetType === 'customer').map((p) => p.targetId),
      opportunity: plans.filter((p) => p.targetType === 'opportunity').map((p) => p.targetId),
    }
    const [leads, customers, opportunities] = await Promise.all([
      this.prisma.lead.findMany({ where: { id: { in: groups.lead } }, select: { id: true, name: true } }),
      this.prisma.customer.findMany({
        where: { id: { in: groups.customer } },
        select: { id: true, name: true },
      }),
      this.prisma.opportunity.findMany({
        where: { id: { in: groups.opportunity } },
        select: { id: true, name: true },
      }),
    ])
    return new Map([
      ...leads.map((item) => [`lead:${item.id}`, item.name] as const),
      ...customers.map((item) => [`customer:${item.id}`, item.name] as const),
      ...opportunities.map((item) => [`opportunity:${item.id}`, item.name] as const),
    ])
  }

  private async toVOs(user: AuthUser, plans: FollowUpPlan[]): Promise<FollowUpPlanVO[]> {
    if (plans.length === 0) return []
    const names = await this.targetNames(plans)
    const [owners, contacts, opportunities] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(plans.map((p) => p.ownerId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.contact.findMany({
        where: { id: { in: plans.flatMap((p) => (p.contactId ? [p.contactId] : [])) } },
        select: { id: true, name: true },
      }),
      this.prisma.opportunity.findMany({
        where: {
          id: {
            in: plans.filter((p) => p.targetType === 'opportunity').map((p) => p.targetId),
          },
        },
        select: { id: true, customerId: true },
      }),
    ])
    const ownerMap = new Map(owners.map((item) => [item.id, item.name]))
    const contactMap = new Map(contacts.map((item) => [item.id, item.name]))
    const opportunityCustomerMap = new Map(
      opportunities.map((item) => [item.id, item.customerId]),
    )
    const admin = hasPermission(user.permissions, '*')
    return plans.map((plan) => ({
      id: plan.id,
      targetType: plan.targetType as FollowUpPlanVO['targetType'],
      targetId: plan.targetId,
      targetName: names.get(`${plan.targetType}:${plan.targetId}`) ?? '已删除业务对象',
      customerId:
        plan.targetType === 'customer'
          ? plan.targetId
          : plan.targetType === 'opportunity'
            ? (opportunityCustomerMap.get(plan.targetId) ?? null)
            : null,
      contactId: plan.contactId,
      contactName: plan.contactId ? (contactMap.get(plan.contactId) ?? null) : null,
      content: plan.content,
      method: plan.method,
      estimatedAt: plan.estimatedAt?.toISOString() ?? null,
      status: plan.status,
      converted: plan.converted,
      convertedRecordId: plan.convertedRecordId,
      ownerId: plan.ownerId,
      ownerName: ownerMap.get(plan.ownerId) ?? '已停用成员',
      createdById: plan.createdById,
      customData: (plan.customData as Record<string, unknown> | null) ?? {},
      canManage: admin || plan.ownerId === user.id,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    }))
  }
}
