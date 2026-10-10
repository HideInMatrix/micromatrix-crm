import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma.service'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import { PoolRecycleService } from './pool-recycle.service'
import { PoolRuleCalculator } from './pool-rule-calculator.service'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'
import type { BusinessNotificationsService } from '../notifications/business-notifications.service'

const databaseUrl = process.env['DATABASE_URL']

test('真实数据库：已领取线索与客户命中条件后自动回池、保留历史；未达条件的不动', {
  skip: !databaseUrl,
}, async () => {
  assert.ok(databaseUrl)
  const hostname = new URL(databaseUrl).hostname
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(hostname), '只能在本地测试数据库执行')

  const db = await openPrismaTestDatabase(databaseUrl)
  const orm = db.client.orm.public
  const organizationIds: string[] = []
  try {
    const tenant = await createPrismaTestTenant(db.client, 'p8-recycle-integration')
    organizationIds.push(tenant.id)
    const owner = await createPrismaTestUser(db.client, { tenantId: tenant.id, name: 'Recycle integration owner' })
    const now = BigInt(Date.now())
    const day = 86_400_000n
    const before = now - 45n * day
    const recently = now - 1n * day
    const metadata = {
      organizationId: tenant.id,
      enable: true,
      auto: true,
      scopeId: JSON.stringify([`user:${owner.id}`]),
      ownerId: JSON.stringify([`user:${owner.id}`]),
      createTime: now,
      updateTime: now,
      createUser: owner.id,
      updateUser: owner.id,
    }
    const leadPool = await orm.CluePool.create({ id: createLegacyId32(), name: '回收线索池', ...metadata })
    const customerPool = await orm.CustomerPool.create({ id: createLegacyId32(), name: '回收客户公海', ...metadata })
    const conditions = JSON.stringify([
      { column: 'storageTime', operator: 'DYNAMICS', value: 'CUSTOM,30,BEFORE_DAY', scope: ['Picked'] },
      { column: 'followUpTime', operator: 'DYNAMICS', value: 'CUSTOM,7,BEFORE_DAY' },
    ])
    const ruleAttrs = {
      operator: 'AND', condition: conditions,
      createTime: now, updateTime: now,
      createUser: owner.id, updateUser: owner.id,
    }
    await orm.CluePoolRecycleRule.create({ id: createLegacyId32(), poolId: leadPool.id, ...ruleAttrs })
    await orm.CustomerPoolRecycleRule.create({ id: createLegacyId32(), poolId: customerPool.id, ...ruleAttrs })

    const mkRecord = (ownedAt: bigint, followedAt: bigint) => ({
      id: createLegacyId32(), organizationId: tenant.id, owner: owner.id,
      collectionTime: ownedAt, followTime: followedAt,
      createTime: before, updateTime: now, createUser: owner.id, updateUser: owner.id,
      inSharedPool: false,
    })
    const overdueLead = await orm.Clue.create({ ...mkRecord(before, before), name: '待回收线索', stage: 'FOLLOWING' })
    const recentLead = await orm.Clue.create({ ...mkRecord(recently, recently), name: '保留线索', stage: 'FOLLOWING' })
    const overdueCustomer = await orm.Customer.create({ ...mkRecord(before, before), name: '待回收客户' })
    const recentCustomer = await orm.Customer.create({ ...mkRecord(recently, recently), name: '保留客户' })
    const emitted: string[] = []
    const notifications = {
      send: async (input: { event: string; recipientIds: string[] }) => {
        assert.deepEqual(input.recipientIds, [owner.id])
        emitted.push(input.event)
      },
    } as unknown as BusinessNotificationsService
    const prisma = { client: db.client } as PrismaService
    const calculator = new PoolRuleCalculator()
    const service = new PoolRecycleService(
      prisma, notifications, new CluePoolRepository(prisma, calculator),
      new CustomerPoolRepository(prisma, calculator), new ResourceRecycleConditionEvaluator(),
    )
    const result = await service.recycleTenant(tenant.id)
    assert.deepEqual(result, { recycledLeads: 1, recycledCustomers: 1 })

    const [recycledLead, unchangedLead, recycledCustomer, unchangedCustomer] = await Promise.all([
      orm.Clue.where({ id: overdueLead.id }).first(),
      orm.Clue.where({ id: recentLead.id }).first(),
      orm.Customer.where({ id: overdueCustomer.id }).first(),
      orm.Customer.where({ id: recentCustomer.id }).first(),
    ])
    assert.equal(recycledLead?.owner, null)
    assert.equal(recycledLead?.inSharedPool, true)
    assert.equal(recycledLead?.poolId, leadPool.id)
    assert.equal(recycledLead?.reasonId, 'system')
    assert.equal(recycledCustomer?.owner, null)
    assert.equal(recycledCustomer?.inSharedPool, true)
    assert.equal(recycledCustomer?.poolId, customerPool.id)
    assert.equal(recycledCustomer?.reasonId, 'system')

    assert.equal(unchangedLead?.owner, owner.id)
    assert.equal(unchangedLead?.inSharedPool, false)
    assert.equal(unchangedCustomer?.owner, owner.id)
    assert.equal(unchangedCustomer?.inSharedPool, false)

    const [leadOwners, customerOwners] = await Promise.all([
      orm.ClueOwner.where({ clueId: overdueLead.id }).all(),
      orm.CustomerOwner.where({ customerId: overdueCustomer.id }).all(),
    ])
    assert.equal(leadOwners.length, 1)
    assert.equal(leadOwners[0]?.owner, owner.id)
    assert.equal(leadOwners[0]?.operator, 'system')
    assert.equal(customerOwners.length, 1)
    assert.equal(customerOwners[0]?.owner, owner.id)
    assert.equal(customerOwners[0]?.operator, 'system')
    assert.deepEqual(emitted.sort(), ['CLUE_AUTOMATIC_MOVE_POOL', 'CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS'].sort())

    const again = await service.recycleTenant(tenant.id)
    assert.deepEqual(again, { recycledLeads: 0, recycledCustomers: 0 })
    console.log('REAL_DB_RECYCLE_PASS', JSON.stringify({
      tenant: tenant.id, first: result, second: again,
      untouchedLeads: 1, untouchedCustomers: 1,
      ownerHistories: { lead: leadOwners.length, customer: customerOwners.length },
      notifications: emitted.length,
    }))
  } finally {
    for (const tenantId of organizationIds) {
      const clueIds = await orm.Clue.where({ organizationId: tenantId }).select('id').all()
      const customerIds = await orm.Customer.where({ organizationId: tenantId }).select('id').all()
      if (clueIds.length) await orm.ClueOwner.where((row) => row.clueId.in(clueIds.map((x) => x.id))).deleteAll()
      if (customerIds.length) await orm.CustomerOwner.where((row) => row.customerId.in(customerIds.map((x) => x.id))).deleteAll()
      await orm.Clue.where({ organizationId: tenantId }).deleteAll()
      await orm.Customer.where({ organizationId: tenantId }).deleteAll()
      const leadPools = await orm.CluePool.where({ organizationId: tenantId }).select('id').all()
      const customerPools = await orm.CustomerPool.where({ organizationId: tenantId }).select('id').all()
      if (leadPools.length) await orm.CluePoolRecycleRule.where((row) => row.poolId.in(leadPools.map((p) => p.id))).deleteAll()
      if (customerPools.length) await orm.CustomerPoolRecycleRule.where((row) => row.poolId.in(customerPools.map((p) => p.id))).deleteAll()
      await orm.CluePool.where({ organizationId: tenantId }).deleteAll()
      await orm.CustomerPool.where({ organizationId: tenantId }).deleteAll()
      await orm.Users.where({ tenantId }).deleteAll()
      await orm.Tenants.where({ id: tenantId }).deleteAll()
    }
    await db.close()
  }
})
