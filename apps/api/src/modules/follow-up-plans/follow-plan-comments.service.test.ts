import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { MessageTaskEvent } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { OPERATION_LOG_RESULT_META } from '../../common/decorators/log-operation.decorator'
import type { FollowUpPlan, FollowUpPlanComment } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { FollowPlanCommentsService } from './follow-plan-comments.service'

const user: AuthUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'user-1@example.com',
  name: '操作人',
  deptId: 'dept-1',
  leaderId: null,
  roles: [],
  permissions: ['*'],
}

function plan(overrides: Partial<FollowUpPlan> = {}): FollowUpPlan {
  return {
    id: 'plan-1',
    tenantId: user.tenantId,
    targetType: 'customer',
    targetId: 'customer-1',
    contactId: null,
    content: '跟进计划',
    method: '电话',
    estimatedAt: new Date('2026-09-07T03:00:00.000Z'),
    status: 'PREPARED',
    converted: false,
    convertedRecordId: null,
    ownerId: 'owner-1',
    deptId: 'dept-1',
    createdById: user.id,
    dueNotifiedAt: null,
    commentCount: 0,
    customData: {},
    createdAt: new Date('2026-09-06T03:00:00.000Z'),
    updatedAt: new Date('2026-09-06T03:00:00.000Z'),
    ...overrides,
  }
}

function comment(overrides: Partial<FollowUpPlanComment> = {}): FollowUpPlanComment {
  return {
    id: 'comment-1',
    resourceId: 'plan-1',
    parentId: null,
    replyToUserId: null,
    content: '评论内容',
    tenantId: user.tenantId,
    createdById: user.id,
    updatedById: user.id,
    createdAt: new Date('2026-09-06T04:00:00.000Z'),
    updatedAt: new Date('2026-09-06T04:00:00.000Z'),
    ...overrides,
  }
}

function users(ids: string[]) {
  return ids.map((id) => ({
    id,
    name: `成员-${id}`,
    status: 'ACTIVE' as const,
    extension: { avatar: null },
  }))
}

test('FollowPlan 评论原子写 Comment/Mention/commentCount，并通知负责人和 mention/reply', async () => {
  const notifications: Array<{ event: string; recipientIds: Array<string | null | undefined> }> = []
  const calls: string[] = []
  const created = comment({ replyToUserId: 'reply-1' })
  const tx = {
    followUpPlanComment: {
      create: async () => {
        calls.push('comment')
        return created
      },
      count: async () => {
        calls.push('count')
        return 1
      },
    },
    followUpPlanCommentMention: {
      deleteMany: async () => {
        calls.push('mention-delete')
        return { count: 0 }
      },
      createMany: async () => {
        calls.push('mention-create')
        return { count: 1 }
      },
    },
    followUpPlan: {
      update: async () => {
        calls.push('plan-count')
        return plan({ commentCount: 1 })
      },
    },
  }
  const prisma = {
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => users(where.id.in),
      findFirst: async () => ({ id: 'reply-1' }),
    },
    followUpPlanComment: {
      findFirst: async () => ({ id: 'parent-1', parentId: null }),
    },
    followUpPlanCommentMention: {
      findMany: async () => [{ commentId: created.id, userId: 'mention-1' }],
    },
    customer: { findFirst: async () => ({ name: '客户A' }) },
    clue: { findFirst: async () => null },
    opportunity: { findFirst: async () => null },
    $transaction: async (callback: (client: typeof tx) => Promise<FollowUpPlanComment>) =>
      callback(tx),
  }
  const service = new FollowPlanCommentsService(
    prisma as unknown as PrismaService,
    { assertPlanAccess: async () => plan() } as never,
    {
      send: async (input: { event: string; recipientIds: Array<string | null | undefined> }) => {
        notifications.push(input)
        return input.recipientIds.length
      },
    } as never,
  )

  const result = await service.add(user, {
    resourceId: 'plan-1',
    parentId: 'parent-1',
    replyToUserId: 'reply-1',
    content: '  评论内容  ',
    mentionedUserIds: ['mention-1', 'mention-1'],
  })

  assert.deepEqual(calls, ['comment', 'mention-delete', 'mention-create', 'count', 'plan-count'])
  assert.equal(result.content, '评论内容')
  assert.deepEqual(
    notifications.map((item) => [item.event, item.recipientIds]),
    [
      ['CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED', ['owner-1']],
      ['CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED', ['mention-1', 'reply-1']],
    ],
  )
  const logMeta = (result as typeof result & { [OPERATION_LOG_RESULT_META]?: unknown })[
    OPERATION_LOG_RESULT_META
  ] as { targetId: string; detail: { commentId: string; content: string } }
  assert.equal(logMeta.targetId, 'plan-1')
  assert.equal(logMeta.detail.commentId, 'comment-1')
  assert.equal(logMeta.detail.content, '评论内容')
})

test('FollowPlan 回复只允许挂在顶层评论', async () => {
  const service = new FollowPlanCommentsService(
    {
      user: { findMany: async () => [], findFirst: async () => ({ id: 'user-2' }) },
      followUpPlanComment: {
        findFirst: async () => ({ id: 'reply-1', parentId: 'parent-1' }),
      },
    } as unknown as PrismaService,
    { assertPlanAccess: async () => plan() } as never,
    {} as never,
  )

  await assert.rejects(
    () =>
      service.add(user, {
        resourceId: 'plan-1',
        parentId: 'reply-1',
        replyToUserId: 'user-2',
        content: '第三级回复',
      }),
    BadRequestException,
  )
})

test('FollowPlan 评论只有创建人可编辑', async () => {
  const service = new FollowPlanCommentsService(
    {
      followUpPlanComment: { findFirst: async () => comment({ createdById: 'other-user' }) },
    } as unknown as PrismaService,
    {} as never,
    {} as never,
  )

  await assert.rejects(
    () => service.update(user, { id: 'comment-1', content: '越权修改' }),
    ForbiddenException,
  )
})

test('FollowPlan 评论分页只统计顶层 total，commentCount 包含回复', async () => {
  const parent = comment({ id: 'parent-1' })
  const reply = comment({
    id: 'reply-1',
    parentId: 'parent-1',
    createdById: 'reply-user',
    replyToUserId: user.id,
  })
  const prisma = {
    followUpPlanComment: {
      findMany: async ({ where }: { where: { parentId: null | { in: string[] } } }) =>
        where.parentId === null ? [parent] : [reply],
      count: async () => 1,
    },
    followUpPlanCommentMention: {
      findMany: async () => [{ commentId: reply.id, userId: 'mention-user' }],
    },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => users(where.id.in),
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  }
  const service = new FollowPlanCommentsService(
    prisma as unknown as PrismaService,
    { assertPlanAccess: async () => plan({ commentCount: 2 }) } as never,
    {} as never,
  )
  const result = await service.page(user, { resourceId: 'plan-1', page: 1, pageSize: 10 })
  assert.equal(result.total, 1)
  assert.equal(result.commentCount, 2)
  assert.equal(result.items[0].replyCount, 1)
  assert.equal(result.items[0].replies[0].mentionUsers[0].id, 'mention-user')
})

test('FollowPlan 评论事件按 customer/lead/opportunity 与 added/mentioned 六类映射', () => {
  const service = new FollowPlanCommentsService({} as PrismaService, {} as never, {} as never)
  const event = (resource: FollowUpPlan, mentioned: boolean): MessageTaskEvent =>
    (
      service as unknown as {
        commentEvent(plan: FollowUpPlan, mentioned: boolean): MessageTaskEvent
      }
    ).commentEvent(resource, mentioned)

  assert.equal(
    event(plan({ targetType: 'customer' }), false),
    'CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED',
  )
  assert.equal(
    event(plan({ targetType: 'customer' }), true),
    'CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED',
  )
  assert.equal(event(plan({ targetType: 'lead' }), false), 'CLUE_FOLLOW_UP_PLAN_COMMENT_ADDED')
  assert.equal(event(plan({ targetType: 'lead' }), true), 'CLUE_FOLLOW_UP_PLAN_COMMENT_MENTIONED')
  assert.equal(
    event(plan({ targetType: 'opportunity' }), false),
    'OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_ADDED',
  )
  assert.equal(
    event(plan({ targetType: 'opportunity' }), true),
    'OPPORTUNITY_FOLLOW_UP_PLAN_COMMENT_MENTIONED',
  )
})
