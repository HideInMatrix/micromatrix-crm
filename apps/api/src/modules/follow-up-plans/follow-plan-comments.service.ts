import { Injectable } from '@nestjs/common'
import type { MessageTaskEvent } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { FollowUpPlan, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { FollowCommentServiceBase } from '../follow-ups/follow-comment.service-base'
import { FollowUpPlansService } from './follow-up-plans.service'

@Injectable()
export class FollowPlanCommentsService extends FollowCommentServiceBase<FollowUpPlan> {
  protected readonly resourceLabel = '跟进计划评论'
  protected readonly notificationType = 'follow_plan_comment'
  protected readonly notificationTitle = '跟进计划'

  constructor(
    prisma: PrismaService,
    private readonly plans: FollowUpPlansService,
    notifications: BusinessNotificationsService,
  ) {
    super(prisma, notifications)
  }

  protected assertResourceAccess(user: AuthUser, resourceId: string, write: boolean) {
    return this.plans.assertPlanAccess(user, resourceId, write)
  }

  protected async loadParents(
    tenantId: string,
    resourceId: string,
    page: number,
    pageSize: number,
  ) {
    const where = { tenantId, resourceId, parentId: null }
    const [parents, total] = await this.prisma.$transaction([
      this.prisma.followUpPlanComment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.followUpPlanComment.count({ where }),
    ])
    return { parents, total }
  }

  protected loadReplies(tenantId: string, resourceId: string, parentIds: string[]) {
    return this.prisma.followUpPlanComment.findMany({
      where: { tenantId, resourceId, parentId: { in: parentIds } },
      orderBy: { createdAt: 'asc' },
    })
  }

  protected findComment(tenantId: string, id: string) {
    return this.prisma.followUpPlanComment.findFirst({ where: { id, tenantId } })
  }

  protected findReplyParent(tenantId: string, resourceId: string, parentId: string) {
    return this.prisma.followUpPlanComment.findFirst({
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
    return tx.followUpPlanComment.create({ data: input })
  }

  protected updateComment(
    tx: Prisma.TransactionClient,
    id: string,
    content: string,
    updatedById: string,
  ) {
    return tx.followUpPlanComment.update({ where: { id }, data: { content, updatedById } })
  }

  protected async deleteComment(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.followUpPlanComment.delete({ where: { id } })
  }

  protected async replaceMentions(
    tx: Prisma.TransactionClient,
    commentId: string,
    userIds: string[],
  ) {
    await tx.followUpPlanCommentMention.deleteMany({ where: { commentId } })
    if (!userIds.length) return
    await tx.followUpPlanCommentMention.createMany({
      data: userIds.map((userId) => ({ commentId, userId })),
      skipDuplicates: true,
    })
  }

  protected loadMentions(commentIds: string[]) {
    return this.prisma.followUpPlanCommentMention.findMany({
      where: { commentId: { in: commentIds } },
      select: { commentId: true, userId: true },
    })
  }

  protected async recount(tx: Prisma.TransactionClient, tenantId: string, resourceId: string) {
    const commentCount = await tx.followUpPlanComment.count({ where: { tenantId, resourceId } })
    await tx.followUpPlan.update({ where: { id: resourceId }, data: { commentCount } })
    return commentCount
  }

  protected commentEvent(plan: FollowUpPlan, mentioned: boolean): MessageTaskEvent {
    if (plan.targetType === 'lead') {
      return mentioned
        ? 'CLUE_FOLLOW_UP_PLAN_COMMENT_MENTIONED'
        : 'CLUE_FOLLOW_UP_PLAN_COMMENT_ADDED'
    }
    if (plan.targetType === 'opportunity') {
      return mentioned
        ? 'OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_MENTIONED'
        : 'OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_ADDED'
    }
    return mentioned
      ? 'CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED'
      : 'CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED'
  }
}
