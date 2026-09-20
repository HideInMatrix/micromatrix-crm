import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { DataScopeService } from '../../common/services/data-scope.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { RolesService } from './roles.service'

test('Roles 使用 Prisma 保持成员装配、唯一角色保护与缓存失效语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prismaClient = testDb.client
  const prisma = { client: prismaClient } as PrismaService

  const suffix = String(Date.now()) + '-' + Math.random().toString(16).slice(2)
  const tenant = await createPrismaTestTenant(prismaClient, 'p8-role')
  const dept = await createPrismaTestDepartment(prismaClient, {
    tenantId: tenant.id,
    name: '角色部门',
  })
  const leader = await createPrismaTestUser(prismaClient, {
    tenantId: tenant.id,
    deptId: dept.id,
    email: 'leader-' + suffix + '@example.com',
    passwordHash: 'test-only',
    name: '直属上级',
  })
  const member = await createPrismaTestUser(prismaClient, {
    tenantId: tenant.id,
    deptId: dept.id,
    email: 'member-' + suffix + '@example.com',
    passwordHash: 'test-only',
    name: '角色成员',
  })
  await prismaClient.orm.public.Users.where({ id: member.id }).update({
    leaderId: leader.id,
    phone: '13800000000',
    position: '销售',
    updatedAt: nowInstant(),
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
  const service = new RolesService(prisma, new DataScopeService(prisma), authCache)
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
      remark: 'Prisma',
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
      (
        await prismaClient.orm.public.UserRoles.where({
          tenantId: tenant.id,
          roleId: primary.id,
          userId: member.id,
        })
          .select('id')
          .all()
      ).length,
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
    await assert.rejects(
      () => service.removeMember(actor, primary.id, member.id),
      /至少需要保留一个角色/,
    )

    const secondary = await service.create(actor, {
      name: '备用角色',
      permissions: [],
      dataScope: 'SELF',
    })
    await service.addMembers(actor, secondary.id, [member.id])
    await service.removeMember(actor, primary.id, member.id)
    assert.deepEqual(invalidatedOne, [member.id])

    await service.remove(tenant.id, primary.id)
    assert.equal(
      (await prismaClient.orm.public.Roles.where({ id: primary.id }).select('id').all()).length,
      0,
    )
    const options = await service.options(tenant.id)
    assert.ok(options.some((role) => role.id === secondary.id && role.name === '备用角色'))
  } finally {
    await prismaClient.orm.public.UserRoles.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Roles.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Departments.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
