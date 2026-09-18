import assert from 'node:assert/strict'
import test from 'node:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ConfigService } from '@nestjs/config'
import { ServiceUnavailableException } from '@nestjs/common'
import type { AsyncJobsService } from '../../async-jobs/async-jobs.service'
import {
  prisma8TimestampFromDate,
  prisma8TimestampToDate,
} from '../../prisma/prisma8-temporal'
import type { Prisma8Service } from '../../prisma/prisma8.service'
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
  const project = (row: Row, fields: string[]) =>
    fields.length
      ? Object.fromEntries(fields.map((field) => [field, row[field as keyof Row]]))
      : row
  const collection = (where: Record<string, unknown> = {}, fields: string[] = []): any => ({
    where: (next: Record<string, unknown>) => collection({ ...where, ...next }, fields),
    select: (...nextFields: string[]) => collection(where, nextFields),
    limit: (count: number) => ({
      all: async () =>
        rows
          .filter((row) =>
            Object.entries(where).every(([key, value]) => row[key as keyof Row] === value),
          )
          .slice(0, count)
          .map((row) => project(row, fields)),
    }),
    first: async () => {
      const row = rows.find((item) =>
        Object.entries(where).every(([key, value]) => item[key as keyof Row] === value),
      )
      return row ? project(row, fields) : null
    },
    create: async (data: any) => {
      const createdAt = new Date()
      const row: Row = {
        id: `task-${rows.length + 1}`,
        tenantId: data.tenantId,
        userId: data.userId,
        module: data.module,
        fileName: data.fileName,
        filePath: null,
        status: 'PENDING',
        rowCount: 0,
        fileSize: null,
        errorMessage: null,
        payload: data.payload,
        startedAt: null,
        attempts: 0,
        completedAt: null,
        expiresAt: prisma8TimestampToDate(data.expiresAt),
        createdAt,
      }
      rows.push(row)
      return {
        ...project(row, fields),
        createdAt: prisma8TimestampFromDate(createdAt),
        completedAt: null,
        expiresAt: data.expiresAt,
      }
    },
    deleteAndCount: async () => {
      const before = rows.length
      for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index]!
        if (Object.entries(where).every(([key, value]) => row[key as keyof Row] === value)) {
          rows.splice(index, 1)
        }
      }
      return before - rows.length
    },
  })
  const prisma8 = {
    client: {
      orm: { public: { ExportTasks: collection() } },
      raw: {
        sql: () => ({ returnsRow: () => ({ build: () => ({}) }) }),
      },
      transaction: async (callback: (tx: any) => Promise<unknown>) =>
        callback({
          query: async function* () {
            locks += 1
            yield { locked: '1' }
          },
          orm: { public: { ExportTasks: collection() } },
        }),
    },
  } as unknown as Prisma8Service
  const asyncJobs = {
    enqueueExport: async () => {
      enqueueCalls += 1
      if (options?.enqueueFails) throw new ServiceUnavailableException('queue down')
    },
  } as unknown as AsyncJobsService
  const service = new ExportTasksService(
    prisma8,
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
  const uploadRoot = path.join(
    process.cwd(),
    'scripts',
    `.tmp-export-cancel-race-${process.pid}-${Date.now()}`,
  )
  const prisma8 = {
    client: {
      orm: {
        public: {
          ExportTasks: {
            where: () => ({ updateAndCount: async () => 0 }),
          },
        },
      },
    },
  } as unknown as Prisma8Service
  const service = new ExportTasksService(
    prisma8,
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
