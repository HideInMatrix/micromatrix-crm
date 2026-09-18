import assert from 'node:assert/strict'
import test from 'node:test'
import { acquirePoolTransactionLocksPrisma, poolTransactionLockKeys } from './pool-transaction-lock'

test('并发领取锁同时覆盖资源与负责人并保持全局稳定顺序', () => {
  const first = poolTransactionLockKeys('clue', 'org-1', 'clue-1', 'user-1')
  const second = poolTransactionLockKeys('clue', 'org-1', 'clue-1', 'user-1')
  assert.deepEqual(first, second)
  assert.equal(first.length, 2)
  assert.ok(first.some((key) => key.endsWith(':resource:clue-1')))
  assert.ok(first.some((key) => key.endsWith(':owner:user-1')))
  assert.deepEqual(first, [...first].sort())
})

test('Prisma 事务锁去重并按排序后的顺序逐个获取', async () => {
  const calls: string[] = []
  const client = {
    raw: {
      sql: (_strings: TemplateStringsArray, ...values: unknown[]) => ({
        returnsRow: () => ({
          build: () => ({ values }),
        }),
      }),
    },
  }
  const tx = {
    query: async function* (plan: { values: unknown[] }) {
      calls.push(String(plan.values[0]))
      yield { locked: 1 }
    },
  }

  await acquirePoolTransactionLocksPrisma(client as never, tx as never, [
    'z-lock',
    'a-lock',
    'z-lock',
  ])
  assert.deepEqual(calls, ['a-lock', 'z-lock'])
})
