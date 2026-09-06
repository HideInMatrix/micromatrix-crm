import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { OPERATION_LOG_RESULT_META } from '../../common/decorators/log-operation.decorator'
import type { AuthUser } from '../../common/auth-user'
import type { FollowUpRecord, FollowUpRecordComment } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { FollowCommentsService } from './follow-comments.service'

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
    followedAt: new Date('2026-09-06T03:00:00.000Z'),
    ownerId: 'owner-1',
    ownerName: '负责人',
    deptId: 'dept-1',
    createdById: user.id,
    commentCount: 0,
    createdAt: new Date('2026-09-06T03:00:00.000Z'),
    updatedAt: new Date('2026-09-06T03:00:00.000Z'),
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

test('新增评论原子写 Comment/Mention/commentCount，并分别发送负责人和 mention/reply 事件', async () => {
  const notifications: Array<{ event: string; recipientIds: Array<string | null | undefined> }> = []
  const calls: string[] = []
  const created = comment({ replyToUserId: 'reply-1' })
  const tx = {
    followUpRecordComment: {
      create: async () => {
        calls.push('comment')
        return created
      },
      count: async () => {
        calls.push('count')
        return 1
      },
    },
    followUpRecordCommentMention: {
      deleteMany: async () => {
        calls.push('mention-delete')
        return { count: 0 }
      },
      createMany: async () => {
        calls.push('mention-create')
        return { count: 1 }
      },
    },
    followUpRecord: {
      update: async () => {
        calls.push('record-count')
        return record({ commentCount: 1 })
      },
    },
  }
  const prisma = {
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => users(where.id.in),
      findFirst: async () => ({ id: 'reply-1' }),
    },
    followUpRecordComment: {
      findFirst: async () => ({ id: 'parent-1', parentId: null }),
    },
    followUpRecordCommentMention: {
      findMany: async () => [{ commentId: created.id, userId: 'mention-1' }],
    },
    customer: { findFirst: async () => ({ name: '客户A' }) },
    clue: { findFirst: async () => null },
    opportunity: { findFirst: async () => null },
    $transaction: async (callback: (client: typeof tx) => Promise<FollowUpRecordComment>) =>
      callback(tx),
  }
  const service = new FollowCommentsService(
    prisma as unknown as PrismaService,
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

  assert.deepEqual(calls, ['comment', 'mention-delete', 'mention-create', 'count', 'record-count'])
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
  const service = new FollowCommentsService(
    {
      user: { findMany: async () => [], findFirst: async () => ({ id: 'user-2' }) },
      followUpRecordComment: {
        findFirst: async () => ({ id: 'reply-1', parentId: 'parent-1' }),
      },
    } as unknown as PrismaService,
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
  const service = new FollowCommentsService(
    {
      user: {
        findMany: async () => [{ id: 'valid-user' }],
      },
    } as unknown as PrismaService,
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
  const updated = comment({ content: '新内容', updatedAt: new Date('2026-09-06T05:00:00.000Z') })
  const tx = {
    followUpRecordComment: { update: async () => updated },
    followUpRecordCommentMention: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
  }
  const prisma = {
    followUpRecordComment: { findFirst: async () => own },
    followUpRecordCommentMention: { findMany: async () => [] },
    user: { findMany: async () => users([user.id]) },
    customer: { findFirst: async () => ({ name: '客户A' }) },
    clue: { findFirst: async () => null },
    opportunity: { findFirst: async () => null },
    $transaction: async (callback: (client: typeof tx) => Promise<FollowUpRecordComment>) =>
      callback(tx),
  }
  const service = new FollowCommentsService(
    prisma as unknown as PrismaService,
    { assertRecordAccess: async () => record({ ownerId: user.id }) } as never,
    { send: async () => 0 } as never,
  )
  const result = await service.update(user, { id: own.id, content: '新内容', mentionedUserIds: [] })
  const logMeta = (result as typeof result & { [OPERATION_LOG_RESULT_META]?: unknown })[
    OPERATION_LOG_RESULT_META
  ] as { detail: { before: { content: string }; after: { content: string } } }
  assert.equal(logMeta.detail.before.content, '旧内容')
  assert.equal(logMeta.detail.after.content, '新内容')

  const foreignService = new FollowCommentsService(
    {
      followUpRecordComment: { findFirst: async () => comment({ createdById: 'other-user' }) },
    } as unknown as PrismaService,
    {} as never,
    {} as never,
  )
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
  const prisma = {
    followUpRecordComment: {
      findMany: async ({ where }: { where: { parentId: null | { in: string[] } } }) =>
        where.parentId === null ? [parent] : [reply],
      count: async () => 1,
    },
    followUpRecordCommentMention: {
      findMany: async () => [{ commentId: reply.id, userId: 'mention-user' }],
    },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => users(where.id.in),
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  }
  const service = new FollowCommentsService(
    prisma as unknown as PrismaService,
    { assertRecordAccess: async () => record({ commentCount: 2 }) } as never,
    {} as never,
  )
  const result = await service.page(user, { resourceId: 'record-1', page: 1, pageSize: 10 })
  assert.equal(result.total, 1)
  assert.equal(result.commentCount, 2)
  assert.equal(result.items[0].replyCount, 1)
  assert.equal(result.items[0].replies[0].mentionUsers[0].id, 'mention-user')
})
