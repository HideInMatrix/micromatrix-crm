import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { BusinessChangeLogService } from './business-change-log.service'

test('业务字段变更日志把 before/after diff 写入独立 Blob 而不是主表 detail', async () => {
  const logCreates: Array<Record<string, unknown>> = []
  const blobCreates: Array<Record<string, unknown>> = []
  const prisma = {
    client: {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          orm: {
            public: {
              OperationLogs: {
                create: async (data: Record<string, unknown>) => {
                  logCreates.push(data)
                  return { id: 'log-1' }
                },
              },
              OperationLogBlobs: {
                create: async (data: Record<string, unknown>) => {
                  blobCreates.push(data)
                  return data
                },
              },
            },
          },
        }),
    },
  } as unknown as PrismaService

  const service = new BusinessChangeLogService(prisma)
  await service.record({ id: 'user-1', tenantId: 'tenant-1', name: '管理员' } as never, {
    module: 'customer',
    action: 'update',
    targetId: 'customer-1',
    targetName: '示例客户',
    before: { name: '旧名称', phone: '10086' },
    after: { name: '新名称', phone: '10086' },
  })

  assert.equal(logCreates.length, 1)
  assert.equal('detail' in logCreates[0], false)
  assert.equal(blobCreates.length, 1)
  assert.equal(blobCreates[0].operationLogId, 'log-1')
  assert.deepEqual((blobCreates[0].detail as { changes: unknown[] }).changes, [
    { field: 'name', before: '旧名称', after: '新名称' },
  ])
})
