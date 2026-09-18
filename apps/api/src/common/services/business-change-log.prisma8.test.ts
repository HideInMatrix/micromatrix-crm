import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { BusinessChangeLogService } from './business-change-log.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'BusinessChangeLog 使用 Prisma 8 同事务写主日志与 JSONB Blob，并由原生 ORM readback 验证',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-change-log')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: 'Change Log User',
        email: null,
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

      const row = await prisma8Client.orm.public.OperationLogs
        .where({ tenantId: tenant.id, targetId: `customer-${suffix}` })
        .select('id', 'userId', 'module', 'action')
        .first()
      assert.ok(row)
      assert.equal(row.userId, actor.id)
      assert.equal(row.module, 'customer')
      assert.equal(row.action, 'update')
      const blob = await prisma8Client.orm.public.OperationLogBlobs
        .where({ operationLogId: row.id })
        .select('detail')
        .first()
      assert.deepEqual(blob?.detail, {
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
      const unchangedRows = await prisma8Client.orm.public.OperationLogs
        .where({ tenantId: tenant.id, targetId: `unchanged-${suffix}` })
        .select('id')
        .all()
      assert.equal(unchangedRows.length, 0)
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.OperationLogs.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
