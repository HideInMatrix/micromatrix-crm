import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { LeadsService } from '../leads/leads.service'
import { ExternalResourceResolverService } from './external-resource-resolver.service'
import { ExternalEventTemplatesService } from './external-event-templates.service'

const user = {
  id: 'integration-user',
  tenantId: 'tenant-1',
  permissions: ['lead:update', 'leadPool:assign', 'customer:create', 'lead:convert'],
} as AuthUser
const pooledLead = {
  id: 'pooled-lead',
  name: '池内线索',
  owner: null,
  inSharedPool: true,
  poolId: 'lead-pool-1',
  updateTime: 10n,
  transitionId: null,
  transitionType: 'NONE',
}

function setupPrepare() {
  const service = Object.create(LeadsService.prototype) as unknown as {
    prisma: unknown
    pools: unknown
    customers: unknown
    assertFunctionalPermission: () => void
    mapLeadCustomData: () => Promise<Record<string, unknown>>
    prepareLeadAssociation: (_user: AuthUser, leads: unknown[]) => Promise<unknown>
    prepareResolvedLeadConversion: LeadsService['prepareResolvedLeadConversion']
  }
  const calls: unknown[][] = []
  service.prisma = {
    client: { orm: { public: { Clue: { where: () => ({ first: async () => pooledLead }) } } } },
  }
  service.pools = { assertPoolMember: async () => ({ enable: true }) }
  service.customers = {
    prepareCreateForTransaction: async (_user: AuthUser, dto: { ownerId: string }) => ({
      owner: { id: dto.ownerId },
    }),
  }
  service.assertFunctionalPermission = () => undefined
  service.mapLeadCustomData = async () => ({ cf_test: 'source' })
  service.prepareLeadAssociation = async (_user, leads) => {
    calls.push(leads)
    return { ownerMap: new Map([['owner-1', { id: 'owner-1' }]]) }
  }
  return { service, calls }
}

test('池内无负责人的线索可以使用第 5 步映射的 CRM 成员转化', async () => {
  const { service, calls } = setupPrepare()
  const prepared = await service.prepareResolvedLeadConversion(user, pooledLead.id, {}, 'owner-1')
  assert.equal(prepared.lead.owner, null)
  assert.equal(prepared.customerCreateDto.ownerId, 'owner-1')
  assert.equal((calls[0]?.[0] as { owner: string }).owner, 'owner-1')
  assert.equal(prepared.customerCreateDto.customData.cf_test, 'source')
})

test('池内转化缺少映射负责人必须拒绝，不能默认分配给 API Key 所有者', async () => {
  const { service } = setupPrepare()
  await assert.rejects(
    () => service.prepareResolvedLeadConversion(user, pooledLead.id),
    BadRequestException,
  )
})

test('无池分配权限的外部事件不能转化池内线索', async () => {
  const { service } = setupPrepare()
  await assert.rejects(
    () =>
      service.prepareResolvedLeadConversion(
        { ...user, permissions: ['lead:update', 'customer:create'] },
        pooledLead.id,
        {},
        'owner-1',
      ),
    ForbiddenException,
  )
})

test('池内转化在同一事务中先出池指定负责人，再创建并关联 Customer', async () => {
  const events: string[] = []
  const service = Object.create(LeadsService.prototype) as unknown as {
    prisma: unknown
    customers: unknown
    associateLeadsToCustomerInTransaction: (...args: unknown[]) => Promise<unknown>
    convertResolvedLeadInTransaction: LeadsService['convertResolvedLeadInTransaction']
  }
  service.prisma = {
    client: {
      raw: {
        sql: () => ({ returnsRow: () => ({ build: () => ({}) }) }),
      },
    },
  }
  service.customers = {
    createPreparedInTransaction: async () => {
      events.push('create-customer')
      return { id: 'customer-1' }
    },
  }
  service.associateLeadsToCustomerInTransaction = async (_tx, _user, leads) => {
    const lead = (leads as Array<{ owner: string; inSharedPool: boolean }>)[0]
    assert.equal(lead?.owner, 'owner-1')
    assert.equal(lead?.inSharedPool, false)
    events.push('associate')
    return { contactIds: [] }
  }
  const tx = {
    query: async function* () {
      yield { locked: 1 }
    },
    orm: {
      public: {
        Clue: {
          where: () => ({
            first: async () => ({ ...pooledLead }),
            update: async (data: Record<string, unknown>) => {
              assert.equal(data.owner, 'owner-1')
              assert.equal(data.inSharedPool, false)
              assert.equal(data.poolId, null)
              events.push('leave-pool')
              return { ...pooledLead, ...data }
            },
          }),
        },
        CluePool: { where: () => ({ first: async () => ({ id: 'lead-pool-1', enable: true }) }) },
      },
    },
  }
  const prepared = {
    lead: pooledLead,
    customerCreateDto: { ownerId: 'owner-1', name: pooledLead.name, customData: {} },
    customerPrepared: { owner: { id: 'owner-1' } },
    associationPrepared: { ownerMap: new Map([['owner-1', { id: 'owner-1' }]]) },
  }
  const result = await service.convertResolvedLeadInTransaction(
    user,
    prepared as never,
    tx as never,
  )
  assert.equal(result.customerId, 'customer-1')
  assert.deepEqual(events, ['leave-pool', 'create-customer', 'associate'])
})

test('同一定位条件同时命中普通线索与有权限的池内线索时不允许猜测', async () => {
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    validateWhere: (where: Record<string, unknown>) => Array<[string, unknown]>
    prepareWhere: () => Promise<{ supported: boolean; conditions: []; system: []; issues: [] }>
    findLeads: (_user: AuthUser, _where: unknown, includePool: boolean) => Promise<unknown[]>
    resolveTarget: ExternalResourceResolverService['resolveTarget']
  }
  resolver.validateWhere = (where) => Object.entries(where)
  resolver.prepareWhere = async () => ({ supported: true, conditions: [], system: [], issues: [] })
  resolver.findLeads = async (_user, _where, includePool) =>
    includePool
      ? [{ id: 'regular', owner: 'owner-1', transitionId: null }, pooledLead]
      : [{ id: 'regular', owner: 'owner-1', transitionId: null }]
  await assert.rejects(
    () => resolver.resolveTarget(user, 'lead', { phone: '13800000000' }, false, true),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException)
      assert.equal((error.getResponse() as { code?: string }).code, 'NON_UNIQUE_MATCH')
      return true
    },
  )
})

test('只有转换动作可查有权限的线索池，普通线索查询和无池权限请求仍排除池内数据', async () => {
  const queried: boolean[] = []
  const optionsCalled: string[] = []
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    prisma: unknown
    dataScope: unknown
    pools: unknown
    assertPermission: () => Promise<void>
    findLeads: (_user: AuthUser, prepared: unknown, allowPool: boolean) => Promise<unknown[]>
  }
  resolver.prisma = {
    client: {
      orm: {
        public: {
          Clue: {
            where: (initial: { inSharedPool: boolean }) => {
              queried.push(initial.inSharedPool)
              const query = {
                where: (predicate: (row: unknown) => unknown) => {
                  predicate({ poolId: { in: (_ids: string[]) => true } })
                  return query
                },
                select: () => ({
                  all: async () =>
                    initial.inSharedPool
                      ? [{ ...pooledLead }]
                      : [{ id: 'ordinary', owner: 'owner-1', inSharedPool: false }],
                }),
              }
              return query
            },
          },
        },
      },
    },
  }
  resolver.dataScope = { directOwnerFilter: async () => ({}) }
  resolver.pools = {
    options: async () => {
      optionsCalled.push('pools')
      return [{ id: 'lead-pool-1' }]
    },
  }
  resolver.assertPermission = async () => undefined
  const where = { conditions: [], system: [], issues: [], supported: true }

  assert.equal((await resolver.findLeads(user, where, false)).length, 1)
  assert.deepEqual(queried, [false])
  assert.equal(optionsCalled.length, 0)

  queried.length = 0
  assert.equal(
    (await resolver.findLeads({ ...user, permissions: ['lead:update'] }, where, true)).length,
    1,
  )
  assert.deepEqual(queried, [false])
  assert.equal(optionsCalled.length, 0)

  queried.length = 0
  assert.equal((await resolver.findLeads(user, where, true)).length, 2)
  assert.deepEqual(queried, [false, true])
  assert.deepEqual(optionsCalled, ['pools'])
})

test('第五步映射指定新负责人后，池内线索的原负责人字段保持空值而不是误记为接待人', async () => {
  const templateService = Object.create(ExternalEventTemplatesService.prototype) as unknown as {
    resolver: unknown
    metadata: unknown
    resolveMember: (_user: AuthUser, identity: unknown, provider: string) => Promise<string>
    prepareFlow: ExternalEventTemplatesService['prepareFlow']
  }
  templateService.resolver = {
    resolveTarget: async (
      _user: AuthUser,
      target: string,
      where: unknown,
      _follow: boolean,
      pool: boolean,
    ) => {
      assert.equal(target, 'lead')
      assert.equal(pool, true)
      assert.deepEqual(where, { phone: '13800000000' })
      return { kind: 'LEAD', leadId: 'pooled-lead', ownerId: '' }
    },
  }
  templateService.metadata = {
    listFields: async () => [
      { id: 'inviter-field', key: 'inviter', type: 'member' },
      { id: 'arrival-field', key: 'arrival', type: 'datetime' },
    ],
  }
  templateService.resolveMember = async (_user, identity, provider) => {
    assert.equal(identity, 'DuRuiXin')
    assert.equal(provider, 'WECOM')
    return 'crm-owner-1'
  }
  const template = {
    config: {
      matches: [{ externalKey: 'phone', crmFieldKey: 'phone' }],
      flow: {
        action: 'convert',
        target: 'lead',
        fields: [
          { source: 'leadOwner', fieldKey: 'inviter' },
          { source: 'event', externalKey: 'createdTime', fieldKey: 'arrival' },
        ],
        owner: { externalKey: 'teacherUserId', provider: 'WECOM' },
      },
    },
  }
  const plan = await templateService.prepareFlow(user, template as never, {
    phone: '13800000000',
    teacherUserId: 'DuRuiXin',
    createdTime: '2026-10-15 14:18:23',
  })
  assert.equal(plan.ownerId, 'crm-owner-1')
  assert.deepEqual(plan.set, { arrival: '2026-10-15 14:18:23' })
})
