import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { OrderStageService } from './order-stage.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'OrderStage 使用 Prisma 8 保持默认阶段、groupBy、强事务排序与高级流转语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 order stage ${suffix}`, slug: `p8-order-stage-${suffix}` },
      })
      tenantId = tenant.id
      const actor = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'Order Stage User', passwordHash: 'not-used' },
      })
      const user = { id: actor.id, tenantId: tenant.id } as AuthUser
      const service = new OrderStageService({ client: prisma8Client } as Prisma8Service)

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

      const order = await fixtureDb.order.create({
        data: {
          number: `O-${suffix}`.slice(0, 50),
          name: 'Prisma8 stage order',
          stage: addedId,
          organizationId: tenant.id,
          createTime: BigInt(Date.now()),
          updateTime: BigInt(Date.now()),
          createUser: actor.id,
          updateUser: actor.id,
        },
      })
      const withData = await service.get(user)
      assert.equal(withData.stageConfigList.find((stage) => stage.id === addedId)?.stageHasData, true)
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

      await fixtureDb.order.delete({ where: { id: order.id } })
      assert.deepEqual(await service.remove(user, addedId), { id: addedId, name: '补充订单阶段' })
      const remaining = await fixtureDb.orderStageConfig.findMany({
        where: { organizationId: tenant.id },
        orderBy: { pos: 'asc' },
      })
      assert.equal(remaining.length, 7)
      assert.deepEqual(remaining.map((stage) => Number(stage.pos)), [1, 2, 3, 4, 5, 6, 7])
    } finally {
      if (tenantId) {
        await fixtureDb.order.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.stageAdvancedConfig.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.orderStageConfig.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
