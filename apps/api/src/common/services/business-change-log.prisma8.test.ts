import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { BusinessChangeLogService } from './business-change-log.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'BusinessChangeLog 使用 Prisma 8 同事务写主日志与 JSONB Blob，并可由 fixture readback 验证',
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
        data: { name: `Prisma8 Change Log ${suffix}`, slug: `p8-change-log-${suffix}` },
      })
      tenantId = tenant.id
      const actor = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'Change Log User', passwordHash: 'not-used' },
      })
      const service = new BusinessChangeLogService({ client: prisma8Client } as Prisma8Service)
      const user = { id: actor.id, tenantId: tenant.id, name: actor.name } as AuthUser

      await service.record(user, {
        module: 'customer',
        action: 'update',
        targetId: `customer-${suffix}`,
        targetName: '测试客户',
        before: { name: '旧名称', phone: '10086', customData: { level: 'A' } },
        after: { name: '新名称', phone: '10086', customData: { level: 'B' } },
      })

      const row = await fixtureDb.operationLog.findFirstOrThrow({
        where: { tenantId: tenant.id, targetId: `customer-${suffix}` },
        include: { blob: true },
      })
      assert.equal(row.userId, actor.id)
      assert.equal(row.module, 'customer')
      assert.equal(row.action, 'update')
      assert.deepEqual(row.blob?.detail, {
        changes: [
          { field: 'name', before: '旧名称', after: '新名称' },
          { field: 'customData.level', before: 'A', after: 'B' },
        ],
      })

      await service.record(user, {
        module: 'customer',
        targetId: `unchanged-${suffix}`,
        before: { name: '相同' },
        after: { name: '相同' },
      })
      assert.equal(
        await fixtureDb.operationLog.count({
          where: { tenantId: tenant.id, targetId: `unchanged-${suffix}` },
        }),
        0,
      )
    } finally {
      if (tenantId) {
        await fixtureDb.operationLog.deleteMany({ where: { tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
