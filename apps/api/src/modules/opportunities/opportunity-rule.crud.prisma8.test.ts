import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { OpportunityRuleService } from './opportunity-rule.service'

test('OpportunityRule 使用 Prisma 8 保持 CRUD、分页、scope 名称与阶段校验语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-opp-rule-${suffix}`, slug: `p8-opp-rule-${suffix}` },
  })
  const department = await fixtureDb.department.create({
    data: { tenantId: tenant.id, name: '规则部门' },
  })
  const actor = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      deptId: department.id,
      email: `rule-${suffix}@example.com`,
      passwordHash: 'test-only',
      name: '规则管理员',
      status: 'ACTIVE',
    },
  })
  const role = await fixtureDb.role.create({
    data: { tenantId: tenant.id, name: `规则角色-${suffix}`, permissions: [] },
  })
  const now = BigInt(Date.now())
  const stage = await fixtureDb.opportunityStageConfig.create({
    data: {
      name: '规则阶段',
      type: 'AFOOT',
      rate: '50',
      pos: 1n,
      organizationId: tenant.id,
      createTime: now,
      updateTime: now,
      createUser: actor.id,
      updateUser: actor.id,
    },
  })
  const service = new OpportunityRuleService(prisma8)

  try {
    await assert.rejects(
      () =>
        service.add(tenant.id, actor.id, {
          name: '无效阶段规则',
          scopeIds: ['*'],
          ownerIds: [actor.id],
          enable: true,
          auto: true,
          operator: 'AND',
          conditions: [
            { column: 'opportunityStage', operator: 'IN', value: 'missing-stage-id' },
          ],
        }),
      /无效商机阶段/,
    )

    const created = await service.add(tenant.id, actor.id, {
      name: 'Prisma8 自动关闭规则',
      scopeIds: [`user:${actor.id}`, `dept:${department.id}`, `role:${role.id}`],
      ownerIds: [actor.id],
      enable: true,
      auto: true,
      operator: 'AND',
      conditions: [{ column: 'opportunityStage', operator: 'IN', value: stage.id }],
    })
    assert.equal(created.organizationId, tenant.id)

    const page = await service.page(tenant.id, {
      current: 1,
      pageSize: 10,
      keyword: 'prisma8 自动',
    })
    assert.equal(page.total, 1)
    assert.equal(page.list.length, 1)
    assert.equal(page.list[0]?.id, created.id)
    assert.deepEqual(
      page.list[0]?.members.map((item) => item.name),
      ['规则管理员', '规则部门', `规则角色-${suffix}`],
    )
    assert.deepEqual(page.list[0]?.owners, [{ id: actor.id, name: '规则管理员' }])
    assert.equal(page.list[0]?.createUserName, '规则管理员')
    assert.equal(page.list[0]?.updateUserName, '规则管理员')

    const updated = await service.update(tenant.id, actor.id, {
      id: created.id,
      name: 'Prisma8 更新规则',
      auto: false,
    })
    assert.equal(updated?.name, 'Prisma8 更新规则')
    assert.equal(updated?.auto, false)
    assert.deepEqual(JSON.parse(updated?.condition ?? '[]'), [])

    await service.toggle(tenant.id, actor.id, created.id)
    const persisted = await fixtureDb.opportunityRule.findUniqueOrThrow({ where: { id: created.id } })
    assert.equal(persisted.enable, false)
    assert.equal(persisted.name, 'Prisma8 更新规则')

    await service.remove(tenant.id, created.id)
    assert.equal(await fixtureDb.opportunityRule.count({ where: { id: created.id } }), 0)
  } finally {
    await fixtureDb.opportunityRule.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.opportunityStageConfig.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.userRole.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.role.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.department.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.tenant.delete({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
