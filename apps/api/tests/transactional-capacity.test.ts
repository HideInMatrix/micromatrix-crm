import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthUser } from '../src/common/auth-user'
import type { CustomersService } from '../src/customers/customers.service'
import type { LeadsService } from '../src/modules/leads/leads.service'

const id = () => randomUUID().replaceAll('-', '')
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function within<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('concurrent transaction did not reach barrier')),
          ms,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant } = await import('../src/prisma/temporal')
  const { CustomersService } = await import('../src/customers/customers.service')
  const { LeadsService } = await import('../src/modules/leads/leads.service')
  const { CluePoolRepository } = await import('../src/modules/pool-rules/clue-pool.repository')
  const { CustomerPoolRepository } =
    await import('../src/modules/pool-rules/customer-pool.repository')
  const { PoolRuleCalculator } =
    await import('../src/modules/pool-rules/pool-rule-calculator.service')
  const { ResourcePoolsService } = await import('../src/modules/pool-rules/resource-pools.service')
  const { ExternalEventPerformance } = await import('../src/common/external-event-performance')
  const { readOwnedCapacity } = await import('../src/modules/pool-rules/transactional-capacity')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const tenantId = id()
  const operator = id()
  const owners = Array.from({ length: 10 }, id)
  const [
    unlimited,
    limited,
    claimant,
    transferee,
    leadOwner,
    mergeOwner,
    mergeOther,
    zeroOwner,
    configOwner,
    rollbackOwner,
  ] = owners
  const user: AuthUser = {
    id: operator,
    tenantId,
    name: 'fixture',
    email: null,
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: ['*'],
  }
  const now = BigInt(Date.now())
  const timestamps = {
    createTime: now,
    updateTime: now,
    createUser: operator,
    updateUser: operator,
  }
  const noRecycle = {
    refreshCreatedInTransaction: async () => {},
    refreshCustomerInTransaction: async () => {},
    refreshLeadInTransaction: async () => {},
    cancelInTransaction: async () => {},
  }
  const calculator = new PoolRuleCalculator()
  const cluePools = new CluePoolRepository(prisma, calculator, noRecycle as never)
  const customerPools = new CustomerPoolRepository(prisma, calculator, noRecycle as never)
  const pools = new ResourcePoolsService(prisma, cluePools, customerPools, {} as never)
  let afterCustomerWrite: (() => Promise<void>) | undefined
  const customerService = Object.assign(Object.create(CustomersService.prototype), {
    prisma,
    pools,
    recycleTasks: noRecycle,
    fieldValues: {
      saveNew: async () => {
        await afterCustomerWrite?.()
      },
    },
    notifications: { send: async () => 0 },
    changeLog: { record: async () => {} },
  }) as CustomersService
  const leadService = Object.assign(Object.create(LeadsService.prototype), {
    prisma,
    pools,
    customers: customerService,
    recycleTasks: noRecycle,
    fieldValues: { saveNew: async () => {} },
  }) as LeadsService
  const owner = (id: string) => ({ id, deptId: null, name: 'fixture owner' })
  const customerPrepared = (id: string) => ({ owner: owner(id), values: {} })
  const createCustomer = (ownerId: string, perf?: InstanceType<typeof ExternalEventPerformance>) =>
    prisma.client.transaction((tx) =>
      customerService.createPreparedInTransaction(
        user,
        { name: 'fixture customer', ownerId },
        customerPrepared(ownerId),
        tx,
        perf,
      ),
    )
  const seedLead = (ownerId: string, extra: Partial<Parameters<typeof orm.Clue.create>[0]> = {}) =>
    orm.Clue.create({
      id: id(),
      name: 'fixture lead',
      organizationId: tenantId,
      owner: ownerId,
      collectionTime: now,
      ...timestamps,
      ...extra,
    })
  const seedCustomer = (
    ownerId: string | null,
    extra: Partial<Parameters<typeof orm.Customer.create>[0]> = {},
  ) =>
    orm.Customer.create({
      id: id(),
      name: 'fixture customer',
      organizationId: tenantId,
      owner: ownerId,
      collectionTime: ownerId ? now : null,
      ...timestamps,
      ...extra,
    })
  const convert = (
    lead: Awaited<ReturnType<typeof seedLead>>,
    customerOwnerId: string,
    perf?: InstanceType<typeof ExternalEventPerformance>,
  ) =>
    prisma.client.transaction((tx) =>
      leadService.convertResolvedLeadInTransaction(
        user,
        {
          lead,
          customerCreateDto: { name: lead.name, ownerId: customerOwnerId, customData: {} },
          customerPrepared: customerPrepared(customerOwnerId),
          associationPrepared: {
            ownerMap: new Map(lead.owner ? [[lead.owner, owner(lead.owner)]] : []),
          },
          allowUnassignedOwner: false,
        },
        tx,
        perf,
      ),
    )
  const createLead = (ownerId: string) =>
    prisma.client.transaction((tx) =>
      leadService.createPreparedExternalLeadInTransaction(
        user,
        {
          dto: { name: 'fixture new lead' },
          owner: owner(ownerId),
          targetPool: null,
          uniqueScope: undefined,
        } as never,
        tx,
      ),
    )
  const count = (domain: 'clue' | 'customer', ownerId: string) =>
    readOwnedCapacity(prisma.client, domain, tenantId, ownerId)
  const exactlyOne = async (jobs: Promise<unknown>[]) => {
    const outcomes = await Promise.allSettled(jobs)
    assert.equal(
      outcomes.filter((row) => row.status === 'fulfilled').length,
      1,
      JSON.stringify(
        outcomes.map((row) => (row.status === 'rejected' ? String(row.reason) : 'ok')),
      ),
    )
    for (const result of outcomes)
      if (result.status === 'rejected') assert.match(String(result.reason), /库容/)
  }
  const customerPoolId = id(),
    cluePoolId = id()
  try {
    await orm.Tenants.create({
      id: tenantId,
      name: 'capacity test',
      slug: tenantId,
      updatedAt: nowInstant(),
    })
    await orm.Users.createAll(
      [operator, ...owners].map((id) => ({
        id,
        tenantId,
        name: 'fixture',
        passwordHash: 'unused-test-fixture',
        updatedAt: nowInstant(),
      })),
    )
    await orm.CustomerPool.create({
      id: customerPoolId,
      organizationId: tenantId,
      name: 'customer pool',
      scopeId: '["*"]',
      ownerId: '["*"]',
      enable: true,
      auto: false,
      ...timestamps,
    })
    await orm.CluePool.create({
      id: cluePoolId,
      organizationId: tenantId,
      name: 'clue pool',
      scopeId: '["*"]',
      ownerId: '["*"]',
      enable: true,
      auto: false,
      ...timestamps,
    })

    // No finite rules: two conversions for different leads/same owner must overlap
    // inside the actual customer creation transaction, not just finish successfully.
    const leads = await Promise.all([seedLead(unlimited), seedLead(unlimited)])
    const gate = deferred(),
      both = deferred()
    let arrivals = 0
    afterCustomerWrite = async () => {
      if (++arrivals === 2) both.resolve()
      await gate.promise
    }
    const concurrent = leads.map((lead) => convert(lead, unlimited))
    try {
      await within(both.promise)
    } finally {
      gate.resolve()
      await Promise.allSettled(concurrent)
      afterCustomerWrite = undefined
    }
    assert.equal(arrivals, 2)
    assert.equal(await count('customer', unlimited), 2)
    assert.equal(await count('clue', unlimited), 0)

    // Lock granularity allows concurrent ordinary conversions while
    // retaining the exact same resource lock used by other lead ownership operations.
    const once = await seedLead(unlimited)
    let tick = 0
    const perf = new ExternalEventPerformance(true, () => (tick += 100))
    const same = await Promise.allSettled([
      convert(once, unlimited, perf),
      convert(once, unlimited),
    ])
    assert.equal(same.filter((x) => x.status === 'fulfilled').length, 1)
    assert.equal(await count('customer', unlimited), 3)
    let stages: Record<string, number> = {}
    perf.finish('convert', same[0]?.status === 'fulfilled', (line) => {
      stages = JSON.parse(line).stagesMs
    })
    assert.ok('conversion_resource_lock' in stages)
    assert.ok(!('conversion_lead_owner_lock' in stages))
    if (same[0]?.status === 'fulfilled') {
      assert.ok('capacity_config_lock' in stages && 'capacity_rule_read' in stages)
      assert.ok(!('capacity_owner_lock' in stages))
    }

    // Configuration edits cannot slip between an unlimited decision and commit.
    const entered = deferred(),
      release = deferred()
    afterCustomerWrite = async () => {
      entered.resolve()
      await release.promise
    }
    const inflight = createCustomer(configOwner)
    let configFinished = false
    let setting: Promise<unknown> | undefined
    try {
      await within(entered.promise)
      setting = customerPools
        .createCapacity(tenantId, operator, { scopeIds: ['*'], capacity: 1 })
        .then((value) => {
          configFinished = true
          return value
        })
      // Try-lock verifies the shared configuration lock in PostgreSQL without timing assumptions.
      const { poolCapacityConfigLockKey } =
        await import('../src/modules/pool-rules/pool-transaction-lock')
      const key = poolCapacityConfigLockKey('customer', tenantId)
      const locked = await prisma.client.transaction(async (tx) => {
        const q = prisma.client.raw
          .sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key},0)) AS locked`.returnsRow({
          locked: 'pg/bool@1',
        })
        for await (const row of tx.query(q.build())) return row.locked
      })
      assert.equal(locked, false)
      assert.equal(configFinished, false)
    } finally {
      release.resolve()
      await inflight
      afterCustomerWrite = undefined
      await setting
    }
    assert.equal(configFinished, true)
    await assert.rejects(createCustomer(configOwner), /库容/)
    assert.equal(await count('customer', configOwner), 1)

    // Same owner, finite capacity: only one of ten real conversion transactions wins.
    const competingLeads = await Promise.all(Array.from({ length: 10 }, () => seedLead(limited)))
    await exactlyOne(competingLeads.map((lead) => convert(lead, limited)))
    assert.equal(await count('customer', limited), 1)
    assert.equal(await count('clue', limited), 9)

    // Conversion competes with actual pool claim, transfer and direct creation.
    const pooled = await seedCustomer(null, { inSharedPool: true, poolId: customerPoolId })
    const claimLead = await seedLead(claimant)
    await exactlyOne([
      convert(claimLead, claimant),
      customerPools.pick({
        organizationId: tenantId,
        customerId: pooled.id,
        ownerId: claimant,
        operatorId: operator,
      }),
    ])
    assert.equal(await count('customer', claimant), 1)
    const transferred = await seedCustomer(mergeOther)
    const transferLead = await seedLead(transferee)
    await exactlyOne([
      convert(transferLead, transferee),
      customerPools.transfer({
        organizationId: tenantId,
        customerId: transferred.id,
        ownerId: transferee,
        operatorId: operator,
      }),
    ])
    assert.equal(await count('customer', transferee), 1)
    const directLead = await seedLead(zeroOwner)
    await exactlyOne([convert(directLead, zeroOwner), createCustomer(zeroOwner)])
    assert.equal(await count('customer', zeroOwner), 1)

    // A failed transaction does not reserve capacity.
    await assert.rejects(
      prisma.client.transaction(async (tx) => {
        await customerService.createPreparedInTransaction(
          user,
          { name: 'rollback customer', ownerId: rollbackOwner },
          customerPrepared(rollbackOwner),
          tx,
        )
        throw new Error('intentional rollback')
      }),
      /intentional rollback/,
    )
    assert.equal(await count('customer', rollbackOwner), 0)
    const finitePerf = new ExternalEventPerformance(true, () => (tick += 100))
    await createCustomer(rollbackOwner, finitePerf)
    finitePerf.finish('create', true, (line) => {
      stages = JSON.parse(line).stagesMs
    })
    assert.ok('capacity_owner_lock' in stages && 'capacity_recheck' in stages)
    assert.equal(await count('customer', rollbackOwner), 1)

    // Merge with net +1 competes with a conversion. Prepare snapshots using real DB
    // rows; mock only access/UI preparation and notification side effects.
    const target = await seedCustomer(mergeOther)
    const source = await seedCustomer(mergeOther)
    Object.assign(customerService, {
      prepareMergeContext: async () => ({
        sourceIds: [source.id],
        target,
        sources: [source],
        newOwner: owner(mergeOwner),
      }),
    })
    const mergeLead = await seedLead(mergeOwner)
    await exactlyOne([
      convert(mergeLead, mergeOwner),
      customerService.merge(user, {
        toMergeId: target.id,
        mergeIds: [target.id, source.id],
        ownerId: mergeOwner,
      }),
    ])
    assert.equal(await count('customer', mergeOwner), 1)
    // Net-zero merge is allowed at the limit.
    const existingOwned = await orm.Customer.where({
      organizationId: tenantId,
      owner: mergeOwner,
    }).first()
    assert.ok(existingOwned)
    const otherTarget = await seedCustomer(mergeOther)
    Object.assign(customerService, {
      prepareMergeContext: async () => ({
        sourceIds: [existingOwned.id],
        target: otherTarget,
        sources: [existingOwned],
        newOwner: owner(mergeOwner),
      }),
    })
    await customerService.merge(user, {
      toMergeId: otherTarget.id,
      mergeIds: [otherTarget.id, existingOwned.id],
      ownerId: mergeOwner,
    })
    assert.equal(await count('customer', mergeOwner), 1)

    // Lead capacity counts only active unconverted leads, across create and claim.
    await cluePools.createCapacity(tenantId, operator, { scopeIds: [leadOwner], capacity: 1 })
    await seedLead(leadOwner, { transitionType: 'CUSTOMER', transitionId: id() })
    const leadInPool = await seedLead(leadOwner, {
      owner: null,
      collectionTime: null,
      inSharedPool: true,
      poolId: cluePoolId,
    })
    await exactlyOne([
      createLead(leadOwner),
      cluePools.assign({
        organizationId: tenantId,
        clueId: leadInPool.id,
        ownerId: leadOwner,
        operatorId: operator,
      }),
    ])
    assert.equal(await count('clue', leadOwner), 1)
    await assert.rejects(pools.assertCapacityForOwner(tenantId, 'lead', leadOwner), /库容/)
    const activeLead = await orm.Clue.where({
      organizationId: tenantId,
      owner: leadOwner,
      transitionId: null,
    }).first()
    assert.ok(activeLead)
    await orm.Clue.where({ id: activeLead.id }).update({ transitionType: null, transitionId: '' })
    assert.equal(await count('clue', leadOwner), 1)

    // A finite zero capacity (not NULL) must reject every attempted creation.
    const cap = await orm.CustomerCapacity.where({ organizationId: tenantId }).first()
    assert.ok(cap)
    await customerPools.updateCapacity(tenantId, cap.id, operator, { scopeIds: ['*'], capacity: 0 })
    await assert.rejects(createCustomer(mergeOther), /库容/)
    await customerPools.deleteCapacity(tenantId, cap.id)
    await createCustomer(mergeOther)
    console.log(
      'PostgreSQL capacity tests passed: real concurrent conversion, same-lead guard, configuration exclusion, finite limits, pool claim, transfer, direct create, rollback, merge net delta, lead count, zero capacity and rule deletion.',
    )
  } finally {
    await orm.PoolRecycleTask.where({ organizationId: tenantId }).deleteAndCount()
    await orm.Clue.where({ organizationId: tenantId }).deleteAndCount()
    await orm.Customer.where({ organizationId: tenantId }).deleteAndCount()
    await orm.ClueCapacity.where({ organizationId: tenantId }).deleteAndCount()
    await orm.CustomerCapacity.where({ organizationId: tenantId }).deleteAndCount()
    await orm.CluePool.where({ organizationId: tenantId }).deleteAndCount()
    await orm.CustomerPool.where({ organizationId: tenantId }).deleteAndCount()
    await orm.Users.where({ tenantId }).deleteAndCount()
    await orm.Tenants.where({ id: tenantId }).deleteAndCount()
    await prisma.onModuleDestroy()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
