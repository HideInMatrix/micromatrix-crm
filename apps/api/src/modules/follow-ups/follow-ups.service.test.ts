import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { prisma8TimestampFromDate } from '../../prisma/prisma8-temporal.js'
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

function legacyRecord(id = 'record-1', content = '最终记录内容') {
  return {
    id,
    tenantId: user.tenantId,
    targetType: 'customer',
    targetId: 'customer-1',
    contactId: null,
    type: null,
    content,
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

function prisma8Record(id = 'record-1', content = '最终记录内容') {
  const row = legacyRecord(id, content)
  return {
    ...row,
    _type: row.type,
    followedAt: row.followedAt ? prisma8TimestampFromDate(row.followedAt) : null,
    createdAt: prisma8TimestampFromDate(row.createdAt),
    updatedAt: prisma8TimestampFromDate(row.updatedAt),
  }
}

function chain<T>(rows: T[], first: T | null = rows[0] ?? null) {
  const value: any = {
    where: () => value,
    select: () => value,
    orderBy: () => value,
    offset: () => value,
    limit: () => value,
    all: async () => rows,
    first: async () => first,
    aggregate: async () => ({ count: rows.length }),
    update: async () => first,
    updateAndCount: async () => 1,
    delete: async () => 1,
  }
  return value
}

function table<T>(rows: T[], first: T | null = rows[0] ?? null) {
  return { where: () => chain(rows, first) }
}

function customerAccess() {
  return {
    assertFollowRead: async () => ({ customer: { inSharedPool: false } }),
    assertFollowWrite: async () => ({ customer: { inSharedPool: false } }),
  }
}

function baseDeps(prisma8: unknown, overrides: Partial<Record<string, unknown>> = {}) {
  return new FollowUpsService(
    prisma8 as never,
    (overrides.customerAccess ?? customerAccess()) as never,
    (overrides.dataScope ?? {
      directOwnerFilter: async () => ({}),
      matchesDirectOwner: async () => true,
    }) as never,
    (overrides.pools ?? { options: async () => [] }) as never,
    (overrides.moduleForms ?? { listFields: async () => [] }) as never,
    (overrides.fieldValues ?? {
      save: async () => undefined,
      load: async () => new Map(),
      filterResourceIds: async () => [],
    }) as never,
    (overrides.userViews ?? { resolveFilters: async () => null }) as never,
    (overrides.attachments ?? {}) as never,
  )
}

test('sourcePlanId 创建记录时在同一事务完成 claim、Field/Blob、目标跟进状态与 convertedRecordId', async () => {
  const calls: string[] = []
  const sourcePlan = {
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
    createdAt: prisma8TimestampFromDate(new Date('2026-09-01T00:00:00.000Z')),
    updatedAt: prisma8TimestampFromDate(new Date('2026-09-01T00:00:00.000Z')),
  }
  const created = prisma8Record()
  const tx = {
    orm: {
      public: {
        FollowUpPlans: {
          where: () => ({
            updateAndCount: async () => {
              calls.push('claim')
              return 1
            },
            update: async () => {
              calls.push('link')
              return sourcePlan
            },
          }),
        },
        FollowUpRecords: {
          create: async () => {
            calls.push('record')
            return created
          },
        },
        Customer: {
          where: () => ({
            updateAndCount: async () => {
              calls.push('touch')
              return 1
            },
          }),
        },
        Clue: { where: () => ({ updateAndCount: async () => 0 }) },
        Opportunity: { where: () => ({ updateAndCount: async () => 0 }) },
      },
    },
  }
  const prisma8 = {
    client: {
      orm: {
        public: {
          FollowUpPlans: table([sourcePlan]),
          Customer: table([{ id: 'customer-1', name: '测试客户' }]),
          Clue: table([]),
          Opportunity: table([]),
          CustomerContact: table([]),
        },
      },
      transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    },
  }
  const service = baseDeps(prisma8, {
    fieldValues: {
      save: async () => {
        calls.push('fields')
      },
      load: async () => new Map([['record-1', {}]]),
    },
  })

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

test('统一 page 使用 FOLLOW_RECORD 视图并通过 Prisma8 返回跟进记录', async () => {
  const rows = [prisma8Record('record-system', 'alpha'), prisma8Record('record-custom', 'beta')]
  let resourceType = ''
  const prisma8 = {
    client: {
      orm: {
        public: {
          FollowUpRecords: table(rows),
          Customer: table([{ id: 'customer-1', name: '测试客户' }]),
          Clue: table([]),
          Opportunity: table([]),
          CustomerContact: table([]),
        },
      },
    },
  }
  const service = baseDeps(prisma8, {
    moduleForms: { listFields: async () => [] },
    fieldValues: { load: async () => new Map(rows.map((item) => [item.id, {}])), filterResourceIds: async () => [] },
    userViews: {
      resolveFilters: async (_user: AuthUser, _id: string, type: string) => {
        resourceType = type
        return { searchMode: 'AND' as const, conditions: [] }
      },
    },
  })

  const result = await service.page(user, {
    page: 1,
    pageSize: 20,
    targetType: 'customer',
    targetId: 'customer-1',
    viewId: 'view-1',
  })
  assert.equal(resourceType, 'FOLLOW_RECORD')
  assert.deepEqual(result.items.map((item) => item.id), ['record-system', 'record-custom'])
  assert.equal(result.total, 2)
})

test('全局 page 在无可访问目标时返回空集合', async () => {
  const prisma8 = {
    client: {
      orm: {
        public: {
          Clue: table([]),
          Customer: table([]),
          CustomerCollaboration: table([]),
          Opportunity: table([]),
          FollowUpRecords: table([]),
          CustomerContact: table([]),
        },
      },
    },
  }
  const scopedUser: AuthUser = {
    ...user,
    permissions: ['menu:lead', 'leadPool:read', 'customer:read', 'customerPool:read', 'menu:opportunity'],
  }
  const service = baseDeps(prisma8, {
    dataScope: { directOwnerFilter: async () => ({ owner: scopedUser.id }) },
    pools: { options: async () => [] },
    fieldValues: { load: async () => new Map(), filterResourceIds: async () => [] },
  })
  const result = await service.page(scopedUser, { page: 1, pageSize: 20 })
  assert.equal(result.total, 0)
  assert.deepEqual(result.items, [])
})

test('池中线索缺少 poolId 时跟进访问 fail-closed', async () => {
  const prisma8 = {
    client: {
      orm: {
        public: {
          Clue: table([{ owner: null, inSharedPool: true, poolId: null }]),
        },
      },
    },
  }
  const poolUser: AuthUser = { ...user, permissions: ['leadPool:read'] }
  const service = baseDeps(prisma8, { pools: { options: async () => [{ id: 'pool-1' }] } })
  await assert.rejects(
    () => service.assertTargetAccess(poolUser, 'lead', 'lead-1', false),
    /线索不存在或无权访问/,
  )
})

test('FollowRecord page 支持动态标量字段排序，并拒绝复杂字段伪排序', async () => {
  const rows = [prisma8Record('record-high', 'high'), prisma8Record('record-low', 'low')]
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
  const prisma8 = {
    client: {
      orm: {
        public: {
          FollowUpRecords: table(rows),
          FollowUpRecordField: table([
            { resourceId: 'record-high', fieldValue: '20' },
            { resourceId: 'record-low', fieldValue: '3' },
          ]),
          FollowUpRecordFieldBlob: table([]),
          Customer: table([{ id: 'customer-1', name: '测试客户' }]),
          Clue: table([]),
          Opportunity: table([]),
          CustomerContact: table([]),
        },
      },
    },
  }
  const service = baseDeps(prisma8, {
    moduleForms: { listFields: async () => [numberField, textareaField] },
    fieldValues: { load: async () => new Map(rows.map((item) => [item.id, {}])), filterResourceIds: async () => [] },
  })

  const result = await service.page(user, {
    targetType: 'customer',
    targetId: 'customer-1',
    page: 1,
    pageSize: 20,
    sort: { name: numberField.id, type: 'asc' },
  })
  assert.deepEqual(result.items.map((item) => item.id), ['record-low', 'record-high'])

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
