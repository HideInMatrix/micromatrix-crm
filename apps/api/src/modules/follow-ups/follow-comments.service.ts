import { Injectable } from '@nestjs/common'
import type { MessageTaskEvent } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Client } from '../../prisma/prisma8-client'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { prisma8Id32, prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { FollowCommentServiceBase } from './follow-comment.service-base'
import { type FollowRecord, FollowUpsService } from './follow-ups.service'

type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]

@Injectable()
export class FollowCommentsService extends FollowCommentServiceBase<FollowRecord> {
  protected readonly resourceLabel = '跟进记录评论'
  protected readonly notificationType = 'follow_record_comment'
  protected readonly notificationTitle = '跟进记录'

  constructor(
    prisma8: Prisma8Service,
    private readonly followUps: FollowUpsService,
    notifications: BusinessNotificationsService,
  ) {
    super(prisma8, notifications)
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
      organizationId: prisma8Varchar(tenantId, 32),
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
      .where({ organizationId: prisma8Varchar(tenantId, 32), resourceId })
      .where((row) => row.parentId.in(prisma8Varchars(parentIds, 32)))
      .orderBy((row) => row.createTime.asc())
      .all()
    return rows.map((row) => this.toCommentRow(row))
  }

  protected findComment(tenantId: string, id: string) {
    return this.comments()
      .where({ id: prisma8Varchar(id, 32), organizationId: prisma8Varchar(tenantId, 32) })
      .first()
      .then((row) => (row ? this.toCommentRow(row) : null))
  }

  protected findReplyParent(tenantId: string, resourceId: string, parentId: string) {
    return this.comments()
      .where({
        id: prisma8Varchar(parentId, 32),
        organizationId: prisma8Varchar(tenantId, 32),
        resourceId,
      })
      .select('id', 'parentId')
      .first()
  }

  protected createComment(
    tx: Prisma8Transaction,
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
      id: prisma8Id32(),
      resourceId: input.resourceId,
      parentId: input.parentId ? prisma8Varchar(input.parentId, 32) : null,
      replyToUserId: input.replyToUserId ? prisma8Varchar(input.replyToUserId, 32) : null,
      content: prisma8Varchar(input.content, 3000),
      organizationId: prisma8Varchar(input.tenantId, 32),
      createUser: prisma8Varchar(input.createdById, 32),
      updateUser: prisma8Varchar(input.updatedById, 32),
      updateTime: prisma8Now(),
    }).then((row) => this.toCommentRow(row))
  }

  protected updateComment(
    tx: Prisma8Transaction,
    id: string,
    content: string,
    updatedById: string,
  ) {
    return tx.orm.public.FollowUpRecordComment.where({ id: prisma8Varchar(id, 32) })
      .update({
        content: prisma8Varchar(content, 3000),
        updateUser: prisma8Varchar(updatedById, 32),
        updateTime: prisma8Now(),
      })
      .then((row) => {
        if (!row) throw new Error('评论不存在')
        return this.toCommentRow(row)
      })
  }

  protected async deleteComment(tx: Prisma8Transaction, id: string): Promise<void> {
    await tx.orm.public.FollowUpRecordComment.where({ id: prisma8Varchar(id, 32) }).delete()
  }

  protected async replaceMentions(
    tx: Prisma8Transaction,
    commentId: string,
    userIds: string[],
  ) {
    await tx.orm.public.FollowUpRecordCommentMention.where({
      commentId: prisma8Varchar(commentId, 32),
    }).deleteAndCount()
    if (!userIds.length) return
    await tx.orm.public.FollowUpRecordCommentMention.createAll(
      userIds.map((userId) => ({
        id: prisma8Id32(),
        commentId: prisma8Varchar(commentId, 32),
        userId: prisma8Varchar(userId, 32),
      })),
    )
  }

  protected async loadMentions(commentIds: string[]) {
    return await this.prisma8.client.orm.public.FollowUpRecordCommentMention.where((row) =>
      row.commentId.in(prisma8Varchars(commentIds, 32)),
    )
      .select('commentId', 'userId')
      .all()
  }

  protected async recount(tx: Prisma8Transaction, tenantId: string, resourceId: string) {
    const { count: commentCount } = await tx.orm.public.FollowUpRecordComment.where({
      organizationId: prisma8Varchar(tenantId, 32),
      resourceId,
    }).aggregate((aggregate) => ({ count: aggregate.count() }))
    await tx.orm.public.FollowUpRecords.where({ id: resourceId, tenantId }).update({
      commentCount,
      updatedAt: prisma8Now(),
    })
    return commentCount
  }

  private comments() {
    return this.prisma8.client.orm.public.FollowUpRecordComment
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
