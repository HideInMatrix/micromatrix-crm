import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { OPERATION_LOG_RESULT_META } from '../../common/decorators/log-operation.decorator'
import type { AuthUser } from '../../common/auth-user'
import { prisma8TimestampFromDate } from '../../prisma/prisma8-temporal'
import {
  createFollowCommentPrisma8Harness,
  type HarnessUser,
} from './follow-comment.prisma8-test-harness'
import type { FollowCommentRow as FollowUpRecordComment } from './follow-comment.service-base'
import { FollowCommentsService } from './follow-comments.service'
import type { FollowRecord as FollowUpRecord } from './follow-ups.service'

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

function record(overrides: Partial<FollowUpRecord> = {}): FollowUpRecord {
  return {
    id: 'record-1',
    tenantId: user.tenantId,
    targetType: 'customer',
    targetId: 'customer-1',
    contactId: null,
    type: '电话',
    content: '跟进记录',
    followedAt: instant('2026-09-06T03:00:00.000Z'),
    ownerId: 'owner-1',
    ownerName: '负责人',
    deptId: 'dept-1',
    createdById: user.id,
    commentCount: 0,
    createdAt: instant('2026-09-06T03:00:00.000Z'),
    updatedAt: instant('2026-09-06T03:00:00.000Z'),
    ...overrides,
  }
}

function comment(overrides: Partial<FollowUpRecordComment> = {}): FollowUpRecordComment {
  return {
    id: 'comment-1',
    resourceId: 'record-1',
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

test('新增评论原子写 Comment/Mention/commentCount，并分别发送负责人和 mention/reply 事件', async () => {
  const notifications: Array<{ event: string; recipientIds: Array<string | null | undefined> }> = []
  const harness = createFollowCommentPrisma8Harness({
    kind: 'record',
    tenantId: user.tenantId,
    nextCreatedId: 'comment-1',
    comments: [comment({ id: 'parent-1' })],
    users: [member(user.id), member('mention-1'), member('reply-1')],
  })
  const service = new FollowCommentsService(
    harness.prisma8,
    { assertRecordAccess: async () => record() } as never,
    {
      send: async (input: { event: string; recipientIds: Array<string | null | undefined> }) => {
        notifications.push(input)
        return input.recipientIds.length
      },
    } as never,
  )

  const result = await service.add(user, {
    resourceId: 'record-1',
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
    'record-count',
  ])
  assert.equal(result.content, '评论内容')
  assert.deepEqual(
    notifications.map((item) => [item.event, item.recipientIds]),
    [
      ['CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED', ['owner-1']],
      ['CUSTOMER_FOLLOW_UP_RECORD_COMMENT_MENTIONED', ['mention-1', 'reply-1']],
    ],
  )
  const logMeta = (result as typeof result & { [OPERATION_LOG_RESULT_META]?: unknown })[
    OPERATION_LOG_RESULT_META
  ] as { targetId: string; detail: { commentId: string; content: string } }
  assert.equal(logMeta.targetId, 'record-1')
  assert.equal(logMeta.detail.commentId, 'comment-1')
  assert.equal(logMeta.detail.content, '评论内容')
  assert.equal(JSON.stringify(result).includes('operationLogResultMeta'), false)
})

test('回复只允许挂在顶层评论，禁止形成第三级', async () => {
  const harness = createFollowCommentPrisma8Harness({
    kind: 'record',
    tenantId: user.tenantId,
    comments: [comment({ id: 'reply-1', parentId: 'parent-1' })],
    users: [member('user-2')],
  })
  const service = new FollowCommentsService(
    harness.prisma8,
    { assertRecordAccess: async () => record() } as never,
    {} as never,
  )

  await assert.rejects(
    () =>
      service.add(user, {
        resourceId: 'record-1',
        parentId: 'reply-1',
        replyToUserId: 'user-2',
        content: '第三级回复',
      }),
    BadRequestException,
  )
})

test('mention 必须全部属于当前租户 ACTIVE 用户', async () => {
  const harness = createFollowCommentPrisma8Harness({
    kind: 'record',
    tenantId: user.tenantId,
    users: [member('valid-user')],
  })
  const service = new FollowCommentsService(
    harness.prisma8,
    { assertRecordAccess: async () => record() } as never,
    {} as never,
  )

  await assert.rejects(
    () =>
      service.add(user, {
        resourceId: 'record-1',
        content: '测试跨租户 mention',
        mentionedUserIds: ['valid-user', 'foreign-user'],
      }),
    BadRequestException,
  )
})

test('编辑评论只允许创建人，并在日志元数据中保留正文 before/after', async () => {
  const own = comment({ content: '旧内容' })
  const harness = createFollowCommentPrisma8Harness({
    kind: 'record',
    tenantId: user.tenantId,
    comments: [own],
    users: [member(user.id)],
  })
  const service = new FollowCommentsService(
    harness.prisma8,
    { assertRecordAccess: async () => record({ ownerId: user.id }) } as never,
    { send: async () => 0 } as never,
  )
  const result = await service.update(user, {
    id: own.id,
    content: '新内容',
    mentionedUserIds: [],
  })
  const logMeta = (result as typeof result & { [OPERATION_LOG_RESULT_META]?: unknown })[
    OPERATION_LOG_RESULT_META
  ] as { detail: { before: { content: string }; after: { content: string } } }
  assert.equal(logMeta.detail.before.content, '旧内容')
  assert.equal(logMeta.detail.after.content, '新内容')

  const foreignHarness = createFollowCommentPrisma8Harness({
    kind: 'record',
    tenantId: user.tenantId,
    comments: [comment({ createdById: 'other-user' })],
  })
  const foreignService = new FollowCommentsService(foreignHarness.prisma8, {} as never, {} as never)
  await assert.rejects(
    () => foreignService.update(user, { id: 'comment-1', content: '越权修改' }),
    ForbiddenException,
  )
})

test('分页只统计顶层 total，但 commentCount 包含回复并批量装配 replies/mentions', async () => {
  const parent = comment({ id: 'parent-1' })
  const reply = comment({
    id: 'reply-1',
    parentId: 'parent-1',
    createdById: 'reply-user',
    replyToUserId: user.id,
  })
  const harness = createFollowCommentPrisma8Harness({
    kind: 'record',
    tenantId: user.tenantId,
    comments: [parent, reply],
    mentions: [{ commentId: reply.id, userId: 'mention-user' }],
    users: [member(user.id), member('reply-user'), member('mention-user')],
  })
  const service = new FollowCommentsService(
    harness.prisma8,
    { assertRecordAccess: async () => record({ commentCount: 2 }) } as never,
    {} as never,
  )
  const result = await service.page(user, { resourceId: 'record-1', page: 1, pageSize: 10 })
  assert.equal(result.total, 1)
  assert.equal(result.commentCount, 2)
  assert.equal(result.items[0].replyCount, 1)
  assert.equal(result.items[0].replies[0].mentionUsers[0].id, 'mention-user')
})
