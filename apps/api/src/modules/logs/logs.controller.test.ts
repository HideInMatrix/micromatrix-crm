import assert from 'node:assert/strict'
import test from 'node:test'
import 'reflect-metadata'
import { LOG_OPERATION_KEY } from '../../common/decorators/log-operation.decorator'
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator'
import { LogsController } from './logs.controller'

test('clear-all 只使用日志更新权限且不会清空后重新写操作日志', async () => {
  const calls: string[] = []
  const cleanup = {
    clearTenant: async (tenantId: string) => {
      calls.push(tenantId)
      return { deleted: 12 }
    },
  }
  const controller = new LogsController({} as never, {} as never, cleanup as never)

  const result = await controller.clearAll({ tenantId: 'tenant-a' } as never)

  assert.deepEqual(result, { deleted: 12 })
  assert.deepEqual(calls, ['tenant-a'])
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, LogsController.prototype.clearAll), [
    'system:log:update',
  ])
  assert.equal(Reflect.getMetadata(LOG_OPERATION_KEY, LogsController.prototype.clearAll), undefined)
})
