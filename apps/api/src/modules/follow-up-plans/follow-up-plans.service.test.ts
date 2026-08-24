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
) {
  return new FollowUpPlansService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    {} as never,
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

test('转跟进记录在同一事务内抢占、创建记录并回写记录 ID', async () => {
  const calls: string[] = []
  const converted = plan({ converted: true, convertedRecordId: 'record-1' })
  const tx = {
    followUpPlan: {
      updateMany: async () => {
        calls.push('claim')
        return { count: 1 }
      },
      update: async () => {
        calls.push('link')
        return converted
      },
    },
    followUpRecord: {
      create: async () => {
        calls.push('record')
        return { id: 'record-1' }
      },
    },
    customer: { updateMany: async () => calls.push('touch') },
    lead: { updateMany: async () => undefined },
    opportunity: { updateMany: async () => undefined },
  }
  const prisma = {
    followUpPlan: { findFirst: async () => plan() },
    user: {
      findFirst: async () => ({ name: '负责人' }),
      findMany: async () => [{ id: 'owner-1', name: '负责人' }],
    },
    customer: {
      findMany: async () => [{ id: 'customer-1', name: '测试客户' }],
    },
    lead: { findMany: async () => [] },
    opportunity: { findMany: async () => [] },
    contact: { findMany: async () => [] },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  }
  const service = dependencies(prisma)

  const result = await service.convert(user, 'plan-1')

  assert.deepEqual(calls, ['claim', 'record', 'touch', 'link'])
  assert.equal(result.convertedRecordId, 'record-1')
  assert.equal(result.targetName, '测试客户')
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
    lead: { findMany: async () => [] },
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
