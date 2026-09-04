import assert from 'node:assert/strict'
import test from 'node:test'
import { NotFoundException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { LogsService } from './logs.service'

test('操作日志分页列表只选择轻量字段且不读取 Blob', async () => {
  let findArgs: Record<string, unknown> | undefined
  const prisma = {
    operationLog: {
      findMany: (args: Record<string, unknown>) => {
        findArgs = args
        return Promise.resolve([
          {
            id: 'log-1',
            userName: '管理员',
            module: 'lead',
            action: 'update',
            targetName: '线索A',
            ip: '192.168.1.10',
            createdAt: new Date('2026-09-04T05:00:00.000Z'),
          },
        ])
      },
      count: () => Promise.resolve(1),
    },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaService
  const service = new LogsService(prisma)

  const result = await service.operationLogs('tenant-a', { page: 1, pageSize: 10 })

  assert.equal(result.total, 1)
  assert.equal(result.items[0].id, 'log-1')
  const select = findArgs?.select as Record<string, boolean>
  assert.equal(select.id, true)
  assert.equal('blob' in select, false)
  assert.equal('detail' in select, false)
})

test('操作日志详情按 tenantId + id 查询并返回 Blob detail', async () => {
  let detailWhere: Record<string, unknown> | undefined
  const prisma = {
    operationLog: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        detailWhere = args.where
        return {
          id: 'log-1',
          userName: '管理员',
          module: 'customer',
          action: 'change',
          targetId: 'customer-1',
          targetName: '客户A',
          ip: '192.168.1.10',
          createdAt: new Date('2026-09-04T05:00:00.000Z'),
          blob: { detail: { changes: [{ field: 'name', before: 'A', after: 'B' }] } },
        }
      },
    },
  } as unknown as PrismaService
  const service = new LogsService(prisma)

  const detail = await service.operationLogDetail('tenant-a', 'log-1')

  assert.deepEqual(detailWhere, { id: 'log-1', tenantId: 'tenant-a' })
  assert.deepEqual(detail.detail, {
    changes: [{ field: 'name', before: 'A', after: 'B' }],
  })
})

test('操作日志详情不存在或跨租户时返回 404', async () => {
  const prisma = {
    operationLog: { findFirst: async () => null },
  } as unknown as PrismaService
  const service = new LogsService(prisma)

  await assert.rejects(
    () => service.operationLogDetail('tenant-b', 'foreign-log'),
    (error) => error instanceof NotFoundException,
  )
})
