import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { ApprovalResourceInstance } from './approval-runtime.types'
import { ApprovalResourceSnapshotService } from './approval-resource-snapshot.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ApprovalResourceSnapshot 使用 Prisma 8 保持 JSONB upsert/load/clear 跨 runtime 一致',
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
        data: { name: `Prisma8 Snapshot ${suffix}`, slug: `p8-snapshot-${suffix}` },
      })
      tenantId = tenant.id
      const actor = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'Snapshot User', passwordHash: 'not-used' },
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
      const first = await fixtureDb.approvalResourceSnapshot.findUniqueOrThrow({
        where: {
          tenantId_formType_resourceId: {
            tenantId: tenant.id,
            formType: 'CONTRACT',
            resourceId,
          },
        },
      })
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
        await fixtureDb.approvalResourceSnapshot.count({
          where: { tenantId: tenant.id, formType: 'CONTRACT', resourceId },
        }),
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
        await fixtureDb.approvalResourceSnapshot.count({
          where: { tenantId: tenant.id, formType: 'CONTRACT', resourceId },
        }),
        0,
      )
    } finally {
      if (tenantId) {
        await fixtureDb.approvalResourceSnapshot.deleteMany({ where: { tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
