import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { decimalString, numericValue } from '../../prisma/numeric-value'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { ContractStageService } from './contract-stage.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ContractStage 使用 Prisma 保持默认阶段、groupBy、强事务排序与高级流转语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-contract-stage')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'Contract Stage User',
      })
      const now = BigInt(Date.now())
      const organizationId = tenant.id
      const actorId = actor.id
      const customer = await prismaClient.orm.public.Customer.select('id').create({
        id: createLegacyId32(),
        name: 'Contract Stage Customer',
        organizationId,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
      const user = { id: actor.id, tenantId: tenant.id } as AuthUser
      const service = new ContractStageService({ client: prismaClient } as PrismaService)

      const initial = await service.get(user)
      assert.equal(initial.stageConfigList.length, 7)
      assert.deepEqual(
        initial.stageConfigList.map((stage) => Number(stage.pos)),
        [1, 2, 3, 4, 5, 6, 7],
      )
      assert.ok(initial.stageConfigList.every((stage) => stage.stageHasData === false))

      const addedId = await service.add(user, {
        name: '补充阶段',
        type: 'AFOOT',
        targetId: initial.stageConfigList[0]!.id,
        dropPosition: 1,
      })
      const afterAdd = await service.get(user)
      assert.equal(afterAdd.stageConfigList.length, 8)
      assert.equal(afterAdd.stageConfigList[1]?.id, addedId)

      const contract = await prismaClient.orm.public.Contract.select('id').create({
        id: createLegacyId32(),
        name: 'Prisma stage contract',
        number: `C-${suffix}`.slice(0, 50),
        customerId: customer.id,
        owner: actorId,
        amount: numericValue(decimalString(0, 14, 2), 14, 2),
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

      await prismaClient.orm.public.Contract.where({ id: contract.id }).delete()
      assert.deepEqual(await service.remove(user, addedId), { id: addedId, name: '补充阶段' })
      const remaining = await prismaClient.orm.public.ContractStageConfig.where({ organizationId })
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
        await prismaClient.orm.public.Contract.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.StageAdvancedConfig.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.ContractStageConfig.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Customer.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
