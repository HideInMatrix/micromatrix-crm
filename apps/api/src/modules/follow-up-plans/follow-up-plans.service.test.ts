import assert from 'node:assert/strict'
import test from 'node:test'
import { ConflictException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { FollowUpPlan } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { FollowUpPlansService } from './follow-up-plans.service'

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
    customerAccess?: Record<string, unknown>
    moduleForms?: Record<string, unknown>
    fieldValues?: Record<string, unknown>
  } = {},
) {
  return new FollowUpPlansService(
    prisma as unknown as PrismaService,
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

test('到期提醒覆盖他人代建计划、绑定事件并按日期抢占去重', async () => {
  const row = plan({ status: 'PREPARED', converted: false })
  let claimed = false
  const notices: Array<{ tenantId: string; userId: string; type: string; event?: string }> = []
  const prisma = {
    followUpPlan: {
      findMany: async () => (claimed ? [] : [row]),
      updateMany: async () => {
        if (claimed) return { count: 0 }
        claimed = true
        return { count: 1 }
      },
    },
    customer: { findMany: async () => [{ id: 'customer-1', name: '测试客户' }] },
    clue: { findMany: async () => [] },
    opportunity: { findMany: async () => [] },
  }
  const service = dependencies(
    prisma,
    async (tenantId, userId, input: { type: string; event?: string }) => {
      notices.push({ tenantId, userId, type: input.type, event: input.event })
    },
  )

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
