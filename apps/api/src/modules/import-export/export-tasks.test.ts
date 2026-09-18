import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ConfigService } from '@nestjs/config'
import type { AsyncJobsService } from '../../async-jobs/async-jobs.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { instantFromDate } from '../../prisma/temporal'
import { jsonValue } from '../../prisma/json-value'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { ExportTasksService } from './export-tasks.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ExportTasks enqueue 通过 Prisma advisory transaction 保持跨 runtime、去重与配额语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma = testDb.client
    const uploadDir = await mkdtemp(path.join(tmpdir(), 'mmx-export-prisma-'))
    let enqueueCalls = 0
    const asyncJobs = {
      enqueueExport: async () => {
        enqueueCalls += 1
      },
      cancelExportJob: async () => undefined,
    } as unknown as AsyncJobsService
    const service = new ExportTasksService(
      { client: prisma } as PrismaService,
      asyncJobs,
      new ConfigService({ UPLOAD_DIR: uploadDir }),
    )
    const tenantId = `p8-export-${randomUUID()}`
    const userId = `p8-user-${randomUUID()}`
    const user = { id: userId, tenantId } as never

    try {
      const created = await service.enqueue(user, {
        module: 'customer',
        fileName: 'Prisma 客户导出.xlsx',
        payload: {
          version: 1,
          query: { keyword: "O'Reilly" },
          input: { headList: ['name'], ids: ['c1'] },
        },
      })
      assert.equal(created.status, 'PENDING')
      assert.equal(created.fileName, 'Prisma 客户导出')
      assert.ok(new Date(created.expiresAt).getTime() > Date.now())

      const fixtureRead = await prisma.orm.public.ExportTasks.where({ id: created.id }).first()
      assert.ok(fixtureRead)
      assert.equal(fixtureRead.tenantId, tenantId)
      assert.equal(fixtureRead.userId, userId)
      assert.equal(fixtureRead.module, 'customer')
      assert.equal(fixtureRead.status, 'PENDING')
      assert.deepEqual(fixtureRead.payload, {
        version: 1,
        query: { keyword: "O'Reilly" },
        input: { headList: ['name'], ids: ['c1'] },
      })

      await assert.rejects(
        () =>
          service.enqueue(user, {
            module: 'customer',
            fileName: '重复导出',
            payload: { version: 1, query: {}, input: {} },
          }),
        /请勿重复提交/,
      )

      const now = new Date()
      await prisma.orm.public.ExportTasks.createAll(
        Array.from({ length: 9 }, (_, index) => ({
          tenantId,
          userId,
          module: `other-${index}`,
          fileName: `other-${index}`,
          payload: jsonValue({ version: 1 }),
          expiresAt: instantFromDate(new Date(now.getTime() + 60_000)),
        })),
      )
      await assert.rejects(
        () =>
          service.enqueue(user, {
            module: 'new-module',
            fileName: '超限导出',
            payload: { version: 1, query: {}, input: {} },
          }),
        /10 个导出任务/,
      )
      assert.equal(enqueueCalls, 1)

      const attempt = await service.beginAttempt(created.id)
      assert.equal(attempt?.attempts, 1)
      const attemptedRead = await prisma.orm.public.ExportTasks.where({ id: created.id }).first()
      assert.equal(attemptedRead?.attempts, 1)
      assert.ok(attemptedRead?.startedAt)

      await service.fail(created.id, 'expected worker failure')
      const failedRead = await prisma.orm.public.ExportTasks.where({ id: created.id }).first()
      assert.equal(failedRead?.status, 'FAILED')
      assert.equal(failedRead?.errorMessage, 'expected worker failure')
      assert.ok(failedRead?.completedAt)

      const completeTask = await prisma.orm.public.ExportTasks.select('id').create({
        tenantId,
        userId,
        module: 'complete-module',
        fileName: '完成任务',
        payload: jsonValue({ version: 1 }),
        expiresAt: instantFromDate(new Date(Date.now() + 60_000)),
      })
      assert.equal(
        await service.complete(
          completeTask.id,
          { tenantId, id: userId },
          { data: Buffer.from('xlsx-content'), rowCount: 3 },
        ),
        true,
      )
      const completedRead = await prisma.orm.public.ExportTasks.where({
        id: completeTask.id,
      }).first()
      assert.equal(completedRead?.status, 'SUCCESS')
      assert.equal(completedRead?.rowCount, 3)
      assert.equal(completedRead?.fileSize, Buffer.byteLength('xlsx-content'))
      assert.ok(completedRead?.completedAt)
      assert.ok(completedRead?.filePath)

      await service.cancel(user, completeTask.id)
      const canceledRead = await prisma.orm.public.ExportTasks.where({
        id: completeTask.id,
      }).first()
      assert.equal(canceledRead?.status, 'CANCELED')
      assert.equal(canceledRead?.filePath, null)
    } finally {
      await prisma.orm.public.ExportTasks.where({ tenantId, userId }).deleteAll()
      await testDb.close()
      await rm(uploadDir, { recursive: true, force: true })
    }
  },
)
