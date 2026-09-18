import assert from 'node:assert/strict'
import test from 'node:test'
import { NotFoundException } from '@nestjs/common'
import { Temporal } from '@js-temporal/polyfill'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { LogsService } from './logs.service'

test('操作日志分页列表只选择轻量字段且不读取 Blob', async () => {
  let selectedFields: string[] = []
  const collection = {
    where: () => collection,
    select: (...fields: string[]) => {
      selectedFields = fields
      return collection
    },
    orderBy: () => collection,
    offset: () => collection,
    limit: () => collection,
    all: async () => [
          {
            id: 'log-1',
            userName: '管理员',
            module: 'lead',
            action: 'update',
            targetName: '线索A',
            ip: '192.168.1.10',
            createdAt: Temporal.PlainDateTime.from('2026-09-04T05:00:00'),
          },
        ],
    aggregate: async () => ({ total: 1 }),
  }
  const prisma8 = {
    client: { orm: { public: { OperationLogs: collection } } },
  } as unknown as Prisma8Service
  const service = new LogsService(prisma8)

  const result = await service.operationLogs('tenant-a', { page: 1, pageSize: 10 })

  assert.equal(result.total, 1)
  assert.equal(result.items[0].id, 'log-1')
  assert.equal(selectedFields.includes('id'), true)
  assert.equal(selectedFields.includes('operationLogBlobs'), false)
  assert.equal(selectedFields.includes('detail'), false)
})

test('操作日志详情按 tenantId + id 查询并返回 Blob detail', async () => {
  let detailWhere: Record<string, unknown> | undefined
  const logCollection = {
    where: (where: Record<string, unknown>) => {
      detailWhere = where
      return logCollection
    },
    select: () => logCollection,
    first: async () => ({
          id: 'log-1',
          userName: '管理员',
          module: 'customer',
          action: 'change',
          targetId: 'customer-1',
          targetName: '客户A',
          ip: '192.168.1.10',
          createdAt: Temporal.PlainDateTime.from('2026-09-04T05:00:00'),
        }),
  }
  const blobCollection = {
    where: () => blobCollection,
    select: () => blobCollection,
    first: async () => ({ detail: { changes: [{ field: 'name', before: 'A', after: 'B' }] } }),
  }
  const prisma8 = {
    client: {
      orm: { public: { OperationLogs: logCollection, OperationLogBlobs: blobCollection } },
    },
  } as unknown as Prisma8Service
  const service = new LogsService(prisma8)

  const detail = await service.operationLogDetail('tenant-a', 'log-1')

  assert.deepEqual(detailWhere, { id: 'log-1', tenantId: 'tenant-a' })
  assert.deepEqual(detail.detail, {
    changes: [{ field: 'name', before: 'A', after: 'B' }],
  })
})

test('操作日志详情不存在或跨租户时返回 404', async () => {
  const collection = {
    where: () => collection,
    select: () => collection,
    first: async () => null,
  }
  const prisma8 = {
    client: { orm: { public: { OperationLogs: collection } } },
  } as unknown as Prisma8Service
  const service = new LogsService(prisma8)

  await assert.rejects(
    () => service.operationLogDetail('tenant-b', 'foreign-log'),
    (error) => error instanceof NotFoundException,
  )
})
