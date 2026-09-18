import assert from 'node:assert/strict'
import test from 'node:test'
import { ConflictException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { type FollowUpPlan, FollowUpPlansService } from './follow-up-plans.service'

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

function plan(overrides: Partial<FollowUpPlan> = {}): FollowUpPlan {
  return {
    id: 'plan-1',
    tenantId: 'tenant-1',
    targetType: 'customer',
    targetId: 'customer-1',
    contactId: null,
    content: '今天完成回访',
    method: '电话',
    estimatedAt: new Date('2026-08-22T02:00:00.000Z'),
    status: 'COMPLETED',
    converted: false,
    convertedRecordId: null,
    ownerId: 'owner-1',
    deptId: 'dept-1',
    createdById: 'creator-2',
    dueNotifiedAt: null,
    commentCount: 0,
    customData: {},
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    ...overrides,
  }
}

function dependencies(
  prisma: Record<string, unknown>,
  notify: (
    tenantId: string,
    userId: string,
    input: { type: string; event?: string },
  ) => Promise<void> = async () => undefined,
  options: {
    prisma8?: Record<string, unknown>
    customerAccess?: Record<string, unknown>
    moduleForms?: Record<string, unknown>
    fieldValues?: Record<string, unknown>
  } = {},
) {
  const legacy = prisma as {
    followUpPlan?: {
      findFirst?: () => Promise<FollowUpPlan | null>
      update?: (input: unknown) => Promise<unknown>
      delete?: (input: unknown) => Promise<unknown>
    }
    clue?: { findMany?: () => Promise<Array<Record<string, unknown>>> }
    customer?: { findMany?: () => Promise<Array<Record<string, unknown>>> }
    opportunity?: { findMany?: () => Promise<Array<Record<string, unknown>>> }
    user?: { findMany?: () => Promise<Array<Record<string, unknown>>> }
    customerContact?: { findMany?: () => Promise<Array<Record<string, unknown>>> }
  }
  const collection = (load: () => Promise<Array<Record<string, unknown>>>) => {
    const api = {
      where: () => api,
      select: () => api,
      all: load,
      first: async () => (await load())[0] ?? null,
    }
    return api
  }
  const followPlans = {
    where: () => ({
      first: async () => (legacy.followUpPlan?.findFirst ? legacy.followUpPlan.findFirst() : null),
      update: async (data: Record<string, unknown>) =>
        legacy.followUpPlan?.update ? legacy.followUpPlan.update({ data }) : null,
      deleteAndCount: async () => {
        if (!legacy.followUpPlan?.delete) return 0
        await legacy.followUpPlan.delete({})
        return 1
      },
    }),
  }
  const publicOrm = {
    FollowUpPlans: followPlans,
    Clue: collection(async () => (legacy.clue?.findMany ? legacy.clue.findMany() : [])),
    Customer: collection(async () => (legacy.customer?.findMany ? legacy.customer.findMany() : [])),
    Opportunity: collection(async () =>
      legacy.opportunity?.findMany ? legacy.opportunity.findMany() : [],
    ),
    Users: collection(async () => (legacy.user?.findMany ? legacy.user.findMany() : [])),
    CustomerContact: collection(async () =>
      legacy.customerContact?.findMany ? legacy.customerContact.findMany() : [],
    ),
  }
  const supplied = (options.prisma8 ?? {}) as {
    client?: {
      transaction?: (operation: (tx: unknown) => Promise<unknown>) => Promise<unknown>
      orm?: { public?: Record<string, unknown> }
    }
  }
  const prisma8 = {
    ...supplied,
    client: {
      ...(supplied.client ?? {}),
      orm: {
        public: {
          ...publicOrm,
          ...(supplied.client?.orm?.public ?? {}),
        },
      },
    },
  }
  return new FollowUpPlansService(
    prisma8 as never,
    {} as never,
    (options.customerAccess ?? {}) as never,
    {} as never,
    (options.moduleForms ?? { listFields: async () => [] }) as never,
    (options.fieldValues ?? {
      load: async (_tenantId: string, _resourceType: string, ids: string[]) =>
        new Map(ids.map((id) => [id, {}])),
    }) as never,
    { notify } as never,
  )
}

test('已转换计划拒绝再次修改状态', async () => {
  let updated = false
  const service = dependencies({
    followUpPlan: {
      findFirst: async () => plan({ converted: true }),
      update: async () => {
        updated = true
      },
    },
  })

  await assert.rejects(() => service.updateStatus(user, 'plan-1', 'CANCELLED'), ConflictException)
  assert.equal(updated, false)
})

test('计划转记录预填只执行显式 PLAN_TO_RECORD formLink，不产生写入', async () => {
  let writeCalled = false
  let capturedSourceValues: Record<string, unknown> | null = null
  const prisma = {
    followUpPlan: {
      findFirst: async () => plan(),
      update: async () => {
        writeCalled = true
      },
    },
  }
  const service = dependencies(prisma, undefined, {
    customerAccess: {
      assertCollaborateWrite: async () => ({
        customer: { name: '测试客户' },
        dataScope: true,
        collaborationType: null,
      }),
    },
    moduleForms: {
      listFields: async () => [
        {
          id: 'source-custom',
          key: 'cf_source_custom',
          label: '来源动态字段',
          type: 'text',
          required: false,
          system: false,
          hidden: false,
          options: null,
          config: null,
          sort: 0,
          span: 12,
          showInList: true,
          listWidth: null,
          subFields: null,
        },
      ],
      resolveFormLink: async (
        _tenantId: string,
        _targetFormKey: string,
        _sourceFormKey: string,
        scenario: string,
        sourceValues: Record<string, unknown>,
      ) => {
        assert.equal(scenario, 'PLAN_TO_RECORD')
        capturedSourceValues = sourceValues
        return { content: '联动后的内容', cf_target_custom: '联动值' }
      },
    },
    fieldValues: {
      load: async () => new Map([['plan-1', { cf_source_custom: '来源动态值' }]]),
    },
  })

  const result = await service.recordPrefill(user, 'plan-1')
  const sourceValues = capturedSourceValues as unknown as Record<string, unknown>

  assert.equal(writeCalled, false)
  assert.equal(result.sourcePlanId, 'plan-1')
  assert.deepEqual(result.values, { content: '联动后的内容', cf_target_custom: '联动值' })
  assert.equal(sourceValues.content, '今天完成回访')
  assert.equal(sourceValues.method, '电话')
  assert.equal(sourceValues.cf_source_custom, '来源动态值')
})

test('创建计划时 planProduct 作为标准扩展 moduleField 写入并在 VO 原样回读', async () => {
  let savedValues: Record<string, unknown> = {}
  const productField = {
    id: 'plan-product-field',
    module: 'followPlan',
    key: 'planProduct',
    label: '意向产品',
    type: 'data_source_multiple' as const,
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: { dataSourceType: 'PRODUCT' as const },
    sort: 6,
    span: 12,
    showInList: false,
    listWidth: 180,
    subFields: null,
  }
  const createdPlan = plan({ status: 'PREPARED', converted: false })
  const prisma = {
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(prisma),
    followUpPlan: {
      create: async () => createdPlan,
      findFirst: async () => createdPlan,
    },
    customer: {
      findMany: async () => [{ id: 'customer-1', name: '测试客户' }],
    },
    clue: { findMany: async () => [] },
    opportunity: { findMany: async () => [] },
    user: { findMany: async () => [{ id: 'owner-1', name: '负责人' }] },
    customerContact: { findMany: async () => [] },
  }
  const prisma8 = {
    client: {
      transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
        operation({
          orm: {
            public: {
              FollowUpPlans: {
                create: async () => ({ id: createdPlan.id }),
              },
            },
          },
        }),
    },
  }
  const service = dependencies(prisma, undefined, {
    prisma8,
    customerAccess: {
      assertCollaborateWrite: async () => ({
        customer: { name: '测试客户' },
        dataScope: true,
        collaborationType: null,
      }),
    },
    moduleForms: {
      listFields: async () => [productField],
    },
    fieldValues: {
      save: async (
        _tenantId: string,
        _resourceType: string,
        _resourceId: string,
        values: Record<string, unknown>,
      ) => {
        savedValues = values
      },
      load: async () => new Map([['plan-1', savedValues]]),
    },
  })

  const result = await service.create(user, {
    targetType: 'customer',
    targetId: 'customer-1',
    content: '带产品的跟进计划',
    moduleFields: [
      { fieldId: 'plan-product-field', fieldValue: ['product-a', 'product-b'] },
    ],
  })

  assert.deepEqual(savedValues, { planProduct: ['product-a', 'product-b'] })
  assert.deepEqual(result.moduleFields, [
    { fieldId: 'plan-product-field', fieldValue: ['product-a', 'product-b'] },
  ])
})

test('到期提醒覆盖他人代建计划、绑定事件并按日期抢占去重', async () => {
  const row = plan({ status: 'PREPARED', converted: false })
  let claimed = false
  const notices: Array<{ tenantId: string; userId: string; type: string; event?: string }> = []
  const service = dependencies(
    {},
    async (tenantId, userId, input: { type: string; event?: string }) => {
      notices.push({ tenantId, userId, type: input.type, event: input.event })
    },
  )
  const storage = service as unknown as {
    loadDueReminderPlans: () => Promise<FollowUpPlan[]>
    claimDueReminder: () => Promise<boolean>
    releaseDueReminder: () => Promise<void>
    targetNamesPrisma8: () => Promise<Map<string, string>>
  }
  storage.loadDueReminderPlans = async () => (claimed ? [] : [row])
  storage.claimDueReminder = async () => {
    if (claimed) return false
    claimed = true
    return true
  }
  storage.releaseDueReminder = async () => undefined
  storage.targetNamesPrisma8 = async () => new Map([['customer:customer-1', '测试客户']])

  const first = await service.runDueReminders(new Date('2026-08-22T03:00:00.000Z'))
  const second = await service.runDueReminders(new Date('2026-08-22T03:05:00.000Z'))

  assert.equal(first, 1)
  assert.equal(second, 0)
  assert.deepEqual(notices, [
    {
      tenantId: 'tenant-1',
      userId: 'owner-1',
      type: 'follow_plan',
      event: 'CUSTOMER_FOLLOW_UP_PLAN_DUE',
    },
  ])
  assert.notEqual(row.ownerId, row.createdById)
})
