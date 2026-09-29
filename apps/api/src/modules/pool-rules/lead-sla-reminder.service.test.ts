import assert from 'node:assert/strict'
import test from 'node:test'
import type { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import type { PrismaService } from '../../prisma.service'
import type { BusinessNotificationsService } from '../notifications/business-notifications.service'
import type { LeadPoolSlaService } from './lead-pool-sla.service'
import { LeadSlaReminderService } from './lead-sla-reminder.service'

function prismaWithOrganizations(organizationIds: string[]) {
  const scope: Record<string, unknown> = {}
  Object.assign(scope, {
    select: () => scope,
    all: async () => organizationIds.map((organizationId) => ({ organizationId })),
  })
  return {
    client: {
      orm: {
        public: {
          CluePool: {
            where: () => scope,
          },
        },
      },
    },
  } as unknown as PrismaService
}

test('SLA 提醒按组织去重扫描并只通知超时线索负责人', async () => {
  const slaCalls: string[] = []
  const delivered: Array<{
    tenantId: string
    event: string
    recipientIds: string[]
    name: unknown
  }> = []
  const sla = {
    overdue: async (organizationId: string) => {
      slaCalls.push(organizationId)
      return organizationId === 'tenant-a'
        ? [
            {
              id: 'lead-a',
              name: '张三',
              ownerId: 'owner-a',
              poolId: 'pool-a',
            },
          ]
        : []
    },
  } as unknown as LeadPoolSlaService
  const notifications = {
    send: async (input: {
      tenantId: string
      event: string
      recipientIds: string[]
      templateContext?: Record<string, unknown>
    }) => {
      delivered.push({
        tenantId: input.tenantId,
        event: input.event,
        recipientIds: input.recipientIds,
        name: input.templateContext?.['name'],
      })
      return 1
    },
  } as unknown as BusinessNotificationsService
  const service = new LeadSlaReminderService(
    prismaWithOrganizations(['tenant-a', 'tenant-a', 'tenant-b']),
    sla,
    notifications,
  )

  const sent = await service.sendAll(new Date('2026-09-28T01:00:00.000Z'))

  assert.equal(sent, 1)
  assert.deepEqual(slaCalls, ['tenant-a', 'tenant-b'])
  assert.deepEqual(delivered, [
    {
      tenantId: 'tenant-a',
      event: 'CLUE_FOLLOW_UP_OVERDUE',
      recipientIds: ['owner-a'],
      name: '张三',
    },
  ])
})

test('SLA 定时提醒复用 DAILY 分布式调度槽', async () => {
  const scheduled: Array<{ job: string; slot: string }> = []
  const coordinator = {
    runScheduledOnce: async (
      job: string,
      slot: string,
      task: () => Promise<unknown>,
    ) => {
      scheduled.push({ job, slot })
      return { executed: true, source: 'REDIS' as const, value: await task() }
    },
  } as unknown as DistributedCoordinatorService
  const service = new LeadSlaReminderService(
    prismaWithOrganizations([]),
    { overdue: async () => [] } as unknown as LeadPoolSlaService,
    { send: async () => 0 } as unknown as BusinessNotificationsService,
    coordinator,
  )

  await service.scheduledReminder()

  assert.deepEqual(scheduled, [{ job: 'lead-sla-reminder', slot: 'DAILY' }])
})
