import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { CluePoolRepository } from '../src/modules/pool-rules/clue-pool.repository'
import { CustomerPoolRepository } from '../src/modules/pool-rules/customer-pool.repository'
import { PoolRuleCalculator } from '../src/modules/pool-rules/pool-rule-calculator.service'
import { PrismaService } from '../src/prisma/prisma.service'

const id = () => randomUUID().replaceAll('-', '').slice(0, 32)

async function main() {
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env['DATABASE_URL'] }))
  await prisma.onModuleInit()
  const calculator = new PoolRuleCalculator()
  const clues = new CluePoolRepository(prisma, calculator)
  const customers = new CustomerPoolRepository(prisma, calculator)
  const organizationId = id()
  const userId = id()
  const operatorId = id()
  const clueId = id()
  const ownedCustomerId = id()
  const pooledCustomerId = id()
  const stageId = id()
  const now = BigInt(Date.now())

  try {
    await prisma.tenant.create({
      data: { id: organizationId, name: 'W3.4 Pool Smoke', slug: `w34-pool-${organizationId}` },
    })
    await prisma.user.createMany({
      data: [
        {
          id: userId,
          tenantId: organizationId,
          name: '领取人',
          passwordHash: 'smoke-only',
        },
        {
          id: operatorId,
          tenantId: organizationId,
          name: '操作人',
          passwordHash: 'smoke-only',
        },
      ],
    })
    const cluePool = await clues.createPool(
      organizationId,
      operatorId,
      {
        name: 'Smoke 线索池',
        scopeIds: [userId],
        ownerIds: [operatorId],
        enable: true,
        auto: false,
        hiddenFieldIds: ['clue-hidden-field'],
        pickRule: {
          limitOnNumber: true,
          pickNumber: 2,
          limitPreOwner: true,
          pickIntervalDays: 7,
          limitNew: false,
          newPickInterval: null,
        },
        recycleRule: { operator: 'AND', condition: '[]' },
      },
      now,
    )
    const cluePoolId = cluePool.id
    await clues.createCapacity(organizationId, operatorId, {
      scopeIds: [userId],
      capacity: 2,
    })
    await assert.rejects(
      () =>
        clues.createCapacity(organizationId, operatorId, {
          scopeIds: [`user:${userId}`],
          capacity: 3,
        }),
      /命中相同成员/,
    )
    await prisma.clue.create({
      data: {
        id: clueId,
        name: '并发领取线索',
        stage: 'NEW',
        organizationId,
        poolId: cluePoolId,
        inSharedPool: true,
        createTime: now - 10_000n,
        updateTime: now - 10_000n,
        createUser: operatorId,
        updateUser: operatorId,
      },
    })

    const concurrent = await Promise.allSettled([
      clues.pick({ organizationId, clueId, ownerId: userId, operatorId, now }),
      clues.pick({ organizationId, clueId, ownerId: userId, operatorId, now }),
    ])
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1)
    await clues.moveToPool({
      organizationId,
      clueId,
      poolId: cluePoolId,
      operatorId,
      reasonId: 'manual-reason',
      now: now + 1_000n,
    })
    assert.equal(await prisma.clueOwner.count({ where: { clueId } }), 1)

    const customerPool = await customers.createPool(
      organizationId,
      operatorId,
      {
        name: 'Smoke 客户公海',
        scopeIds: [userId],
        ownerIds: [operatorId],
        enable: true,
        auto: false,
        hiddenFieldIds: ['customer-hidden-field'],
        pickRule: {
          limitOnNumber: false,
          pickNumber: null,
          limitPreOwner: false,
          pickIntervalDays: null,
          limitNew: false,
          newPickInterval: null,
        },
        recycleRule: { operator: 'AND', condition: '[]' },
      },
      now,
    )
    const customerPoolId = customerPool.id
    await customers.createCapacity(organizationId, operatorId, {
      scopeIds: [userId],
      capacity: 1,
      filters: [{ column: 'stage', operator: 'IN', value: [stageId] }],
    })
    await prisma.customer.createMany({
      data: [
        {
          id: ownedCustomerId,
          name: '不计入库容客户',
          owner: userId,
          collectionTime: now - 20_000n,
          organizationId,
          createTime: now - 30_000n,
          updateTime: now - 20_000n,
          createUser: operatorId,
          updateUser: operatorId,
        },
        {
          id: pooledCustomerId,
          name: '待领取客户',
          organizationId,
          poolId: customerPoolId,
          inSharedPool: true,
          createTime: now - 20_000n,
          updateTime: now - 10_000n,
          createUser: operatorId,
          updateUser: operatorId,
        },
      ],
    })
    await prisma.opportunityStage.create({
      data: { id: stageId, tenantId: organizationId, name: '不计入阶段' },
    })
    await prisma.opportunity.create({
      data: {
        tenantId: organizationId,
        name: '不计入库容商机',
        customerId: ownedCustomerId,
        stageId,
      },
    })

    await customers.pick({
      organizationId,
      customerId: pooledCustomerId,
      ownerId: userId,
      operatorId,
      now,
    })
    await customers.recycle({
      organizationId,
      customerId: pooledCustomerId,
      poolId: customerPoolId,
      operatorId,
      now: now + 2_000n,
    })
    assert.equal(await prisma.customerOwner.count({ where: { customerId: pooledCustomerId } }), 1)
    assert.equal(
      (await prisma.customer.findUniqueOrThrow({ where: { id: pooledCustomerId } })).reasonId,
      'system',
    )
    console.log('W3.4 direct pool repositories smoke: 9 assertions passed')
  } finally {
    await prisma.opportunity.deleteMany({ where: { tenantId: organizationId } })
    await prisma.opportunityStage.deleteMany({ where: { tenantId: organizationId } })
    await prisma.clue.deleteMany({ where: { organizationId } })
    await prisma.customer.deleteMany({ where: { organizationId } })
    await prisma.clueCapacity.deleteMany({ where: { organizationId } })
    await prisma.customerCapacity.deleteMany({ where: { organizationId } })
    await prisma.cluePool.deleteMany({ where: { organizationId } })
    await prisma.customerPool.deleteMany({ where: { organizationId } })
    await prisma.user.deleteMany({ where: { tenantId: organizationId } })
    await prisma.tenant.deleteMany({ where: { id: organizationId } })
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
