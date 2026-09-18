import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import * as bcrypt from 'bcryptjs'
import type { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import type { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import type { RolesService } from '../roles/roles.service'
import { MembersService } from './members.service'

const id32 = () => randomUUID().replaceAll('-', '')

test('Members 使用 Prisma 8 保持成员关系装配、状态清理与删除保护语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-members-${suffix}`, slug: `p8-members-${suffix}` },
  })
  const deptA = await fixtureDb.department.create({ data: { tenantId: tenant.id, name: '研发部' } })
  const deptB = await fixtureDb.department.create({ data: { tenantId: tenant.id, name: '产品部' } })
  const roleA = await fixtureDb.role.create({
    data: { tenantId: tenant.id, name: '成员角色 A', permissions: [], dataScope: 'SELF' },
  })
  const roleB = await fixtureDb.role.create({
    data: { tenantId: tenant.id, name: '成员角色 B', permissions: [], dataScope: 'SELF' },
  })
  const leader = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      email: `leader-${suffix}@example.test`,
      passwordHash: 'test',
      name: '直属上级',
      deptId: deptA.id,
    },
  })
  const invalidated: string[] = []
  const authCache = {
    invalidate: async (id: string) => void invalidated.push(id),
    invalidateMany: async (ids: string[]) => void invalidated.push(...ids),
  } as unknown as AuthContextCacheService
  const rolesService = {
    assertRolesAssignable: async (_actor: AuthUser, ids: string[]) =>
      fixtureDb.role.findMany({ where: { tenantId: tenant.id, id: { in: ids } } }),
  } as unknown as RolesService
  const service = new MembersService(prisma8, rolesService, authCache)
  const actor: AuthUser = {
    id: leader.id,
    tenantId: tenant.id,
    email: leader.email,
    name: leader.name,
    deptId: leader.deptId,
    leaderId: null,
    roles: [],
    permissions: ['*'],
  }

  try {
    const created = await service.create(actor, {
      email: `member-${suffix}@example.test`,
      name: ' Prisma8 成员 ',
      password: 'member-pass',
      roleIds: [roleA.id],
      deptId: deptA.id,
      leaderId: leader.id,
      position: '工程师',
      phone: `138${String(Date.now()).slice(-8)}`,
    })
    assert.equal(created.name, 'Prisma8 成员')
    assert.equal(created.deptName, '研发部')
    assert.equal(created.leaderName, '直属上级')
    assert.deepEqual(created.roleIds, [roleA.id])

    const page = await service.findAll(tenant.id, { page: 1, pageSize: 10, keyword: 'prisma8 成员' })
    assert.equal(page.total, 1)
    assert.equal(page.items[0]?.roles[0]?.name, '成员角色 A')

    const updated = await service.update(actor, created.id, {
      name: '迁移后成员',
      deptId: deptB.id,
      roleIds: [roleB.id],
    })
    assert.equal(updated.deptName, '产品部')
    assert.deepEqual(updated.roleIds, [roleB.id])
    assert.equal(await fixtureDb.userRole.count({ where: { userId: created.id, roleId: roleA.id } }), 0)
    assert.equal(await fixtureDb.userRole.count({ where: { userId: created.id, roleId: roleB.id } }), 1)

    await service.resetPassword(tenant.id, created.id, 'new-password')
    const passwordUser = await fixtureDb.user.findUniqueOrThrow({ where: { id: created.id } })
    assert.equal(await bcrypt.compare('new-password', passwordUser.passwordHash), true)

    const subordinate = await fixtureDb.user.create({
      data: {
        tenantId: tenant.id,
        email: `sub-${suffix}@example.test`,
        passwordHash: 'test',
        name: '下属',
        deptId: deptB.id,
        leaderId: created.id,
      },
    })
    await fixtureDb.department.update({ where: { id: deptA.id }, data: { leaderId: created.id } })
    assert.equal((await service.toggleStatus(tenant.id, leader.id, created.id)).status, 'DISABLED')
    assert.equal((await fixtureDb.user.findUniqueOrThrow({ where: { id: subordinate.id } })).leaderId, null)
    assert.equal((await fixtureDb.department.findUniqueOrThrow({ where: { id: deptA.id } })).leaderId, null)

    const protectedMember = await service.create(actor, {
      email: `protected-${suffix}@example.test`,
      name: '有关联数据成员',
      password: 'member-pass',
      roleIds: [roleA.id],
      deptId: deptA.id,
    })
    const customerId = id32()
    const now = BigInt(Date.now())
    await fixtureDb.customer.create({
      data: {
        id: customerId,
        name: '删除保护客户',
        owner: protectedMember.id,
        organizationId: tenant.id,
        createTime: now,
        updateTime: now,
        createUser: protectedMember.id,
        updateUser: protectedMember.id,
      },
    })
    await assert.rejects(() => service.remove(tenant.id, leader.id, protectedMember.id), /成员仍有关联业务数据/)
    await fixtureDb.customer.delete({ where: { id: customerId } })
    await fixtureDb.sysUserView.create({
      data: {
        id: id32(),
        userId: protectedMember.id,
        name: '待清理视图',
        resourceType: 'customer',
        organizationId: tenant.id,
        pos: 4096n,
        createTime: now,
        updateTime: now,
        createUser: protectedMember.id,
        updateUser: protectedMember.id,
      },
    })
    await fixtureDb.notification.create({
      data: { tenantId: tenant.id, userId: protectedMember.id, type: 'system', title: '待清理通知' },
    })
    await service.remove(tenant.id, leader.id, protectedMember.id)
    assert.equal(await fixtureDb.user.count({ where: { id: protectedMember.id } }), 0)
    assert.equal(await fixtureDb.sysUserView.count({ where: { userId: protectedMember.id } }), 0)
    assert.equal(await fixtureDb.notification.count({ where: { userId: protectedMember.id } }), 0)
    assert.ok(invalidated.includes(created.id))
  } finally {
    await fixtureDb.notification.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.sysUserView.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.department.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.role.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.tenant.deleteMany({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
