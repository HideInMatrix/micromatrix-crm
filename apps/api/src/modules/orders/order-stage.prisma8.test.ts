import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { OrderStageService } from './order-stage.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'OrderStage 使用 Prisma 8 保持默认阶段、groupBy、强事务排序与高级流转语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-order-stage')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: 'Order Stage User',
      })
      const user = { id: actor.id, tenantId: tenant.id } as AuthUser
      const service = new OrderStageService({ client: prisma8Client } as Prisma8Service)
      const organizationId = tenant.id
      const actorId = actor.id

      const initial = await service.get(user)
      assert.equal(initial.stageConfigList.length, 7)
      assert.deepEqual(
        initial.stageConfigList.map((stage) => Number(stage.pos)),
        [1, 2, 3, 4, 5, 6, 7],
      )

      const addedId = await service.add(user, {
        name: '补充订单阶段',
        type: 'AFOOT',
        targetId: initial.stageConfigList[0]!.id,
        dropPosition: 1,
      })
      const afterAdd = await service.get(user)
      assert.equal(afterAdd.stageConfigList.length, 8)
      assert.equal(afterAdd.stageConfigList[1]?.id, addedId)

      const now = BigInt(Date.now())
      const order = await prisma8Client.orm.public.SalesOrder.select('id').create({
        id: createLegacyId32(),
        number: `O-${suffix}`.slice(0, 50),
        name: 'Prisma8 stage order',
        stage: addedId,
        organizationId,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
      const withData = await service.get(user)
      assert.equal(
        withData.stageConfigList.find((stage) => stage.id === addedId)?.stageHasData,
        true,
      )
      await assert.rejects(() => service.remove(user, addedId), BadRequestException)

      const originId = withData.stageConfigList[0]!.id
      const targetId = withData.stageConfigList[2]!.id
      await service.saveAdvancedConfig(user, {
        circulationType: 'ADVANCED',
        circulationSettings: [{ originId, targets: [{ targetId, enable: false }] }],
      })
      await assert.rejects(
        () => service.assertTransition(tenant.id, originId, targetId),
        BadRequestException,
      )
      await service.saveAdvancedConfig(user, {
        circulationType: 'ADVANCED',
        circulationSettings: [{ originId, targets: [{ targetId, enable: true }] }],
      })
      assert.deepEqual(await service.assertTransition(tenant.id, originId, targetId), [])

      await service.updateRollback(user, { afootRollBack: false, endRollBack: true })
      const rollback = await service.get(user)
      assert.equal(rollback.afootRollBack, false)
      assert.equal(rollback.endRollBack, true)

      await prisma8Client.orm.public.SalesOrder.where({ id: order.id }).delete()
      assert.deepEqual(await service.remove(user, addedId), { id: addedId, name: '补充订单阶段' })
      const remaining = await prisma8Client.orm.public.SalesOrderStageConfig.where({
        organizationId,
      })
        .orderBy((row) => row.pos.asc())
        .all()
      assert.equal(remaining.length, 7)
      assert.deepEqual(
        remaining.map((stage) => Number(stage.pos)),
        [1, 2, 3, 4, 5, 6, 7],
      )
    } finally {
      if (tenantId) {
        const organizationId = tenantId
        await prisma8Client.orm.public.SalesOrder.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.StageAdvancedConfig.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.SalesOrderStageConfig.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
