import assert from 'node:assert/strict'
import test from 'node:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ConfigService } from '@nestjs/config'
import { ServiceUnavailableException } from '@nestjs/common'
import type { AsyncJobsService } from '../../async-jobs/async-jobs.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { ExportTasksService } from './export-tasks.service'

type Row = {
  id: string
  tenantId: string
  userId: string
  module: string
  fileName: string
  filePath: string | null
  status: string
  rowCount: number
  fileSize: number | null
  errorMessage: string | null
  payload: unknown
  startedAt: Date | null
  attempts: number
  completedAt: Date | null
  expiresAt: Date
  createdAt: Date
}

function fixture(options?: { enqueueFails?: boolean; pending?: Array<Pick<Row, 'module'>> }) {
  const rows: Row[] = (options?.pending ?? []).map((item, index) => ({
    id: `pending-${index}`,
    tenantId: 'tenant-a',
    userId: 'user-a',
    module: item.module,
    fileName: `existing-${index}`,
    filePath: null,
    status: 'PENDING',
    rowCount: 0,
    fileSize: null,
    errorMessage: null,
    payload: { version: 1 },
    startedAt: null,
    attempts: 0,
    completedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  }))
  let locks = 0
  let enqueueCalls = 0
  const tx = {
    $queryRaw: async () => {
      locks += 1
      return [{ locked: '1' }]
    },
    exportTask: {
      count: async ({ where }: any) =>
        rows.filter(
          (row) =>
            row.tenantId === where.tenantId &&
            row.userId === where.userId &&
            row.status === where.status,
        ).length,
      findFirst: async ({ where }: any) =>
        rows.find(
          (row) =>
            row.tenantId === where.tenantId &&
            row.userId === where.userId &&
            row.module === where.module &&
            row.status === where.status,
        ) ?? null,
      create: async ({ data }: any) => {
        const row: Row = {
          id: `task-${rows.length + 1}`,
          filePath: null,
          status: 'PENDING',
          rowCount: 0,
          fileSize: null,
          errorMessage: null,
          startedAt: null,
          attempts: 0,
          completedAt: null,
          createdAt: new Date(),
          ...data,
        }
        rows.push(row)
        return row
      },
    },
  }
  const prisma = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    exportTask: {
      deleteMany: async ({ where }: any) => {
        const before = rows.length
        for (let index = rows.length - 1; index >= 0; index--) {
          const row = rows[index]!
          if (
            row.id === where.id &&
            row.tenantId === where.tenantId &&
            row.userId === where.userId &&
            row.status === where.status
          ) {
            rows.splice(index, 1)
          }
        }
        return { count: before - rows.length }
      },
    },
  } as unknown as PrismaService
  const asyncJobs = {
    enqueueExport: async () => {
      enqueueCalls += 1
      if (options?.enqueueFails) throw new ServiceUnavailableException('queue down')
    },
  } as unknown as AsyncJobsService
  const service = new ExportTasksService(
    prisma,
    asyncJobs,
    new ConfigService({ UPLOAD_DIR: '/tmp/mmx-export-tests' }),
  )
  return { service, rows, locks: () => locks, enqueueCalls: () => enqueueCalls }
}

const user = { id: 'user-a', tenantId: 'tenant-a' } as never

test('enqueue 只持久化轻量 payload 并立即返回 PENDING task', async () => {
  const { service, rows, locks, enqueueCalls } = fixture()
  const result = await service.enqueue(user, {
    module: 'customer',
    fileName: '客户导出.xlsx',
    payload: {
      version: 1,
      query: { keyword: 'A' },
      input: { headList: ['name'], ids: ['c1'] },
    },
  })
  assert.equal(result.status, 'PENDING')
  assert.equal(result.fileName, '客户导出')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0]?.payload, {
    version: 1,
    query: { keyword: 'A' },
    input: { headList: ['name'], ids: ['c1'] },
  })
  assert.equal(locks(), 1)
  assert.equal(enqueueCalls(), 1)
})

test('同一用户最多 10 个 PENDING 导出任务', async () => {
  const pending = Array.from({ length: 10 }, (_, index) => ({ module: `m-${index}` }))
  const { service, enqueueCalls } = fixture({ pending })
  await assert.rejects(
    () =>
      service.enqueue(user, {
        module: 'customer',
        fileName: '客户导出',
        payload: { version: 1, query: {}, input: { headList: ['name'] } },
      }),
    /10 个导出任务/,
  )
  assert.equal(enqueueCalls(), 0)
})

test('同一用户同 module 已有 PENDING 时拒绝重复提交', async () => {
  const { service, enqueueCalls } = fixture({ pending: [{ module: 'customer' }] })
  await assert.rejects(
    () =>
      service.enqueue(user, {
        module: 'customer',
        fileName: '客户导出',
        payload: { version: 1, query: {}, input: { headList: ['name'] } },
      }),
    /请勿重复提交/,
  )
  assert.equal(enqueueCalls(), 0)
})

test('queue add 失败时删除刚创建的 PENDING task 并向上返回 503', async () => {
  const { service, rows } = fixture({ enqueueFails: true })
  await assert.rejects(
    () =>
      service.enqueue(user, {
        module: 'customer',
        fileName: '客户导出',
        payload: { version: 1, query: {}, input: { headList: ['name'] } },
      }),
    (error: unknown) => error instanceof ServiceUnavailableException,
  )
  assert.equal(rows.length, 0)
})

test('取消竞态下 complete 的 PENDING CAS 失败后删除刚生成的文件', async () => {
  const uploadRoot = `/tmp/mmx-export-cancel-race-${process.pid}-${Date.now()}`
  const prisma = {
    exportTask: {
      updateMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaService
  const service = new ExportTasksService(
    prisma,
    {} as AsyncJobsService,
    new ConfigService({ UPLOAD_DIR: uploadRoot }),
  )
  try {
    const completed = await service.complete(
      'task-canceled',
      { tenantId: 'tenant-a', id: 'user-a' },
      { data: Buffer.from('xlsx-data'), rowCount: 1 },
    )
    assert.equal(completed, false)
    const generated = path.join(uploadRoot, 'exports', 'tenant-a', 'user-a', 'task-canceled.xlsx')
    await assert.rejects(() => fs.access(generated))
  } finally {
    await fs.rm(uploadRoot, { recursive: true, force: true })
  }
})
