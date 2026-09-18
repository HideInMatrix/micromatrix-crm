import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { MessageTaskEvent } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { OPERATION_LOG_RESULT_META } from '../../common/decorators/log-operation.decorator'
import { prisma8TimestampFromDate } from '../../prisma/prisma8-temporal'
import {
  createFollowCommentPrisma8Harness,
  type HarnessUser,
} from '../follow-ups/follow-comment.prisma8-test-harness'
import type { FollowCommentRow as FollowUpPlanComment } from '../follow-ups/follow-comment.service-base'
import { FollowPlanCommentsService } from './follow-plan-comments.service'
import type { FollowUpPlan } from './follow-up-plans.service'

const instant = (value: string) => prisma8TimestampFromDate(new Date(value))

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
    estimatedAt: instant('2026-09-07T03:00:00.000Z'),
    status: 'PREPARED',
    converted: false,
    convertedRecordId: null,
    ownerId: 'owner-1',
    deptId: 'dept-1',
    createdById: user.id,
    dueNotifiedAt: null,
    commentCount: 0,
    customData: {},
    createdAt: instant('2026-09-06T03:00:00.000Z'),
    updatedAt: instant('2026-09-06T03:00:00.000Z'),
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
    createdAt: instant('2026-09-06T04:00:00.000Z'),
    updatedAt: instant('2026-09-06T04:00:00.000Z'),
    ...overrides,
  }
}

function member(id: string, overrides: Partial<HarnessUser> = {}): HarnessUser {
  return { id, ...overrides }
}

test('FollowPlan 评论原子写 Comment/Mention/commentCount，并通知负责人和 mention/reply', async () => {
  const notifications: Array<{ event: string; recipientIds: Array<string | null | undefined> }> = []
  const harness = createFollowCommentPrisma8Harness({
    kind: 'plan',
    tenantId: user.tenantId,
    nextCreatedId: 'comment-1',
    comments: [comment({ id: 'parent-1' })],
    users: [member(user.id), member('mention-1'), member('reply-1')],
  })
  const service = new FollowPlanCommentsService(
    harness.prisma8,
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

  assert.deepEqual(harness.calls, [
    'comment',
    'mention-delete',
    'mention-create',
    'count',
    'plan-count',
  ])
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
  const harness = createFollowCommentPrisma8Harness({
    kind: 'plan',
    tenantId: user.tenantId,
    comments: [comment({ id: 'reply-1', parentId: 'parent-1' })],
    users: [member('user-2')],
  })
  const service = new FollowPlanCommentsService(
    harness.prisma8,
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
  const harness = createFollowCommentPrisma8Harness({
    kind: 'plan',
    tenantId: user.tenantId,
    comments: [comment({ createdById: 'other-user' })],
  })
  const service = new FollowPlanCommentsService(harness.prisma8, {} as never, {} as never)

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
  const harness = createFollowCommentPrisma8Harness({
    kind: 'plan',
    tenantId: user.tenantId,
    comments: [parent, reply],
    mentions: [{ commentId: reply.id, userId: 'mention-user' }],
    users: [member(user.id), member('reply-user'), member('mention-user')],
  })
  const service = new FollowPlanCommentsService(
    harness.prisma8,
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
  const harness = createFollowCommentPrisma8Harness({ kind: 'plan', tenantId: user.tenantId })
  const service = new FollowPlanCommentsService(harness.prisma8, {} as never, {} as never)
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
