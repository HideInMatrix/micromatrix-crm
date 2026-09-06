import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { FollowUpPlan, FollowUpRecord } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { FollowUpsService } from './follow-ups.service'

const user: AuthUser = {
  id: 'owner-1',
  tenantId: 'tenant-1',
  email: 'owner@example.com',
  name: '负责人',
  deptId: 'dept-1',
  leaderId: null,
  roles: [],
  permissions: ['*'],
}

function sourcePlan(): FollowUpPlan {
  return {
    id: 'plan-1',
    tenantId: user.tenantId,
    targetType: 'customer',
    targetId: 'customer-1',
    contactId: null,
    content: '计划内容',
    method: '电话',
    estimatedAt: null,
    status: 'COMPLETED',
    converted: false,
    convertedRecordId: null,
    ownerId: user.id,
    deptId: user.deptId,
    createdById: 'creator-1',
    dueNotifiedAt: null,
    commentCount: 0,
    customData: {},
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  }
}

function record(): FollowUpRecord {
  return {
    id: 'record-1',
    tenantId: user.tenantId,
    targetType: 'customer',
    targetId: 'customer-1',
    contactId: null,
    type: null,
    content: '最终记录内容',
    followedAt: new Date('2026-09-06T10:00:00.000Z'),
    ownerId: user.id,
    ownerName: user.name,
    deptId: user.deptId,
    createdById: user.id,
    commentCount: 0,
    createdAt: new Date('2026-09-06T10:00:00.000Z'),
    updatedAt: new Date('2026-09-06T10:00:00.000Z'),
  }
}

test('sourcePlanId 创建记录时在同一事务完成 claim、Field/Blob、目标跟进状态与 convertedRecordId', async () => {
  const calls: string[] = []
  const created = record()
  const tx = {
    followUpPlan: {
      updateMany: async () => {
        calls.push('claim')
        return { count: 1 }
      },
      update: async () => {
        calls.push('link')
        return sourcePlan()
      },
    },
    followUpRecord: {
      create: async () => {
        calls.push('record')
        return created
      },
    },
    customer: {
      updateMany: async () => {
        calls.push('touch')
        return { count: 1 }
      },
    },
    clue: { updateMany: async () => ({ count: 0 }) },
    opportunity: { updateMany: async () => ({ count: 0 }) },
  }
  const prisma = {
    followUpPlan: { findFirst: async () => sourcePlan() },
    customer: { findMany: async () => [{ id: 'customer-1', name: '测试客户' }] },
    $transaction: async (callback: (client: typeof tx) => Promise<FollowUpRecord>) => callback(tx),
  }
  const service = new FollowUpsService(
    prisma as unknown as PrismaService,
    {
      assertFollowWrite: async () => ({ customer: { inSharedPool: false } }),
    } as never,
    {} as never,
    {} as never,
    { listFields: async () => [] } as never,
    {
      save: async () => {
        calls.push('fields')
      },
      load: async () => new Map([['record-1', {}]]),
    } as never,
    {} as never,
    {} as never,
  )

  const result = await service.create(user, {
    targetType: 'customer',
    targetId: 'customer-1',
    content: '最终记录内容',
    sourcePlanId: 'plan-1',
  })

  assert.deepEqual(calls, ['claim', 'record', 'fields', 'touch', 'link'])
  assert.equal(result.id, 'record-1')
  assert.equal(result.content, '最终记录内容')
})

function recordWith(id: string, content: string): FollowUpRecord {
  return { ...record(), id, content }
}

test('统一 page 使用 FOLLOW_RECORD 视图，并正确执行系统字段 + 动态字段 OR/AND 后与视图取交集', async () => {
  const rows = [recordWith('record-system', 'alpha'), recordWith('record-custom', 'beta')]
  const fields = [
    { id: 'field-content', key: 'content', label: '跟进内容', type: 'textarea', system: true },
    { id: 'field-target-type', key: 'targetType', label: '关联类型', type: 'select', system: true },
    { id: 'field-source', key: 'cf_source', label: '来源', type: 'text', system: false },
  ]
  let resourceType = ''
  let finalWhere: Record<string, unknown> | undefined
  interface FindArgs {
    select?: { id?: boolean }
    where?: Record<string, unknown>
  }
  const prisma = {
    customer: { findMany: async () => [{ id: 'customer-1', name: '测试客户' }] },
    followUpRecord: {
      findMany: async (args: FindArgs) => {
        if (args.select?.id) {
          if (args.where?.targetType === 'customer')
            return [{ id: 'record-system' }, { id: 'record-custom' }]
          if (args.where?.content) return [{ id: 'record-system' }]
          return []
        }
        finalWhere = args.where
        const and = (args.where?.AND ?? []) as Array<Record<string, unknown>>
        const idClause = and.find((item) => 'id' in item) as { id?: { in?: string[] } } | undefined
        const ids = idClause?.id?.in
        return ids ? rows.filter((item) => ids.includes(item.id)) : rows
      },
      count: async () => 2,
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  }
  const service = new FollowUpsService(
    prisma as unknown as PrismaService,
    { assertFollowRead: async () => ({ customer: { inSharedPool: false } }) } as never,
    {} as never,
    {} as never,
    { listFields: async () => fields } as never,
    {
      filterResourceIds: async () => ['record-custom'],
      load: async () => new Map(rows.map((item) => [item.id, {}])),
    } as never,
    {
      resolveFilters: async (_user: AuthUser, _id: string, type: string) => {
        resourceType = type
        return {
          searchMode: 'AND' as const,
          conditions: [{ key: 'targetType', op: 'eq' as const, value: 'customer' }],
        }
      },
    } as never,
    {} as never,
  )

  const orResult = await service.page(user, {
    page: 1,
    pageSize: 20,
    targetType: 'customer',
    targetId: 'customer-1',
    viewId: 'view-1',
    filters: [
      { key: 'content', op: 'contains', value: 'alpha' },
      { key: 'cf_source', op: 'eq', value: 'referral' },
    ],
    filterMode: 'OR',
  })
  assert.equal(resourceType, 'FOLLOW_RECORD')
  assert.deepEqual(orResult.items.map((item) => item.id).sort(), ['record-custom', 'record-system'])
  assert.ok(finalWhere)

  const andResult = await service.page(user, {
    page: 1,
    pageSize: 20,
    targetType: 'customer',
    targetId: 'customer-1',
    filters: [
      { key: 'content', op: 'contains', value: 'alpha' },
      { key: 'cf_source', op: 'eq', value: 'referral' },
    ],
    filterMode: 'AND',
  })
  assert.deepEqual(andResult.items, [])
})

test('全局 page 按目标对象 DataScope/公海/协作构造访问边界，并与高级筛选保持 AND 收缩', async () => {
  const scopedUser: AuthUser = {
    ...user,
    permissions: [
      'menu:lead',
      'leadPool:read',
      'customer:read',
      'customerPool:read',
      'menu:opportunity',
    ],
  }
  let finalWhere: Record<string, unknown> | undefined
  const prisma = {
    clue: {
      findMany: async (args: { where?: { inSharedPool?: boolean } }) =>
        args.where?.inSharedPool ? [{ id: 'lead-pool' }] : [{ id: 'lead-direct' }],
    },
    customer: {
      findMany: async (args: { where?: { inSharedPool?: boolean } }) =>
        args.where?.inSharedPool ? [{ id: 'customer-pool' }] : [{ id: 'customer-direct' }],
    },
    customerCollaboration: { findMany: async () => [{ customerId: 'customer-collab' }] },
    opportunity: { findMany: async () => [{ id: 'opportunity-direct' }] },
    followUpRecord: {
      findMany: async (args: { select?: { id?: boolean }; where?: Record<string, unknown> }) => {
        if (args.select?.id) return []
        finalWhere = args.where
        return []
      },
      count: async () => 0,
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  }
  const service = new FollowUpsService(
    prisma as unknown as PrismaService,
    {} as never,
    { directOwnerFilter: async () => ({ owner: scopedUser.id }) } as never,
    {
      options: async (_user: AuthUser, type: string) =>
        type === 'lead' ? [{ id: 'lead-pool-1' }] : [{ id: 'customer-pool-1' }],
    } as never,
    {
      listFields: async () => [
        { id: 'field-custom', key: 'cf_source', label: '来源', type: 'text', system: false },
      ],
    } as never,
    { filterResourceIds: async () => ['record-outside-scope'] } as never,
    {} as never,
    {} as never,
  )

  await service.page(scopedUser, {
    page: 1,
    pageSize: 20,
    filters: [{ key: 'cf_source', op: 'eq', value: 'outside' }],
    filterMode: 'AND',
  })

  assert.ok(finalWhere)
  const and = (finalWhere?.AND ?? []) as Array<Record<string, unknown>>
  const access = and[0] as { OR?: Array<Record<string, unknown>> }
  const filter = and.find((item) => 'id' in item) as { id?: { in?: string[] } } | undefined
  assert.deepEqual(filter?.id?.in, ['record-outside-scope'])
  assert.deepEqual(access.OR, [
    { targetType: 'lead', targetId: { in: ['lead-direct', 'lead-pool'] } },
    {
      targetType: 'customer',
      targetId: { in: ['customer-direct', 'customer-collab', 'customer-pool'] },
    },
    { targetType: 'opportunity', targetId: { in: ['opportunity-direct'] } },
  ])
})

test('池中线索缺少 poolId 时跟进访问 fail-closed', async () => {
  const poolUser: AuthUser = { ...user, permissions: ['leadPool:read'] }
  const service = new FollowUpsService(
    {
      clue: {
        findFirst: async () => ({ owner: null, inSharedPool: true, poolId: null }),
      },
    } as unknown as PrismaService,
    {} as never,
    {} as never,
    { options: async () => [{ id: 'pool-1' }] } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )

  await assert.rejects(
    () => service.assertTargetAccess(poolUser, 'lead', 'lead-1', false),
    /线索不存在或无权访问/,
  )
})

test('FollowRecord page 支持动态标量字段排序，并拒绝复杂字段伪排序', async () => {
  const rows = [recordWith('record-high', 'high'), recordWith('record-low', 'low')]
  const numberField = {
    id: 'field-score',
    key: 'cf_score',
    label: '评分',
    type: 'number' as const,
    system: false,
  }
  const textareaField = {
    id: 'field-note',
    key: 'cf_note',
    label: '长备注',
    type: 'textarea' as const,
    system: false,
  }
  const prisma = {
    customer: { findMany: async () => [{ id: 'customer-1', name: '测试客户' }] },
    followUpRecord: {
      findMany: async (args: { select?: { id?: boolean }; where?: { id?: { in?: string[] } } }) => {
        if (args.select?.id) return rows.map((item) => ({ id: item.id }))
        const ids = args.where?.id?.in ?? []
        return rows.filter((item) => ids.includes(item.id))
      },
    },
    followUpRecordField: {
      findMany: async () => [
        { resourceId: 'record-high', fieldValue: '20' },
        { resourceId: 'record-low', fieldValue: '3' },
      ],
    },
    followUpRecordFieldBlob: { findMany: async () => [] },
  }
  const service = new FollowUpsService(
    prisma as unknown as PrismaService,
    { assertFollowRead: async () => ({ customer: { inSharedPool: false } }) } as never,
    {} as never,
    {} as never,
    { listFields: async () => [numberField, textareaField] } as never,
    { load: async () => new Map(rows.map((item) => [item.id, {}])) } as never,
    {} as never,
    {} as never,
  )

  const result = await service.page(user, {
    targetType: 'customer',
    targetId: 'customer-1',
    page: 1,
    pageSize: 20,
    sort: { name: numberField.id, type: 'asc' },
  })
  assert.deepEqual(
    result.items.map((item) => item.id),
    ['record-low', 'record-high'],
  )

  await assert.rejects(
    () =>
      service.page(user, {
        targetType: 'customer',
        targetId: 'customer-1',
        page: 1,
        pageSize: 20,
        sort: { name: textareaField.id, type: 'asc' },
      }),
    /不支持排序/,
  )
})
