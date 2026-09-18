import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { instantFromDate } from '../../prisma/temporal'
import { jsonValue } from '../../prisma/json-value'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { LogsService } from './logs.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'LogsService 使用 Prisma 保持操作日志分页/关键词/Blob 与登录日志 ilike 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-logs')
      tenantId = tenant.id
      const [first, second, foreignModule] = await Promise.all([
        prismaClient.orm.public.OperationLogs.select('id').create({
          tenantId: tenant.id,
          userName: 'Alpha Admin',
          module: 'LEAD',
          action: 'CREATE',
          targetId: 'lead-1',
          targetName: 'First Lead',
          createdAt: instantFromDate(new Date('2026-09-16T10:00:00.000Z')),
        }),
        prismaClient.orm.public.OperationLogs.select('id').create({
          tenantId: tenant.id,
          userName: 'Beta User',
          module: 'LEAD',
          action: 'UPDATE',
          targetId: 'lead-2',
          targetName: 'ALPHA Target',
          createdAt: instantFromDate(new Date('2026-09-16T11:00:00.000Z')),
        }),
        prismaClient.orm.public.OperationLogs.select('id').create({
          tenantId: tenant.id,
          userName: 'Alpha Other',
          module: 'CUSTOMER',
          action: 'UPDATE',
          createdAt: instantFromDate(new Date('2026-09-16T12:00:00.000Z')),
        }),
      ])
      await prismaClient.orm.public.OperationLogBlobs.create({
        operationLogId: second.id,
        detail: jsonValue({ changes: [{ field: 'name', before: 'A', after: 'B' }] }),
      })
      await prismaClient.orm.public.LoginLogs.createAll([
        {
          tenantId: tenant.id,
          email: 'Alpha.' + suffix + '@example.com',
          authType: 'PASSWORD',
          success: true,
          createdAt: instantFromDate(new Date('2026-09-16T10:30:00.000Z')),
        },
        {
          tenantId: tenant.id,
          email: 'beta.' + suffix + '@example.com',
          authType: 'PASSWORD',
          success: false,
          message: 'bad password',
          createdAt: instantFromDate(new Date('2026-09-16T11:30:00.000Z')),
        },
      ])

      const service = new LogsService({ client: prismaClient } as PrismaService)
      const page = await service.operationLogs(tenant.id, {
        page: 1,
        pageSize: 1,
        module: 'LEAD',
        keyword: 'alpha',
      })
      assert.equal(page.total, 2)
      assert.equal(page.items.length, 1)
      assert.equal(page.items[0]?.id, second.id)
      assert.equal(page.items[0]?.createdAt, '2026-09-16T11:00:00.000Z')

      const nextPage = await service.operationLogs(tenant.id, {
        page: 2,
        pageSize: 1,
        module: 'LEAD',
        keyword: 'alpha',
      })
      assert.deepEqual(
        nextPage.items.map((item) => item.id),
        [first.id],
      )
      assert.equal(
        nextPage.items.some((item) => item.id === foreignModule.id),
        false,
      )

      const detail = await service.operationLogDetail(tenant.id, second.id)
      assert.deepEqual(detail.detail, {
        changes: [{ field: 'name', before: 'A', after: 'B' }],
      })

      const loginPage = await service.loginLogs(tenant.id, {
        page: 1,
        pageSize: 10,
        keyword: 'ALPHA.',
      })
      assert.equal(loginPage.total, 1)
      assert.equal(loginPage.items.length, 1)
      assert.equal(loginPage.items[0]?.email, 'Alpha.' + suffix + '@example.com')
      assert.equal(loginPage.items[0]?.createdAt, '2026-09-16T10:30:00.000Z')
    } finally {
      if (tenantId) {
        const logIds = await prismaClient.orm.public.OperationLogs.where({ tenantId })
          .select('id')
          .all()
        if (logIds.length) {
          await prismaClient.orm.public.OperationLogBlobs.where((row) =>
            row.operationLogId.in(logIds.map((item) => item.id)),
          ).deleteAll()
        }
        await prismaClient.orm.public.OperationLogs.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.LoginLogs.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
