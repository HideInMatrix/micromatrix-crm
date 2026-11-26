import type { PrismaClient } from '../src/prisma/db'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthUser } from '../src/common/auth-user'
import {
  createBusinessPreparationReads,
  readActiveBusinessOwner,
  memoPreparationMemberIds,
} from '../src/common/services/business-preparation-reads'

const id = () => randomUUID().replaceAll('-', '')
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant, instantFromEpochMilliseconds } = await import('../src/prisma/temporal')
  const { DataScopeService } = await import('../src/common/services/data-scope.service')
  const { ExternalEventsService } =
    await import('../src/modules/external-events/external-events.service')
  const { ExternalResourceResolverService } =
    await import('../src/modules/external-events/external-resource-resolver.service')
  const { ExternalEventTemplatesService } =
    await import('../src/modules/external-events/external-event-templates.service')
  const { ResourcePoolsService } = await import('../src/modules/pool-rules/resource-pools.service')
  const { CluePoolRepository } = await import('../src/modules/pool-rules/clue-pool.repository')
  const { CustomerPoolRepository } =
    await import('../src/modules/pool-rules/customer-pool.repository')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const tenantId = id(),
    otherTenant = id(),
    actor = id(),
    owner = id(),
    other = id(),
    dept = id()
  const user: AuthUser = {
    id: actor,
    tenantId,
    name: 'fixture',
    email: null,
    deptId: dept,
    leaderId: null,
    roles: [
      {
        id: id(),
        name: 'fixture',
        permissions: ['lead:update', 'leadPool:assign'],
        dataScope: 'DEPT',
        scopeDeptIds: [],
      },
    ],
    permissions: ['lead:update', 'leadPool:assign'],
  }
  const now = nowInstant()
  const t = BigInt(Date.now())
  const times = { createTime: t, updateTime: t, createUser: actor, updateUser: actor }
  const scopeService = new DataScopeService(prisma)
  const poolRepo = new CluePoolRepository(prisma, {} as never, {} as never)
  const customerRepo = new CustomerPoolRepository(prisma, {} as never, {} as never)
  const pools = new ResourcePoolsService(prisma, poolRepo, customerRepo, {} as never)
  const resolver = new ExternalResourceResolverService(
    prisma,
    scopeService,
    {
      listFields: async () => [
        { id: 'phone', key: 'phone', label: 'Phone', system: true, type: 'input' },
      ],
    } as never,
    {} as never,
    pools,
  )
  const templates = new ExternalEventTemplatesService(
    prisma,
    {} as never,
    resolver,
    {} as never,
    {} as never,
  )
  const events = new ExternalEventsService(prisma, resolver, {} as never, {} as never, {} as never)
  type Claim = { row: { id: string; attempts: number }; replayed: boolean }
  const claim = (u: AuthUser, event: string, hash = 'a'.repeat(64), source = 'fixture') =>
    (
      events as unknown as {
        claimInbox(
          u: AuthUser,
          source: string,
          event: string,
          hash: string,
          type: string,
          insertFirst: boolean,
        ): Promise<Claim>
      }
    ).claimInbox(u, source, event, hash, 'EVENT_FIXTURE', true)
  const code = (e: unknown) => (e as { getResponse?: () => { code?: string } }).getResponse?.().code
  try {
    for (const tenant of [tenantId, otherTenant])
      await orm.Tenants.create({ id: tenant, name: tenant, slug: tenant, updatedAt: now })
    await orm.Departments.create({ id: dept, tenantId, name: 'fixture', updatedAt: now })
    await orm.Users.createAll(
      [
        { id: actor, tenantId, deptId: dept },
        { id: owner, tenantId, deptId: dept },
        { id: other, tenantId: otherTenant },
      ].map((row) => ({ ...row, name: 'fixture', passwordHash: 'unused-fixture', updatedAt: now })),
    )
    const prep = createBusinessPreparationReads()
    let mappingReads = 0
    const mappingRead = (tenant: string, provider: string) =>
      memoPreparationMemberIds(tenant, provider, 'fixture', async () => {
        mappingReads++
        return [owner]
      })
    const [mappingA, mappingB] = await prep.run(() =>
      Promise.all([mappingRead(tenantId, 'WECOM'), mappingRead(tenantId, 'WECOM')]),
    )
    assert.equal(mappingA, mappingB)
    assert.equal(mappingReads, 1)
    await prep.run(() => mappingRead(tenantId, 'DINGTALK'))
    await prep.run(() => mappingRead(otherTenant, 'WECOM'))
    await createBusinessPreparationReads().run(() => mappingRead(tenantId, 'WECOM'))
    assert.equal(mappingReads, 4)
    await assert.rejects(
      prep.run(() =>
        memoPreparationMemberIds(tenantId, 'WECOM', 'retry', async () => {
          throw new Error('fixture read error')
        }),
      ),
      /fixture read error/,
    )
    assert.deepEqual(
      await prep.run(() =>
        memoPreparationMemberIds(tenantId, 'WECOM', 'retry', async () => [owner]),
      ),
      [owner],
    )
    const first = await prep.run(() => readActiveBusinessOwner(prisma, tenantId, owner))
    assert.deepEqual(first, { id: owner, deptId: dept })
    assert.equal(await prep.run(() => readActiveBusinessOwner(prisma, tenantId, owner)), first)
    assert.equal(await prep.run(() => readActiveBusinessOwner(prisma, otherTenant, owner)), null)
    let scopeCalls = 0
    const resolveScope = scopeService.resolveScope.bind(scopeService)
    scopeService.resolveScope = async (...args) => {
      scopeCalls++
      return resolveScope(...args)
    }
    const filter = await prep.run(() => scopeService.directOwnerFilter(user, 'lead:update'))
    assert.deepEqual(
      new Set(typeof filter.owner === 'object' ? filter.owner.in : []),
      new Set([actor, owner]),
    )
    assert.equal(await prep.run(() => scopeService.directOwnerFilter(user, 'lead:update')), filter)
    assert.equal(scopeCalls, 1)
    assert.deepEqual(
      await prep.run(() => scopeService.directOwnerFilter(user, 'customer:update')),
      { owner: '__permission_scope_denied__' },
    )
    assert.equal(scopeCalls, 2)
    const denied = { ...user, roles: [], permissions: [] }
    assert.deepEqual(await prep.run(() => scopeService.directOwnerFilter(denied, 'lead:update')), {
      owner: '__permission_scope_denied__',
    })
    assert.equal(scopeCalls, 3)
    await scopeService.directOwnerFilter(user, 'lead:update')
    assert.equal(scopeCalls, 4)
    // Fresh operations observe a disabled member, even after an earlier read.
    await orm.Users.where({ id: owner, tenantId }).update({ status: 'DISABLED', updatedAt: now })
    assert.equal(
      await createBusinessPreparationReads().run(() =>
        readActiveBusinessOwner(prisma, tenantId, owner),
      ),
      null,
    )
    assert.equal(await readActiveBusinessOwner(prisma, tenantId, owner), null)
    await assert.rejects(
      pools.assertCapacityForOwner(tenantId, 'lead', owner),
      /负责人不存在或已禁用/,
    )
    await orm.Users.where({ id: owner, tenantId }).update({ status: 'ACTIVE', updatedAt: now })

    const poolId = id(),
      foreignPool = id()
    for (const [pid, tenant] of [
      [poolId, tenantId],
      [foreignPool, otherTenant],
    ]) {
      await orm.CluePool.create({
        id: pid!,
        organizationId: tenant!,
        name: 'fixture',
        scopeId: '[]',
        ownerId: '[]',
        enable: false,
        ...times,
      })
    }
    assert.deepEqual(await pools.listIds(user, 'lead'), [poolId])
    const normal = await orm.Clue.create({
      id: id(),
      organizationId: tenantId,
      name: 'fixture',
      phone: '000fixture',
      owner,
      ...times,
    })
    assert.equal(
      (
        (await resolver.resolveTarget(user, 'lead', { id: normal.id }, false, true)) as {
          leadId: string
        }
      ).leadId,
      normal.id,
    )
    await orm.Clue.create({
      id: id(),
      organizationId: tenantId,
      name: 'duplicate',
      phone: '000fixture',
      poolId,
      inSharedPool: true,
      ...times,
    })
    await assert.rejects(
      resolver.resolveTarget(user, 'lead', { phone: '000fixture' }, false, true),
      (e) => code(e) === 'NON_UNIQUE_MATCH',
    )
    await assert.rejects(
      resolver.resolveTarget(denied, 'lead', { id: normal.id }, false, true),
      (e) => code(e) === 'PERMISSION_DENIED',
    )
    // No finite capacity: preserve active-owner validation but skip roles/departments.
    const limited = pools as unknown as {
      loadUserScopeTokens: (...args: unknown[]) => Promise<Set<string>>
    }
    const oldTokens = limited.loadUserScopeTokens.bind(pools)
    limited.loadUserScopeTokens = async () => {
      throw new Error('unexpected scope expansion')
    }
    await pools.assertCapacityForOwner(tenantId, 'lead', owner)
    await orm.ClueCapacity.create({
      id: id(),
      organizationId: tenantId,
      scopeId: JSON.stringify([owner]),
      capacity: null,
      ...times,
    })
    await pools.assertCapacityForOwner(tenantId, 'lead', owner)
    limited.loadUserScopeTokens = oldTokens
    await orm.ClueCapacity.create({
      id: id(),
      organizationId: tenantId,
      scopeId: JSON.stringify([owner]),
      capacity: 0,
      ...times,
      createTime: t + 1n,
    })
    await assert.rejects(pools.assertCapacityForOwner(tenantId, 'lead', owner), /库容上限/)
    await pools.assertCapacityForOwner(tenantId, 'customer', owner)

    // Same external identity maps to an active tenant member; ambiguity fails closed.
    const member = templates as unknown as {
      resolveMember(u: AuthUser, key: string, p: string): Promise<string>
      resolveMemberOptional(u: AuthUser, key: string, p: string): Promise<string | null>
    }
    await orm.ExternalUserMappings.create({
      tenantId,
      userId: owner,
      provider: 'WECOM',
      externalId: 'fixture',
      externalKey: 'fixture-owner',
      updatedAt: now,
    })
    assert.equal(await member.resolveMember(user, 'fixture', 'WECOM'), owner)
    await orm.ExternalUserMappings.create({
      tenantId,
      userId: actor,
      provider: 'WECOM',
      externalId: 'fixture',
      externalKey: 'fixture-actor',
      updatedAt: now,
    })
    await assert.rejects(member.resolveMember(user, 'fixture', 'WECOM'), /无法唯一映射/)
    assert.equal(await member.resolveMemberOptional(user, 'fixture', 'WECOM'), null)

    // Fresh event uses the unique constraint as the arbiter across concurrent inserts.
    const claims = await Promise.allSettled(Array.from({ length: 8 }, () => claim(user, 'race')))
    const wins = claims.filter((x): x is PromiseFulfilledResult<Claim> => x.status === 'fulfilled')
    assert.equal(wins.length, 1)
    for (const loss of claims.filter((x) => x.status === 'rejected'))
      assert.equal(code(loss.reason), 'EVENT_PROCESSING')
    const winner = wins[0]!.value
    assert.equal(winner.replayed, false)
    assert.equal(
      (
        await orm.ExternalEventInbox.where({
          organizationId: tenantId,
          source: 'fixture',
          externalEventId: 'race',
        }).all()
      ).length,
      1,
    )
    await assert.rejects(
      claim(user, 'race', 'b'.repeat(64)),
      (e) => code(e) === 'IDEMPOTENCY_KEY_REUSED',
    )
    await orm.ExternalEventInbox.where({ id: winner.row.id }).update({
      status: 'SUCCESS',
      resolvedType: 'LEAD',
      resolvedId: normal.id,
      completedAt: now,
      updatedAt: now,
    })
    const replay = await claim(user, 'race')
    assert.equal(replay.replayed, true)
    assert.equal(replay.row.id, winner.row.id)
    assert.equal(replay.row.attempts, 1)
    await assert.rejects(
      claim(user, 'race', 'b'.repeat(64)),
      (e) => code(e) === 'IDEMPOTENCY_KEY_REUSED',
    )
    assert.equal((await claim(user, 'race', 'a'.repeat(64), 'fixture-other')).replayed, false)
    assert.equal(
      (await claim({ ...user, tenantId: otherTenant, id: other }, 'race')).replayed,
      false,
    )

    const failed = await claim(user, 'failed')
    await orm.ExternalEventInbox.where({ id: failed.row.id }).update({
      status: 'FAILED',
      updatedAt: now,
    })
    const recovered = await claim(user, 'failed')
    assert.equal(recovered.row.id, failed.row.id)
    assert.equal(recovered.row.attempts, 2)
    const stale = await claim(user, 'stale')
    await orm.ExternalEventInbox.where({ id: stale.row.id }).update({
      updatedAt: instantFromEpochMilliseconds(Date.now() - 16 * 60 * 1000),
    })
    const takes = await Promise.allSettled([claim(user, 'stale'), claim(user, 'stale')])
    assert.equal(takes.filter((x) => x.status === 'fulfilled').length, 1)
    assert.equal((await orm.ExternalEventInbox.where({ id: stale.row.id }).first())?.attempts, 2)
    type Tx = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
    const audit = {
      user,
      source: 'fixture',
      externalEventId: 'stale',
      eventType: 'EVENT_FIXTURE',
      businessAction: 'create',
      request: {},
    }
    type Commit = {
      inboxId: string
      attempts: number
      requestHash: string
      resolvedType: 'LEAD'
      resolvedId: string
      customerId: null
      audit: typeof audit
    }
    const internals = events as unknown as {
      markSuccessInTransaction(
        tx: Tx,
        input: Commit,
      ): Promise<{ attempts: number; resolvedId: string }>
      markFailed(
        audit: typeof audit,
        inboxId: string,
        attempts: number,
        hash: string,
        error: Error,
      ): Promise<void>
    }
    const obsoleteId = id()
    const commit = {
      inboxId: stale.row.id,
      attempts: 1,
      requestHash: 'a'.repeat(64),
      resolvedType: 'LEAD' as const,
      resolvedId: obsoleteId,
      customerId: null,
      audit,
    }
    await assert.rejects(
      prisma.client.transaction(async (tx) => {
        await tx.orm.public.Clue.create({
          id: obsoleteId,
          organizationId: tenantId,
          name: 'obsolete attempt',
          ...times,
        })
        await internals.markSuccessInTransaction(tx, commit)
      }),
      (e) => code(e) === 'EVENT_STATE_CHANGED',
    )
    assert.equal(await orm.Clue.where({ id: obsoleteId, organizationId: tenantId }).first(), null)
    await internals.markFailed(audit, stale.row.id, 1, commit.requestHash, new Error('obsolete'))
    assert.equal(
      (await orm.ExternalEventInbox.where({ id: stale.row.id }).first())?.status,
      'PROCESSING',
    )
    assert.equal((await orm.OperationLogs.where({ tenantId }).all()).length, 0)
    // Two concurrent commits with the same valid generation cannot both persist business data.
    const commitOne = () =>
      prisma.client.transaction(async (tx) => {
        const resourceId = id()
        await tx.orm.public.Clue.create({
          id: resourceId,
          organizationId: tenantId,
          name: 'attempt winner',
          ...times,
        })
        return internals.markSuccessInTransaction(tx, {
          ...commit,
          attempts: 2,
          resolvedId: resourceId,
        })
      })
    const results = await Promise.allSettled([commitOne(), commitOne()])
    const committed = results.filter((x) => x.status === 'fulfilled')
    assert.equal(committed.length, 1)
    assert.equal(
      (await orm.Clue.where({ organizationId: tenantId, name: 'attempt winner' }).all()).length,
      1,
    )
    assert.equal((await orm.OperationLogs.where({ tenantId }).all()).length, 1)
    const final = await claim(user, 'stale')
    assert.equal(final.replayed, true)
    assert.equal(final.row.attempts, 2)
    await internals.markFailed(
      audit,
      stale.row.id,
      2,
      commit.requestHash,
      new Error('late failure'),
    )
    assert.equal(
      (await orm.ExternalEventInbox.where({ id: stale.row.id }).first())?.status,
      'SUCCESS',
    )
    console.log(
      'Preparation read isolation, permission, pool projection, capacity, mapping, and concurrent Inbox claim/replay/retry tests passed.',
    )
  } finally {
    for (const tenant of [tenantId, otherTenant]) {
      await orm.OperationLogs.where({ tenantId: tenant }).deleteAll()
      await orm.ExternalEventInbox.where({ organizationId: tenant }).deleteAll()
      await orm.Clue.where({ organizationId: tenant }).deleteAll()
      await orm.ClueCapacity.where({ organizationId: tenant }).deleteAll()
      await orm.CluePool.where({ organizationId: tenant }).deleteAll()
      await orm.ExternalUserMappings.where({ tenantId: tenant }).deleteAll()
      await orm.Users.where({ tenantId: tenant }).deleteAll()
      await orm.Departments.where({ tenantId: tenant }).deleteAll()
      await orm.Tenants.where({ id: tenant }).deleteAll()
    }
    await prisma.onModuleDestroy()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
