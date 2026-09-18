import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import type { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { RolesService } from './roles.service'

test('Roles 使用 Prisma 8 保持成员装配、唯一角色保护与缓存失效语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-role-${suffix}`, slug: `p8-role-${suffix}` },
  })
  const dept = await fixtureDb.department.create({ data: { tenantId: tenant.id, name: '角色部门' } })
  const leader = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      deptId: dept.id,
      email: `leader-${suffix}@example.com`,
      passwordHash: 'test-only',
      name: '直属上级',
    },
  })
  const member = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      deptId: dept.id,
      leaderId: leader.id,
      email: `member-${suffix}@example.com`,
      passwordHash: 'test-only',
      name: '角色成员',
      phone: '13800000000',
      position: '销售',
    },
  })
  const invalidatedMany: string[][] = []
  const invalidatedOne: string[] = []
  const authCache = {
    invalidateMany: async (ids: string[]) => {
      invalidatedMany.push([...ids])
    },
    invalidate: async (id: string) => {
      invalidatedOne.push(id)
    },
  } as unknown as AuthContextCacheService
  const service = new RolesService(prisma8, new DataScopeService(prisma8), authCache)
  const actor: AuthUser = {
    id: leader.id,
    tenantId: tenant.id,
    email: leader.email,
    name: leader.name,
    deptId: dept.id,
    leaderId: null,
    roles: [],
    permissions: ['*'],
  }

  try {
    const primary = await service.create(actor, {
      name: '业务角色',
      permissions: [],
      dataScope: 'CUSTOM',
      scopeDeptIds: [dept.id],
      remark: 'Prisma 8',
    })
    await assert.rejects(
      () =>
        service.create(actor, {
          name: '业务角色',
          permissions: [],
          dataScope: 'SELF',
        }),
      /角色名称已存在/,
    )

    await service.addMembers(actor, primary.id, [member.id, member.id])
    await service.addMembers(actor, primary.id, [member.id])
    assert.equal(
      await fixtureDb.userRole.count({ where: { tenantId: tenant.id, roleId: primary.id, userId: member.id } }),
      1,
    )

    const all = await service.findAll(tenant.id)
    assert.equal(all.find((role) => role.id === primary.id)?.userCount, 1)

    const members = await service.members(tenant.id, primary.id, {
      page: 1,
      pageSize: 10,
      keyword: '角色成员',
    })
    assert.equal(members.total, 1)
    assert.equal(members.items[0]?.deptName, '角色部门')
    assert.equal(members.items[0]?.leaderName, '直属上级')
    assert.deepEqual(members.items[0]?.roleIds, [primary.id])
    assert.equal(members.items[0]?.roles[0]?.name, '业务角色')

    const updated = await service.update(actor, primary.id, { name: '业务角色更新' })
    assert.equal(updated.name, '业务角色更新')
    assert.ok(invalidatedMany.some((ids) => ids.includes(member.id)))

    await assert.rejects(() => service.remove(tenant.id, primary.id), /唯一角色/)
    await assert.rejects(() => service.removeMember(actor, primary.id, member.id), /至少需要保留一个角色/)

    const secondary = await service.create(actor, {
      name: '备用角色',
      permissions: [],
      dataScope: 'SELF',
    })
    await service.addMembers(actor, secondary.id, [member.id])
    await service.removeMember(actor, primary.id, member.id)
    assert.deepEqual(invalidatedOne, [member.id])

    await service.remove(tenant.id, primary.id)
    assert.equal(await fixtureDb.role.count({ where: { id: primary.id } }), 0)
    const options = await service.options(tenant.id)
    assert.ok(options.some((role) => role.id === secondary.id && role.name === '备用角色'))
  } finally {
    await fixtureDb.userRole.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.role.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.department.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.tenant.delete({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
