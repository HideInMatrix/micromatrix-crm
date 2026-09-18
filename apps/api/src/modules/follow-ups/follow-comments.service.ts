import { Injectable } from '@nestjs/common'
import type { MessageTaskEvent } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaClient } from '../../prisma/prisma-client'
import { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { createLegacyId32 } from '../../common/legacy-id'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { FollowCommentServiceBase } from './follow-comment.service-base'
import { type FollowRecord, FollowUpsService } from './follow-ups.service'

type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

@Injectable()
export class FollowCommentsService extends FollowCommentServiceBase<FollowRecord> {
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
    const collection = this.comments().where({
      organizationId: tenantId,
      resourceId,
      parentId: null,
    })
    const [parents, aggregate] = await Promise.all([
      collection
        .orderBy((row) => row.createTime.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      collection.aggregate((aggregate) => ({ count: aggregate.count() })),
    ])
    return { parents: parents.map((row) => this.toCommentRow(row)), total: aggregate.count }
  }

  protected async loadReplies(tenantId: string, resourceId: string, parentIds: string[]) {
    const rows = await this.comments()
      .where({ organizationId: tenantId, resourceId })
      .where((row) => row.parentId.in(parentIds))
      .orderBy((row) => row.createTime.asc())
      .all()
    return rows.map((row) => this.toCommentRow(row))
  }

  protected findComment(tenantId: string, id: string) {
    return this.comments()
      .where({ id: id, organizationId: tenantId })
      .first()
      .then((row) => (row ? this.toCommentRow(row) : null))
  }

  protected findReplyParent(tenantId: string, resourceId: string, parentId: string) {
    return this.comments()
      .where({
        id: parentId,
        organizationId: tenantId,
        resourceId,
      })
      .select('id', 'parentId')
      .first()
  }

  protected createComment(
    tx: PrismaTransaction,
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
    return tx.orm.public.FollowUpRecordComment.create({
      id: createLegacyId32(),
      resourceId: input.resourceId,
      parentId: input.parentId ? input.parentId : null,
      replyToUserId: input.replyToUserId ? input.replyToUserId : null,
      content: input.content,
      organizationId: input.tenantId,
      createUser: input.createdById,
      updateUser: input.updatedById,
      updateTime: nowInstant(),
    }).then((row) => this.toCommentRow(row))
  }

  protected updateComment(tx: PrismaTransaction, id: string, content: string, updatedById: string) {
    return tx.orm.public.FollowUpRecordComment.where({ id: id })
      .update({
        content: content,
        updateUser: updatedById,
        updateTime: nowInstant(),
      })
      .then((row) => {
        if (!row) throw new Error('评论不存在')
        return this.toCommentRow(row)
      })
  }

  protected async deleteComment(tx: PrismaTransaction, id: string): Promise<void> {
    await tx.orm.public.FollowUpRecordComment.where({ id: id }).delete()
  }

  protected async replaceMentions(tx: PrismaTransaction, commentId: string, userIds: string[]) {
    await tx.orm.public.FollowUpRecordCommentMention.where({
      commentId: commentId,
    }).deleteAndCount()
    if (!userIds.length) return
    await tx.orm.public.FollowUpRecordCommentMention.createAll(
      userIds.map((userId) => ({
        id: createLegacyId32(),
        commentId: commentId,
        userId: userId,
      })),
    )
  }

  protected async loadMentions(commentIds: string[]) {
    return await this.prisma.client.orm.public.FollowUpRecordCommentMention.where((row) =>
      row.commentId.in(commentIds),
    )
      .select('commentId', 'userId')
      .all()
  }

  protected async recount(tx: PrismaTransaction, tenantId: string, resourceId: string) {
    const { count: commentCount } = await tx.orm.public.FollowUpRecordComment.where({
      organizationId: tenantId,
      resourceId,
    }).aggregate((aggregate) => ({ count: aggregate.count() }))
    await tx.orm.public.FollowUpRecords.where({ id: resourceId, tenantId }).update({
      commentCount,
      updatedAt: nowInstant(),
    })
    return commentCount
  }

  private comments() {
    return this.prisma.client.orm.public.FollowUpRecordComment
  }

  protected commentEvent(record: FollowRecord, mentioned: boolean): MessageTaskEvent {
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
