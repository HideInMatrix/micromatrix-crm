import assert from 'node:assert/strict'
import test from 'node:test'
import type { DistributedCoordinatorService } from './distributed-coordinator.service'
import { OpportunityRuleService } from '../../modules/opportunities/opportunity-rule.service'
import { PoolRecycleService } from '../../modules/pool-rules/pool-recycle.service'
import { BiddingService } from '../../modules/bidding/bidding.service'
import { FollowUpPlansService } from '../../modules/follow-up-plans/follow-up-plans.service'
import { MessageExpiryService } from '../../modules/notifications/message-expiry.service'
import { MessageDeliveryService } from '../../modules/notifications/message-delivery.service'
import { OperationLogCleanupService } from '../../modules/logs/operation-log-cleanup.service'

function coordinatorSpy() {
  const calls: Array<{ job: string; slot: string }> = []
  const coordinator = {
    runScheduledOnce: async (job: string, slot: string, task: () => Promise<unknown>) => {
      calls.push({ job, slot })
      return { executed: true, source: 'REDIS', value: await task() }
    },
  } as unknown as DistributedCoordinatorService
  return { coordinator, calls }
}

test('7 个 Cron wrapper 全部通过统一时间槽协调且只调用原 core 方法', async () => {
  const { coordinator, calls } = coordinatorSpy()
  const executed: string[] = []

  const opportunity = new OpportunityRuleService({} as never, coordinator)
  opportunity.executeAutoClose = async () => {
    executed.push('opportunity-auto-close')
    return { rules: 0, affected: 0 }
  }

  const pool = new PoolRecycleService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    coordinator,
  )
  pool.recycleAll = async () => {
    executed.push('pool-recycle')
  }

  const bidding = new BiddingService(
    {} as never,
    {} as never,
    { key: 'demo', label: 'Demo' } as never,
    coordinator,
  )
  bidding.fetchAllTenants = async () => {
    executed.push('bidding-fetch')
  }

  const follow = new FollowUpPlansService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    coordinator,
  )
  follow.runDueReminders = async () => {
    executed.push('follow-plan-reminder')
    return 0
  }

  const expiry = new MessageExpiryService({} as never, {} as never, {} as never, coordinator)
  expiry.run = async () => {
    executed.push('message-expiry')
    return 0
  }

  const delivery = new MessageDeliveryService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    coordinator,
  )
  delivery.processDueDeliveries = async () => {
    executed.push('message-delivery')
    return 0
  }

  const operationLogCleanup = new OperationLogCleanupService({} as never, coordinator)
  operationLogCleanup.cleanup = async () => {
    executed.push('operation-log-cleanup')
    return 0
  }

  await opportunity.scheduledAutoClose()
  await pool.scheduledRecycleAll()
  await bidding.scheduledFetchAllTenants()
  await follow.scheduledReminder()
  await expiry.scheduledRunDaily()
  await delivery.scheduledProcessDueDeliveries()
  await operationLogCleanup.scheduledCleanup()

  assert.deepEqual(calls, [
    { job: 'opportunity-auto-close', slot: 'DAILY' },
    { job: 'pool-recycle', slot: 'DAILY' },
    { job: 'bidding-fetch', slot: 'DAILY' },
    { job: 'follow-plan-reminder', slot: 'DAILY' },
    { job: 'message-expiry', slot: 'DAILY' },
    { job: 'message-delivery', slot: 'MINUTE' },
    { job: 'operation-log-cleanup', slot: 'DAILY' },
  ])
  assert.deepEqual(
    executed,
    calls.map(({ job }) => job),
  )
})
