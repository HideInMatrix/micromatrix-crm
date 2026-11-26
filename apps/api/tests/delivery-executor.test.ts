import assert from 'node:assert/strict'
import { DeliveryExecutor } from '../src/modules/notifications/delivery-executor'

async function main() {
  let active = 0
  let peak = 0
  const calls: string[] = []
  const executor = new DeliveryExecutor(
    async (id) => {
      active++
      peak = Math.max(peak, active)
      calls.push(id)
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 2))
        if (id === 'bad') throw new Error('simulated delivery failure')
      } finally {
        active--
      }
    },
    5,
    100,
  )

  // Concurrent enqueue calls and a scheduled scan share the same worker slots.
  const batches = Array.from({ length: 30 }, (_, i) => executor.run([String(i)]))
  const duplicate = executor.run(['0', '1', '1'])
  assert.deepEqual(executor.snapshot(), { active: 5, pending: 25, outstanding: 30 })
  await Promise.all([...batches, duplicate])
  assert.equal(peak, 5)
  assert.equal(calls.length, 30)
  assert.equal(new Set(calls).size, 30)
  assert.deepEqual(executor.snapshot(), { active: 0, pending: 0, outstanding: 0 })

  // A failed worker releases its slot and does not prevent other deliveries.
  const failed = executor.run(['bad', 'after-bad'])
  await assert.rejects(failed, AggregateError)
  assert.ok(calls.includes('after-bad'))
  await executor.run(['retry'])
  assert.ok(calls.includes('retry'))

  const processed: string[] = []
  const bounded = new DeliveryExecutor(
    async (id) => {
      processed.push(id)
      await Promise.resolve()
    },
    1,
    2,
  )
  assert.deepEqual(await bounded.run(['a', 'b', 'c']), { accepted: 2, deferred: 1 })
  assert.deepEqual(processed, ['a', 'b'])
  // Simulate a subsequent durable-outbox scan for the deferred record.
  assert.deepEqual(await bounded.run(['c']), { accepted: 1, deferred: 0 })
  assert.deepEqual(processed, ['a', 'b', 'c'])
  assert.throws(() => new DeliveryExecutor(async () => {}, 5, 4), RangeError)
  console.log('Delivery executor concurrency, deduplication, overflow and recovery tests passed.')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
