import { Injectable } from '@nestjs/common'
import type { MessageTaskEvent } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { FollowUpRecord, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { FollowCommentServiceBase } from './follow-comment.service-base'
import { FollowUpsService } from './follow-ups.service'

@Injectable()
export class FollowCommentsService extends FollowCommentServiceBase<FollowUpRecord> {
  protected readonly resourceLabel = '跟进记录评论'
  protected readonly notificationType = 'follow_record_comment'
  protected readonly notificationTitle = '跟进记录'

  constructor(
    prisma: PrismaService,
    private readonly followUps: FollowUpsService,
    notifications: BusinessNotificationsService,
  ) {
    super(prisma, notifications)
  }

  protected assertResourceAccess(user: AuthUser, resourceId: string, write: boolean) {
    return this.followUps.assertRecordAccess(user, resourceId, write)
  }

  protected async loadParents(
    tenantId: string,
    resourceId: string,
    page: number,
    pageSize: number,
  ) {
    const where = { tenantId, resourceId, parentId: null }
    const [parents, total] = await this.prisma.$transaction([
      this.prisma.followUpRecordComment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.followUpRecordComment.count({ where }),
    ])
    return { parents, total }
  }

  protected loadReplies(tenantId: string, resourceId: string, parentIds: string[]) {
    return this.prisma.followUpRecordComment.findMany({
      where: { tenantId, resourceId, parentId: { in: parentIds } },
      orderBy: { createdAt: 'asc' },
    })
  }

  protected findComment(tenantId: string, id: string) {
    return this.prisma.followUpRecordComment.findFirst({ where: { id, tenantId } })
  }

  protected findReplyParent(tenantId: string, resourceId: string, parentId: string) {
    return this.prisma.followUpRecordComment.findFirst({
      where: { id: parentId, tenantId, resourceId },
      select: { id: true, parentId: true },
    })
  }

  protected createComment(
    tx: Prisma.TransactionClient,
    input: {
      resourceId: string
      parentId: string | null
      replyToUserId: string | null
      content: string
      tenantId: string
      createdById: string
      updatedById: string
    },
  ) {
    return tx.followUpRecordComment.create({ data: input })
  }

  protected updateComment(
    tx: Prisma.TransactionClient,
    id: string,
    content: string,
    updatedById: string,
  ) {
    return tx.followUpRecordComment.update({ where: { id }, data: { content, updatedById } })
  }

  protected async deleteComment(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.followUpRecordComment.delete({ where: { id } })
  }

  protected async replaceMentions(
    tx: Prisma.TransactionClient,
    commentId: string,
    userIds: string[],
  ) {
    await tx.followUpRecordCommentMention.deleteMany({ where: { commentId } })
    if (!userIds.length) return
    await tx.followUpRecordCommentMention.createMany({
      data: userIds.map((userId) => ({ commentId, userId })),
      skipDuplicates: true,
    })
  }

  protected loadMentions(commentIds: string[]) {
    return this.prisma.followUpRecordCommentMention.findMany({
      where: { commentId: { in: commentIds } },
      select: { commentId: true, userId: true },
    })
  }

  protected async recount(tx: Prisma.TransactionClient, tenantId: string, resourceId: string) {
    const commentCount = await tx.followUpRecordComment.count({ where: { tenantId, resourceId } })
    await tx.followUpRecord.update({ where: { id: resourceId }, data: { commentCount } })
    return commentCount
  }

  protected commentEvent(record: FollowUpRecord, mentioned: boolean): MessageTaskEvent {
    if (record.targetType === 'lead') {
      return mentioned
        ? 'CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED'
        : 'CLUE_FOLLOW_UP_RECORD_COMMENT_ADDED'
    }
    if (record.targetType === 'opportunity') {
      return mentioned
        ? 'OPPORTUNITY_FOLLOW_UP_RECORD_COMMENT_MENTIONED'
        : 'OPPORTUNITY_FOLLOW_UP_RECORD_COMMENT_ADDED'
    }
    return mentioned
      ? 'CUSTOMER_FOLLOW_UP_RECORD_COMMENT_MENTIONED'
      : 'CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED'
  }
}
