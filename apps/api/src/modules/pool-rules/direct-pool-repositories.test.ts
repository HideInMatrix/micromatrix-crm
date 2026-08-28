import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import { PoolRuleCalculator } from './pool-rule-calculator.service'

const now = 1_777_000_000_000n

test('线索手工退池在同一事务中结束当前负责人并保存退池原因', async () => {
  const history: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const tx = {
    $queryRaw: async () => [],
    clue: {
      findFirst: async () => ({
        id: 'clue-1',
        name: '线索一',
        owner: 'owner-old',
        collectionTime: now - 10_000n,
        organizationId: 'org-1',
        poolId: null,
        inSharedPool: false,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data)
        return { id: 'clue-1', ...data }
      },
    },
    cluePool: { findFirst: async () => ({ id: 'clue-pool-1' }) },
    clueOwner: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        history.push(data)
        return data
      },
    },
  }
  const prisma = {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
  } as unknown as PrismaService
  const repository = new CluePoolRepository(prisma, new PoolRuleCalculator())

  await repository.moveToPool({
    organizationId: 'org-1',
    clueId: 'clue-1',
    poolId: 'clue-pool-1',
    operatorId: 'operator-1',
    reasonId: 'reason-1',
    now,
  })

  assert.deepEqual(history, [
    {
      clueId: 'clue-1',
      owner: 'owner-old',
      collectionTime: now - 10_000n,
      endTime: now,
      operator: 'operator-1',
      reasonId: 'reason-1',
    },
  ])
  assert.equal(updates[0]?.['poolId'], 'clue-pool-1')
  assert.equal(updates[0]?.['owner'], null)
})

test('客户自动回收写 customer_owner，system 只保留在当前资源而不进入历史原因', async () => {
  const history: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const contactUpdates: Array<Record<string, unknown>> = []
  const tx = {
    $queryRaw: async () => [],
    customer: {
      findFirst: async () => ({
        id: 'customer-1',
        name: '客户一',
        owner: 'owner-old',
        collectionTime: now - 20_000n,
        organizationId: 'org-1',
        poolId: null,
        inSharedPool: false,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data)
        return { id: 'customer-1', ...data }
      },
    },
    customerPool: { findFirst: async () => ({ id: 'customer-pool-1' }) },
    customerContact: {
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        contactUpdates.push(data)
        return { count: 1 }
      },
    },
    customerOwner: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        history.push(data)
        return data
      },
    },
  }
  const prisma = {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
  } as unknown as PrismaService
  const repository = new CustomerPoolRepository(prisma, new PoolRuleCalculator())

  await repository.recycle({
    organizationId: 'org-1',
    customerId: 'customer-1',
    poolId: 'customer-pool-1',
    operatorId: 'admin',
    now,
  })

  assert.equal(history.length, 1)
  assert.equal(history[0]?.['customerId'], 'customer-1')
  assert.equal(history[0]?.['reasonId'], null)
  assert.equal(updates[0]?.['reasonId'], 'system')
  assert.equal(updates[0]?.['inSharedPool'], true)
  assert.equal(contactUpdates[0]?.['owner'], '-')
})
