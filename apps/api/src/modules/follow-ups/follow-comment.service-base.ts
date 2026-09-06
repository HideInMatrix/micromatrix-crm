import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type {
  FollowCommentPageVO,
  FollowCommentVO,
  MessageTaskEvent,
  NotificationBizType,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { withOperationLogResult } from '../../common/decorators/log-operation.decorator'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import type {
  AddFollowCommentDto,
  FollowCommentPageDto,
  UpdateFollowCommentDto,
} from './dto/follow-comment.dto'

export interface FollowCommentRow {
  id: string
  resourceId: string
  parentId: string | null
  replyToUserId: string | null
  content: string
  tenantId: string
  createdById: string
  updatedById: string
  createdAt: Date
  updatedAt: Date
}

export interface FollowCommentResource {
  id: string
  targetType: string
  targetId: string
  ownerId: string
  commentCount: number
}

interface MentionRow {
  commentId: string
  userId: string
}

interface CreateCommentInput {
  resourceId: string
  parentId: string | null
  replyToUserId: string | null
  content: string
  tenantId: string
  createdById: string
  updatedById: string
}

/** FollowRecord / FollowPlan 共用评论业务内核，子类仅提供资源、表和事件差异。 */
export abstract class FollowCommentServiceBase<TResource extends FollowCommentResource> {
  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly notifications: BusinessNotificationsService,
  ) {}

  protected abstract readonly resourceLabel: string
  protected abstract readonly notificationType: NotificationBizType
  protected abstract readonly notificationTitle: string

  protected abstract assertResourceAccess(
    user: AuthUser,
    resourceId: string,
    write: boolean,
  ): Promise<TResource>
  protected abstract loadParents(
    tenantId: string,
    resourceId: string,
    page: number,
    pageSize: number,
  ): Promise<{ parents: FollowCommentRow[]; total: number }>
  protected abstract loadReplies(
    tenantId: string,
    resourceId: string,
    parentIds: string[],
  ): Promise<FollowCommentRow[]>
  protected abstract findComment(tenantId: string, id: string): Promise<FollowCommentRow | null>
  protected abstract findReplyParent(
    tenantId: string,
    resourceId: string,
    parentId: string,
  ): Promise<{ id: string; parentId: string | null } | null>
  protected abstract createComment(
    tx: Prisma.TransactionClient,
    input: CreateCommentInput,
  ): Promise<FollowCommentRow>
  protected abstract updateComment(
    tx: Prisma.TransactionClient,
    id: string,
    content: string,
    updatedById: string,
  ): Promise<FollowCommentRow>
  protected abstract deleteComment(tx: Prisma.TransactionClient, id: string): Promise<void>
  protected abstract replaceMentions(
    tx: Prisma.TransactionClient,
    commentId: string,
    userIds: string[],
  ): Promise<void>
  protected abstract loadMentions(commentIds: string[]): Promise<MentionRow[]>
  protected abstract recount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    resourceId: string,
  ): Promise<number>
  protected abstract commentEvent(resource: TResource, mentioned: boolean): MessageTaskEvent

  async page(user: AuthUser, dto: FollowCommentPageDto): Promise<FollowCommentPageVO> {
    const resource = await this.assertResourceAccess(user, dto.resourceId, false)
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 10
    const { parents, total } = await this.loadParents(user.tenantId, dto.resourceId, page, pageSize)
    const replies = parents.length
      ? await this.loadReplies(
          user.tenantId,
          dto.resourceId,
          parents.map((comment) => comment.id),
        )
      : []
    return {
      items: await this.toVOs(user, parents, replies),
      total,
      commentCount: resource.commentCount,
      page,
      pageSize,
    }
  }

  async add(user: AuthUser, dto: AddFollowCommentDto): Promise<FollowCommentVO> {
    const resource = await this.assertResourceAccess(user, dto.resourceId, false)
    const content = this.normalizeContent(dto.content)
    const mentionedUserIds = await this.validateMentionUsers(user.tenantId, dto.mentionedUserIds)
    await this.validateReply(user.tenantId, dto.resourceId, dto.parentId, dto.replyToUserId)

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await this.createComment(tx, {
        resourceId: dto.resourceId,
        parentId: dto.parentId ?? null,
        replyToUserId: dto.replyToUserId ?? null,
        content,
        tenantId: user.tenantId,
        createdById: user.id,
        updatedById: user.id,
      })
      await this.replaceMentions(tx, created.id, mentionedUserIds)
      await this.recount(tx, user.tenantId, dto.resourceId)
      return created
    })

    await this.sendNotifications(user, resource, dto.replyToUserId, mentionedUserIds)
    const vo = (await this.toVOs(user, [comment], []))[0]
    return withOperationLogResult(vo, {
      targetId: dto.resourceId,
      detail: {
        commentId: comment.id,
        operation: 'add',
        parentId: comment.parentId,
        content: comment.content,
      },
    })
  }

  async update(user: AuthUser, dto: UpdateFollowCommentDto): Promise<FollowCommentVO> {
    const comment = await this.getOwnComment(user, dto.id)
    const resource = await this.assertResourceAccess(user, comment.resourceId, false)
    const content = this.normalizeContent(dto.content)
    const mentionedUserIds = await this.validateMentionUsers(user.tenantId, dto.mentionedUserIds)

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.updateComment(tx, comment.id, content, user.id)
      await this.replaceMentions(tx, row.id, mentionedUserIds)
      return row
    })

    await this.sendNotifications(
      user,
      resource,
      comment.replyToUserId ?? undefined,
      mentionedUserIds,
    )
    const vo = (await this.toVOs(user, [updated], []))[0]
    return withOperationLogResult(vo, {
      targetId: comment.resourceId,
      detail: {
        commentId: comment.id,
        operation: 'update',
        before: { content: comment.content },
        after: { content: updated.content },
      },
    })
  }

  async remove(user: AuthUser, id: string): Promise<{ id: string; commentCount: number }> {
    const comment = await this.getOwnComment(user, id)
    await this.assertResourceAccess(user, comment.resourceId, false)
    const commentCount = await this.prisma.$transaction(async (tx) => {
      await this.deleteComment(tx, comment.id)
      return this.recount(tx, user.tenantId, comment.resourceId)
    })
    return withOperationLogResult(
      { id, commentCount },
      {
        targetId: comment.resourceId,
        detail: {
          commentId: comment.id,
          operation: 'delete',
          before: { content: comment.content },
        },
      },
    )
  }

  private normalizeContent(content: string): string {
    const value = content.trim()
    if (!value) throw new BadRequestException('评论内容不能为空')
    if (value.length > 3000) throw new BadRequestException('评论内容不能超过 3000 字')
    return value
  }

  private async validateReply(
    tenantId: string,
    resourceId: string,
    parentId?: string,
    replyToUserId?: string,
  ): Promise<void> {
    if (!parentId && replyToUserId) throw new BadRequestException('回复成员时必须指定顶层评论')
    if (parentId) {
      const parent = await this.findReplyParent(tenantId, resourceId, parentId)
      if (!parent) throw new BadRequestException(`顶层评论不存在或不属于当前${this.resourceLabel}`)
      if (parent.parentId) throw new BadRequestException(`${this.resourceLabel}只支持两层回复`)
    }
    if (replyToUserId) await this.assertActiveUser(tenantId, replyToUserId, '被回复成员')
  }

  private async validateMentionUsers(tenantId: string, userIds?: string[]): Promise<string[]> {
    if (!userIds?.length) return []
    if (userIds.length > 100) throw new BadRequestException('@成员不能超过 100 人')
    const normalized = userIds.map((id) => id.trim())
    if (normalized.some((id) => !id)) throw new BadRequestException('存在无效的@成员')
    const distinct = [...new Set(normalized)]
    const users = await this.prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE', id: { in: distinct } },
      select: { id: true },
    })
    if (users.length !== distinct.length) throw new BadRequestException('存在无效或已停用的@成员')
    return distinct
  }

  private async assertActiveUser(tenantId: string, userId: string, label: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!user) throw new BadRequestException(`${label}不存在或已停用`)
  }

  private async getOwnComment(user: AuthUser, id: string): Promise<FollowCommentRow> {
    const comment = await this.findComment(user.tenantId, id)
    if (!comment) throw new NotFoundException(`${this.resourceLabel}不存在`)
    if (comment.createdById !== user.id)
      throw new ForbiddenException('只有评论创建人可以执行此操作')
    return comment
  }

  private async toVOs(
    user: AuthUser,
    parents: FollowCommentRow[],
    replies: FollowCommentRow[],
  ): Promise<FollowCommentVO[]> {
    const all = [...parents, ...replies]
    if (!all.length) return []
    const mentions = await this.loadMentions(all.map((comment) => comment.id))
    const userIds = new Set<string>()
    all.forEach((comment) => {
      userIds.add(comment.createdById)
      if (comment.replyToUserId) userIds.add(comment.replyToUserId)
    })
    mentions.forEach((mention) => userIds.add(mention.userId))
    const users = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, id: { in: [...userIds] } },
      select: {
        id: true,
        name: true,
        status: true,
        extension: { select: { avatar: true } },
      },
    })
    const userMap = new Map(users.map((item) => [item.id, item]))
    const mentionMap = new Map<string, string[]>()
    for (const mention of mentions) {
      const ids = mentionMap.get(mention.commentId) ?? []
      ids.push(mention.userId)
      mentionMap.set(mention.commentId, ids)
    }

    const makeVO = (comment: FollowCommentRow): FollowCommentVO => {
      const creator = userMap.get(comment.createdById)
      return {
        id: comment.id,
        resourceId: comment.resourceId,
        parentId: comment.parentId,
        replyToUserId: comment.replyToUserId,
        replyToUserName: comment.replyToUserId
          ? (userMap.get(comment.replyToUserId)?.name ?? null)
          : null,
        content: comment.content,
        createdById: comment.createdById,
        createdByName: creator?.name ?? '',
        createdByAvatar: creator?.extension?.avatar ?? null,
        editable: comment.createdById === user.id,
        mentionUsers: (mentionMap.get(comment.id) ?? []).map((id) => {
          const mentioned = userMap.get(id)
          return {
            id,
            name: mentioned?.name ?? '',
            avatar: mentioned?.extension?.avatar ?? null,
            enabled: mentioned?.status === 'ACTIVE',
          }
        }),
        replies: [],
        replyCount: 0,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
      }
    }

    const replyMap = new Map<string, FollowCommentVO[]>()
    for (const reply of replies) {
      if (!reply.parentId) continue
      const list = replyMap.get(reply.parentId) ?? []
      list.push(makeVO(reply))
      replyMap.set(reply.parentId, list)
    }
    return parents.map((parent) => {
      const vo = makeVO(parent)
      vo.replies = replyMap.get(parent.id) ?? []
      vo.replyCount = vo.replies.length
      return vo
    })
  }

  private async sendNotifications(
    operator: AuthUser,
    resource: TResource,
    replyToUserId: string | undefined,
    mentionedUserIds: string[],
  ): Promise<void> {
    const mentioned = [...new Set([...mentionedUserIds, ...(replyToUserId ? [replyToUserId] : [])])]
    const targetName = await this.targetName(operator.tenantId, resource)
    const link = this.targetLink(resource)

    if (resource.ownerId && !mentioned.includes(resource.ownerId)) {
      await this.notifications.send({
        tenantId: operator.tenantId,
        event: this.commentEvent(resource, false),
        operatorId: operator.id,
        recipientIds: [resource.ownerId],
        excludeSelf: true,
        type: this.notificationType,
        title: `${this.notificationTitle}评论提醒`,
        content: `${operator.name} 给「${targetName}」的${this.notificationTitle}添加了评论`,
        link,
      })
    }
    if (mentioned.length) {
      await this.notifications.send({
        tenantId: operator.tenantId,
        event: this.commentEvent(resource, true),
        operatorId: operator.id,
        recipientIds: mentioned,
        excludeSelf: true,
        type: this.notificationType,
        title: `${this.notificationTitle}评论@提醒`,
        content: `${operator.name} 在「${targetName}」的${this.notificationTitle}评论中提到了你`,
        link,
      })
    }
  }

  private async targetName(tenantId: string, resource: TResource): Promise<string> {
    if (resource.targetType === 'lead') {
      return (
        (
          await this.prisma.clue.findFirst({
            where: { id: resource.targetId, organizationId: tenantId },
            select: { name: true },
          })
        )?.name ?? '线索'
      )
    }
    if (resource.targetType === 'opportunity') {
      return (
        (
          await this.prisma.opportunity.findFirst({
            where: { id: resource.targetId, organizationId: tenantId },
            select: { name: true },
          })
        )?.name ?? '商机'
      )
    }
    return (
      (
        await this.prisma.customer.findFirst({
          where: { id: resource.targetId, organizationId: tenantId },
          select: { name: true },
        })
      )?.name ?? '客户'
    )
  }

  private targetLink(resource: TResource): string {
    if (resource.targetType === 'lead') return '/leads'
    if (resource.targetType === 'opportunity') return '/opportunities'
    return '/customers'
  }
}
