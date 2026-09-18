import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { ApprovalResourceInstance } from './approval-runtime.types'
import { ApprovalResourceSnapshotService } from './approval-resource-snapshot.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ApprovalResourceSnapshot 使用 Prisma 8 保持 JSONB upsert/load/clear 跨 runtime 一致',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-snapshot')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: 'Snapshot User',
      })
      const user = { id: actor.id, tenantId: tenant.id } as AuthUser
      const resourceId = `contract-${suffix}`
      const service = new ApprovalResourceSnapshotService({
        client: prisma8Client,
      } as Prisma8Service)

      await service.save(user, 'contract', resourceId, {
        name: '合同 A',
        amount: 100,
        nested: { enabled: true },
      })
      const first = await prisma8Client.orm.public.ApprovalResourceSnapshots.where({
        tenantId: tenant.id,
        formType: 'CONTRACT',
        resourceId,
      }).first()
      assert.ok(first)
      assert.deepEqual(first.snapshotData, {
        name: '合同 A',
        amount: 100,
        nested: { enabled: true },
      })
      assert.equal(first.createdById, actor.id)
      assert.equal(first.updatedById, actor.id)

      await service.save(user, 'contract', resourceId, {
        name: '合同 B',
        lines: [{ id: 'line-1', qty: 2 }],
      })
      assert.equal(
        (
          await prisma8Client.orm.public.ApprovalResourceSnapshots.where({
            tenantId: tenant.id,
            formType: 'CONTRACT',
            resourceId,
          })
            .select('id')
            .all()
        ).length,
        1,
      )
      const instance = {
        id: `instance-${suffix}`,
        tenantId: tenant.id,
        module: 'contract',
        targetId: resourceId,
        executeTiming: 'UPDATE',
      } as ApprovalResourceInstance
      assert.deepEqual(await service.load(instance), {
        name: '合同 B',
        lines: [{ id: 'line-1', qty: 2 }],
      })

      await service.clear(instance)
      assert.equal(
        (
          await prisma8Client.orm.public.ApprovalResourceSnapshots.where({
            tenantId: tenant.id,
            formType: 'CONTRACT',
            resourceId,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.ApprovalResourceSnapshots.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
