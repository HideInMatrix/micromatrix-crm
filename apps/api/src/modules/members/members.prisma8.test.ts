import assert from 'node:assert/strict'
import test from 'node:test'
import * as bcrypt from 'bcryptjs'
import type { AuthUser } from '../../common/auth-user'
import type { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { RolesService } from '../roles/roles.service'
import { MembersService } from './members.service'

const id32 = () => prisma8Id32()

test('Members 使用 Prisma 8 保持成员关系装配、状态清理与删除保护语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-members')
  const deptA = await createPrismaTestDepartment(prisma8Client, {
    tenantId: tenant.id,
    name: '研发部',
  })
  const deptB = await createPrismaTestDepartment(prisma8Client, {
    tenantId: tenant.id,
    name: '产品部',
  })
  const roleA = await prisma8Client.orm.public.Roles
    .select('id', 'name')
    .create({
      tenantId: tenant.id,
      name: '成员角色 A',
      permissions: [],
      dataScope: 'SELF',
      updatedAt: prisma8Now(),
    })
  const roleB = await prisma8Client.orm.public.Roles
    .select('id', 'name')
    .create({
      tenantId: tenant.id,
      name: '成员角色 B',
      permissions: [],
      dataScope: 'SELF',
      updatedAt: prisma8Now(),
    })
  const leader = await createPrismaTestUser(prisma8Client, {
    tenantId: tenant.id,
    email: `leader-${suffix}@example.test`,
    passwordHash: 'test',
    name: '直属上级',
    deptId: deptA.id,
  })
  const invalidated: string[] = []
  const authCache = {
    invalidate: async (id: string) => void invalidated.push(id),
    invalidateMany: async (ids: string[]) => void invalidated.push(...ids),
  } as unknown as AuthContextCacheService
  const rolesService = {
    assertRolesAssignable: async (_actor: AuthUser, ids: string[]) =>
      prisma8Client.orm.public.Roles
        .where({ tenantId: tenant.id })
        .where((row) => row.id.in(ids))
        .all(),
  } as unknown as RolesService
  const service = new MembersService(prisma8, rolesService, authCache)
  const actor: AuthUser = {
    id: leader.id,
    tenantId: tenant.id,
    email: leader.email,
    name: leader.name,
    deptId: deptA.id,
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
    assert.equal(
      (
        await prisma8Client.orm.public.UserRoles.where({ userId: created.id, roleId: roleA.id })
          .select('id')
          .all()
      ).length,
      0,
    )
    assert.equal(
      (
        await prisma8Client.orm.public.UserRoles.where({ userId: created.id, roleId: roleB.id })
          .select('id')
          .all()
      ).length,
      1,
    )

    await service.resetPassword(tenant.id, created.id, 'new-password')
    const passwordUser = await prisma8Client.orm.public.Users.where({ id: created.id })
      .select('passwordHash')
      .first()
    assert.ok(passwordUser)
    assert.equal(await bcrypt.compare('new-password', passwordUser.passwordHash), true)

    const subordinate = await createPrismaTestUser(prisma8Client, {
      tenantId: tenant.id,
      email: `sub-${suffix}@example.test`,
      passwordHash: 'test',
      name: '下属',
      deptId: deptB.id,
    })
    await prisma8Client.orm.public.Users.where({ id: subordinate.id }).update({
      leaderId: created.id,
      updatedAt: prisma8Now(),
    })
    await prisma8Client.orm.public.Departments.where({ id: deptA.id }).update({
      leaderId: created.id,
      updatedAt: prisma8Now(),
    })
    assert.equal((await service.toggleStatus(tenant.id, leader.id, created.id)).status, 'DISABLED')
    assert.equal(
      (await prisma8Client.orm.public.Users.where({ id: subordinate.id }).select('leaderId').first())
        ?.leaderId,
      null,
    )
    assert.equal(
      (await prisma8Client.orm.public.Departments.where({ id: deptA.id }).select('leaderId').first())
        ?.leaderId,
      null,
    )

    const protectedMember = await service.create(actor, {
      email: `protected-${suffix}@example.test`,
      name: '有关联数据成员',
      password: 'member-pass',
      roleIds: [roleA.id],
      deptId: deptA.id,
    })
    const customerId = id32()
    const now = BigInt(Date.now())
    const protectedId = prisma8Varchar(protectedMember.id, 32)
    const organizationId = prisma8Varchar(tenant.id, 32)
    await prisma8Client.orm.public.Customer.create({
      id: customerId,
      name: prisma8Varchar('删除保护客户', 255),
      owner: protectedId,
      organizationId,
      createTime: now,
      updateTime: now,
      createUser: protectedId,
      updateUser: protectedId,
    })
    await assert.rejects(() => service.remove(tenant.id, leader.id, protectedMember.id), /成员仍有关联业务数据/)
    await prisma8Client.orm.public.Customer.where({ id: customerId }).delete()
    await prisma8Client.orm.public.SysUserView.create({
      id: id32(),
      userId: protectedId,
      name: prisma8Varchar('待清理视图', 255),
      resourceType: prisma8Varchar('customer', 50),
      organizationId,
      pos: 4096n,
      createTime: now,
      updateTime: now,
      createUser: protectedId,
      updateUser: protectedId,
    })
    await prisma8Client.orm.public.Notifications.create({
      tenantId: tenant.id,
      userId: protectedMember.id,
      _type: 'system',
      title: '待清理通知',
    })
    await service.remove(tenant.id, leader.id, protectedMember.id)
    assert.equal(
      (await prisma8Client.orm.public.Users.where({ id: protectedMember.id }).select('id').all()).length,
      0,
    )
    assert.equal(
      (
        await prisma8Client.orm.public.SysUserView.where({ userId: protectedId })
          .select('id')
          .all()
      ).length,
      0,
    )
    assert.equal(
      (
        await prisma8Client.orm.public.Notifications.where({ userId: protectedMember.id })
          .select('id')
          .all()
      ).length,
      0,
    )
    assert.ok(invalidated.includes(created.id))
  } finally {
    await prisma8Client.orm.public.Notifications.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.SysUserView
      .where({ organizationId: prisma8Varchar(tenant.id, 32) })
      .deleteAll()
    await prisma8Client.orm.public.UserRoles.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Departments.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Roles.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
