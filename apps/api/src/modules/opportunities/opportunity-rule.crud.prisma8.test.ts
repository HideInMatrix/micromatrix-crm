import assert from 'node:assert/strict'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal.js'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { OpportunityRuleService } from './opportunity-rule.service'

test('OpportunityRule 使用 Prisma 8 保持 CRUD、分页、scope 名称与阶段校验语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-opp-rule')
  const department = await createPrismaTestDepartment(prisma8Client, {
    tenantId: tenant.id,
    name: '规则部门',
  })
  const actor = await createPrismaTestUser(prisma8Client, {
    tenantId: tenant.id,
    deptId: department.id,
    email: `rule-${suffix}@example.com`,
    passwordHash: 'test-only',
    name: '规则管理员',
  })
  const role = await prisma8Client.orm.public.Roles
    .select('id')
    .create({
      tenantId: tenant.id,
      name: `规则角色-${suffix}`,
      permissions: [],
      updatedAt: prisma8Now(),
    })
  const now = BigInt(Date.now())
  const stage = await prisma8Client.orm.public.OpportunityStageConfig
    .select('id')
    .create({
      id: prisma8Id32(),
      name: prisma8Varchar('规则阶段', 16),
      _type: prisma8Varchar('AFOOT', 50),
      rate: prisma8Varchar('50', 10),
      pos: 1n,
      organizationId: prisma8Varchar(tenant.id, 32),
      createTime: now,
      updateTime: now,
      createUser: prisma8Varchar(actor.id, 32),
      updateUser: prisma8Varchar(actor.id, 32),
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
    const persisted = await prisma8Client.orm.public.OpportunityRule.where({
      id: prisma8Varchar(created.id, 32),
    }).first()
    assert.ok(persisted)
    assert.equal(persisted.enable, false)
    assert.equal(persisted.name, 'Prisma8 更新规则')

    await service.remove(tenant.id, created.id)
    assert.equal(
      (
        await prisma8Client.orm.public.OpportunityRule.where({
          id: prisma8Varchar(created.id, 32),
        })
          .select('id')
          .all()
      ).length,
      0,
    )
  } finally {
    const organizationId = prisma8Varchar(tenant.id, 32)
    await prisma8Client.orm.public.OpportunityRule.where({ organizationId }).deleteAll()
    await prisma8Client.orm.public.OpportunityStageConfig.where({ organizationId }).deleteAll()
    await prisma8Client.orm.public.UserRoles.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Roles.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Departments.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
