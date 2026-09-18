import assert from 'node:assert/strict'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import { PoolRuleCalculator } from './pool-rule-calculator.service'

const now = 1_777_000_000_000n

test('线索手工退池在同一事务中结束当前负责人并保存退池原因', async () => {
  const history: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const tx = {
    query: async function* () {
      yield { locked: 1 }
    },
    orm: {
      public: {
        Clue: {
          where: () => ({
            first: async () => ({
              id: 'clue-1',
              name: '线索一',
              owner: 'owner-old',
              collectionTime: now - 10_000n,
              organizationId: 'org-1',
              poolId: null,
              inSharedPool: false,
            }),
            update: async (data: Record<string, unknown>) => {
              updates.push(data)
              return { id: 'clue-1', ...data }
            },
          }),
        },
        CluePool: {
          where: () => ({ first: async () => ({ id: 'clue-pool-1', enable: true }) }),
        },
        ClueOwner: {
          create: async (data: Record<string, unknown>) => {
            history.push(data)
            return data
          },
        },
      },
    },
  }
  const prisma8 = {
    client: {
      transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      raw: {
        sql: () => ({ returnsRow: () => ({ build: () => ({}) }) }),
      },
    },
  } as unknown as Prisma8Service
  const repository = new CluePoolRepository(prisma8, new PoolRuleCalculator())

  await repository.moveToPool({
    organizationId: 'org-1',
    clueId: 'clue-1',
    poolId: 'clue-pool-1',
    operatorId: 'operator-1',
    reasonId: 'reason-1',
    now,
  })

  assert.equal(String(history[0]?.['id']).length, 32)
  const { id: _historyId, ...historyData } = history[0] ?? {}
  assert.deepEqual(historyData, {
    clueId: 'clue-1',
    owner: 'owner-old',
    collectionTime: now - 10_000n,
    endTime: now,
    operator: 'operator-1',
    reasonId: 'reason-1',
  })
  assert.equal(updates[0]?.['poolId'], 'clue-pool-1')
  assert.equal(updates[0]?.['owner'], null)
})

test('客户自动回收写 customer_owner，system 只保留在当前资源而不进入历史原因', async () => {
  const history: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const contactUpdates: Array<Record<string, unknown>> = []
  const tx = {
    query: async function* () {
      yield { locked: 1 }
    },
    orm: {
      public: {
        Customer: {
          where: () => ({
            first: async () => ({
              id: 'customer-1',
              name: '客户一',
              owner: 'owner-old',
              collectionTime: now - 20_000n,
              organizationId: 'org-1',
              poolId: null,
              inSharedPool: false,
            }),
            update: async (data: Record<string, unknown>) => {
              updates.push(data)
              return { id: 'customer-1', ...data }
            },
          }),
        },
        CustomerPool: {
          where: () => ({ first: async () => ({ id: 'customer-pool-1', enable: true }) }),
        },
        CustomerContact: {
          where: () => ({
            updateAndCount: async (data: Record<string, unknown>) => {
              contactUpdates.push(data)
              return 1
            },
          }),
        },
        CustomerOwner: {
          create: async (data: Record<string, unknown>) => {
            history.push(data)
            return data
          },
        },
      },
    },
  }
  const prisma8 = {
    client: {
      transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      raw: {
        sql: () => ({ returnsRow: () => ({ build: () => ({}) }) }),
      },
    },
  } as unknown as Prisma8Service
  const repository = new CustomerPoolRepository(prisma8, new PoolRuleCalculator())

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
