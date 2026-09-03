import assert from 'node:assert/strict'
import test from 'node:test'
import { ConfigService } from '@nestjs/config'
import { ServiceUnavailableException } from '@nestjs/common'
import { AsyncJobsService } from './async-jobs.service'

test('未配置 Redis 时 API 仍可构造，但异步导出 enqueue fail-closed 503', async () => {
  const service = new AsyncJobsService(new ConfigService({}))
  assert.equal(service.enabled, false)
  await assert.rejects(
    () => service.enqueueExport('task-a'),
    (error: unknown) => error instanceof ServiceUnavailableException,
  )
  assert.equal((await service.snapshot()).enqueueFailures, 1)
  await service.onApplicationShutdown()
})
