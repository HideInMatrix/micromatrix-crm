import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { LogsService } from './logs.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'LogsService 使用 Prisma 8 保持操作日志分页/关键词/Blob 与登录日志 ilike 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 logs ${suffix}`, slug: `p8-logs-${suffix}` },
      })
      tenantId = tenant.id
      const [first, second, foreignModule] = await Promise.all([
        fixtureDb.operationLog.create({
          data: {
            tenantId: tenant.id,
            userName: 'Alpha Admin',
            module: 'LEAD',
            action: 'CREATE',
            targetId: 'lead-1',
            targetName: 'First Lead',
            createdAt: new Date('2026-09-16T10:00:00.000Z'),
          },
        }),
        fixtureDb.operationLog.create({
          data: {
            tenantId: tenant.id,
            userName: 'Beta User',
            module: 'LEAD',
            action: 'UPDATE',
            targetId: 'lead-2',
            targetName: 'ALPHA Target',
            createdAt: new Date('2026-09-16T11:00:00.000Z'),
          },
        }),
        fixtureDb.operationLog.create({
          data: {
            tenantId: tenant.id,
            userName: 'Alpha Other',
            module: 'CUSTOMER',
            action: 'UPDATE',
            createdAt: new Date('2026-09-16T12:00:00.000Z'),
          },
        }),
      ])
      await fixtureDb.operationLogBlob.create({
        data: {
          operationLogId: second.id,
          detail: { changes: [{ field: 'name', before: 'A', after: 'B' }] },
        },
      })
      await fixtureDb.loginLog.createMany({
        data: [
          {
            tenantId: tenant.id,
            email: `Alpha.${suffix}@example.com`,
            authType: 'PASSWORD',
            success: true,
            createdAt: new Date('2026-09-16T10:30:00.000Z'),
          },
          {
            tenantId: tenant.id,
            email: `beta.${suffix}@example.com`,
            authType: 'PASSWORD',
            success: false,
            message: 'bad password',
            createdAt: new Date('2026-09-16T11:30:00.000Z'),
          },
        ],
      })

      const service = new LogsService({ client: prisma8Client } as Prisma8Service)
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
      assert.deepEqual(nextPage.items.map((item) => item.id), [first.id])
      assert.equal(nextPage.items.some((item) => item.id === foreignModule.id), false)

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
      assert.equal(loginPage.items[0]?.email, `Alpha.${suffix}@example.com`)
      assert.equal(loginPage.items[0]?.createdAt, '2026-09-16T10:30:00.000Z')
    } finally {
      if (tenantId) {
        await fixtureDb.operationLogBlob.deleteMany({
          where: { operationLog: { tenantId } },
        })
        await fixtureDb.operationLog.deleteMany({ where: { tenantId } })
        await fixtureDb.loginLog.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
