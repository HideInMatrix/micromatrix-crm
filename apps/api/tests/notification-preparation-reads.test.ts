import assert from 'node:assert/strict'
import { NotificationPreparationReads } from '../src/modules/notifications/notification-preparation-reads'

async function main() {
  const reads = new NotificationPreparationReads()
  let calls = 0
  const load = async () => ++calls
  const first = reads.read(['recipients', 'tenant-a', 'user'], load)
  assert.equal(reads.read(['recipients', 'tenant-a', 'user'], load), first)
  assert.equal(await first, 1)
  assert.equal(await reads.read(['recipients', 'tenant-b', 'user'], load), 2)
  assert.equal(await reads.read(['operator', 'tenant-a', 'user'], load), 3)
  assert.equal(await reads.read(['gate', 'tenant-a', 'WECOM'], load), 4)
  assert.equal(await reads.read(['gate', 'tenant-a', 'DINGTALK'], load), 5)
  assert.equal(
    await new NotificationPreparationReads().read(['recipients', 'tenant-a', 'user'], load),
    6,
  )
  const rejected = reads.read(['setting', 'tenant-a', 'event'], async () => {
    throw new Error('temporary')
  })
  await assert.rejects(rejected, /temporary/)
  assert.equal(await reads.read(['setting', 'tenant-a', 'event'], load), 7)
  console.log(
    'Outbox preparation read sharing, tenant/channel isolation, new group freshness and rejection eviction passed.',
  )
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
