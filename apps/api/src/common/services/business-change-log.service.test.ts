import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { BusinessChangeLogService } from './business-change-log.service'

test('业务字段变更日志把 before/after diff 写入独立 Blob 而不是主表 detail', async () => {
  const creates: Array<Record<string, unknown>> = []
  const prisma = {
    operationLog: {
      create: async (args: Record<string, unknown>) => {
        creates.push(args)
        return { id: 'log-1' }
      },
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

  assert.equal(creates.length, 1)
  const data = creates[0].data as Record<string, unknown>
  assert.equal('detail' in data, false)
  const blob = data.blob as { create: { detail: { changes: unknown[] } } }
  assert.deepEqual(blob.create.detail.changes, [
    { field: 'name', before: '旧名称', after: '新名称' },
  ])
})
