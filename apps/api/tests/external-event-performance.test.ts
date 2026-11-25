import assert from 'node:assert/strict'
import { ExternalEventPerformance } from '../src/common/external-event-performance'

async function main() {
  let time = 0
  const trace = new ExternalEventPerformance(true, () => time)
  const logs: string[] = []
  const result = await trace.measure('template', async () => {
    time += 20
    return 42
  })
  assert.equal(result, 42)

  const entered = trace.begin('transaction_enter')
  await trace.measure('transaction', async () => {
    time += 30
    entered()
    entered()
    await trace.measure('conversion_lock', async () => {
      time += 210
    })
    time += 40
  })
  trace.finish('convert', true, (line) => logs.push(line))
  assert.deepEqual(JSON.parse(logs[0]!), {
    kind: 'external_event_perf',
    action: 'convert',
    ok: true,
    totalMs: 300,
    stagesMs: { template: 20, transaction_enter: 30, conversion_lock: 210, transaction: 280 },
  })

  const fast = new ExternalEventPerformance(true, () => time)
  await fast.measure('template', async () => {
    time += 10
  })
  fast.finish('create', true, (line) => logs.push(line))
  assert.equal(logs.length, 1)

  const failed = new ExternalEventPerformance(true, () => time)
  const failure = new Error('private payload should not be logged')
  await assert.rejects(
    failed.measure('business_write', async () => {
      time += 5
      throw failure
    }),
    (error) => error === failure,
  )
  failed.finish('create', false, (line) => logs.push(line))
  assert.equal(logs.length, 2)
  assert.equal(JSON.parse(logs[1]!).stagesMs.business_write, 5)
  assert.ok(!logs[1]!.includes(failure.message))

  const disabled = new ExternalEventPerformance(false, () => {
    throw new Error('Disabled diagnostics must not read the clock')
  })
  assert.equal(await disabled.measure('anything', async () => 'ok'), 'ok')
  disabled.begin('transaction_enter')()
  disabled.finish('convert', false, (line) => logs.push(line))
  assert.equal(logs.length, 2)
  console.log('External event performance diagnostics tests passed.')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
