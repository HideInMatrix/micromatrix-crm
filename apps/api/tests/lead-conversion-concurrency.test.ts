import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthUser } from '../src/common/auth-user'
import type { LeadsService } from '../src/modules/leads/leads.service'
import type { PrismaClient } from '../src/prisma/db'
type Transaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { LeadsService } = await import('../src/modules/leads/leads.service')
  const { CluePoolRepository } = await import('../src/modules/pool-rules/clue-pool.repository')
  const { PoolRecycleTaskService } =
    await import('../src/modules/pool-rules/pool-recycle-task.service')
  const { ResourceRecycleConditionEvaluator } =
    await import('../src/modules/pool-rules/resource-recycle-condition-evaluator.service')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const id = () => randomUUID().replaceAll('-', '')
  const tenantId = id()
  const owner = id()
  const user: AuthUser = {
    id: id(),
    tenantId,
    name: 'test',
    email: null,
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: ['*'],
  }
  const recycleTasks = new PoolRecycleTaskService(
    prisma,
    new ResourceRecycleConditionEvaluator(),
    {} as never,
  )
  const poolRepository = new CluePoolRepository(prisma, {} as never, recycleTasks)
  const customerPrepared = { owner: { id: owner, deptId: null }, values: {} }
  let afterCreate: (() => Promise<void>) | undefined
  let scope: { owner?: string | { in: string[] } } = {}
  // Exercise actual conversion/association/locking SQL, replacing unrelated form/recycle-preparation
  // dependencies and external notifications with fixture-only services.
  const service = Object.assign(Object.create(LeadsService.prototype), {
    prisma,
    recycleTasks,
    dataScope: { directOwnerFilter: async () => scope },
    customers: {
      prepareCreateForTransaction: async () => customerPrepared,
      notifyCreatedCustomer: async () => {},
      createPreparedInTransaction: async (
        _u: AuthUser,
        dto: { name: string },
        _prepared: unknown,
        tx: Transaction,
      ) => {
        const now = BigInt(Date.now())
        const row = await tx.orm.public.Customer.create({
          id: id(),
          name: dto.name,
          owner,
          organizationId: tenantId,
          collectionTime: now,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        })
        await afterCreate?.()
        return row
      },
    },
    notifications: { send: async () => 0 },
  }) as LeadsService
  const seed = async () => {
    const now = BigInt(Date.now())
    return orm.Clue.create({
      id: id(),
      name: 'fixture lead',
      owner,
      collectionTime: now,
      organizationId: tenantId,
      createTime: now,
      updateTime: now,
      createUser: user.id,
      updateUser: user.id,
    })
  }
  const prepare = (lead: Awaited<ReturnType<typeof seed>>) => ({
    lead,
    customerCreateDto: { name: lead.name, ownerId: owner, customData: {} },
    customerPrepared,
    associationPrepared: { ownerMap: new Map([[owner, customerPrepared.owner]]) },
    allowUnassignedOwner: false,
  })
  const convert = (lead: Awaited<ReturnType<typeof seed>>) =>
    prisma.client.transaction((tx) =>
      service.convertResolvedLeadInTransaction(user, prepare(lead), tx),
    )
  const customerCount = async () =>
    (await orm.Customer.where({ organizationId: tenantId }).all()).length
  try {
    const lead = await seed()
    // Same-lead concurrent conversion must create exactly one customer.
    const race = await Promise.allSettled([convert(lead), convert(lead)])
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(await customerCount(), 1)
    const converted = await orm.Clue.where({ id: lead.id }).first()
    assert.ok(converted?.transitionId && converted.transitionType === 'CUSTOMER')

    // Automated recycle must recheck the transition under the shared resource lock.
    const now = BigInt(Date.now())
    const poolId = id()
    await orm.CluePool.create({
      id: poolId,
      name: 'fixture pool',
      scopeId: '["*"]',
      ownerId: '["*"]',
      organizationId: tenantId,
      auto: true,
      enable: true,
      createTime: now,
      updateTime: now,
      createUser: user.id,
      updateUser: user.id,
    })
    await assert.rejects(
      poolRepository.recycle({
        organizationId: tenantId,
        clueId: lead.id,
        poolId,
        operatorId: user.id,
      }),
      /已转客户/,
    )
    assert.equal((await orm.Clue.where({ id: lead.id }).first())?.inSharedPool, false)

    // An API conversion and the independent manual create-customer path share the lock.
    const another = await seed()
    const race2 = await Promise.allSettled([
      convert(another),
      service.transitionCustomer(user, { clueId: another.id, name: another.name, ownerId: owner }),
    ])
    assert.equal(race2.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(await customerCount(), 2)

    // A non-locking writer changing the lead after the lock re-read must not leave an orphan customer.
    const changed = await seed()
    afterCreate = async () => {
      await orm.Clue.where({ id: changed.id }).update({
        updateTime: changed.updateTime + 1n,
        name: 'concurrent update',
      })
    }
    await assert.rejects(convert(changed), /发生变化/)
    afterCreate = undefined
    assert.equal(await customerCount(), 2)
    assert.equal((await orm.Clue.where({ id: changed.id }).first())?.transitionId, null)

    // Owner filter is evaluated on the existing tenant-scoped candidate; a denied scope stays denied.
    scope = { owner: 'different-owner' }
    await assert.rejects(service.prepareResolvedLeadConversion(user, changed.id), /数据范围/)
    scope = { owner: { in: [] } }
    await assert.rejects(service.prepareResolvedLeadConversion(user, changed.id), /数据范围/)
    console.log(
      'Real PostgreSQL same-lead and cross-path conversion races, optimistic rollback, auto-recycle guard and owner-scope tests passed.',
    )
  } finally {
    await orm.PoolRecycleTask.where({ organizationId: tenantId }).deleteAndCount()
    await orm.Clue.where({ organizationId: tenantId }).deleteAndCount()
    await orm.Customer.where({ organizationId: tenantId }).deleteAndCount()
    await orm.CluePool.where({ organizationId: tenantId }).deleteAndCount()
    await prisma.onModuleDestroy()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
