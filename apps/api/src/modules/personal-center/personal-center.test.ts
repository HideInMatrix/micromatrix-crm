import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import type { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { AuthService } from '../../auth/auth.service'
import type { FollowUpPlansService } from '../follow-up-plans/follow-up-plans.service'
import { PersonalCenterService } from './personal-center.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'PersonalCenter 使用 Prisma 保持关系装配、全局唯一规则与跨 runtime 更新一致',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    const tenantIds: string[] = []
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-personal')
      tenantIds.push(tenant.id)
      const department = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: 'Prisma 研发部',
      })
      const role = await prismaClient.orm.public.Roles.select('id', 'name').create({
        tenantId: tenant.id,
        name: `Prisma Role ${suffix}`,
        updatedAt: nowInstant(),
      })
      const userRow = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'Personal User',
        deptId: department.id,
        email: `personal-${suffix}@example.com`,
      })
      await prismaClient.orm.public.Users.where({ id: userRow.id }).update({
        phone: `138${suffix.slice(0, 8)}`,
        language: 'zh-CN',
        updatedAt: nowInstant(),
      })
      await prismaClient.orm.public.UserExtensions.create({
        id: userRow.id,
        avatar: `https://example.com/${suffix}.png`,
      })
      await prismaClient.orm.public.UserRoles.create({
        tenantId: tenant.id,
        userId: userRow.id,
        roleId: role.id,
        updatedAt: nowInstant(),
      })

      const otherTenant = await createPrismaTestTenant(prismaClient, 'p8-personal-other')
      tenantIds.push(otherTenant.id)
      const conflictPhone = `139${suffix.slice(0, 8)}`
      const conflictEmail = `conflict-${suffix}@example.com`
      const conflictUser = await createPrismaTestUser(prismaClient, {
        tenantId: otherTenant.id,
        name: 'Conflict User',
        email: conflictEmail,
      })
      await prismaClient.orm.public.Users.where({ id: conflictUser.id }).update({
        phone: conflictPhone,
        updatedAt: nowInstant(),
      })

      const invalidated: string[] = []
      const actions: string[] = []
      const service = new PersonalCenterService(
        { client: prismaClient } as PrismaService,
        {} as AuthService,
        {} as FollowUpPlansService,
        {
          record: async (_user: AuthUser, input: { action: string }) =>
            void actions.push(input.action),
        } as unknown as BusinessChangeLogService,
        {
          invalidate: async (userId: string) => void invalidated.push(userId),
        } as unknown as AuthContextCacheService,
      )
      const user = { id: userRow.id, tenantId: tenant.id } as AuthUser

      const before = await service.info(user)
      assert.equal(before.departmentId, department.id)
      assert.equal(before.departmentName, 'Prisma 研发部')
      assert.equal(before.avatarUrl, `https://example.com/${suffix}.png`)
      assert.deepEqual(before.roles, [{ id: role.id, name: role.name }])

      const nextPhone = `137${suffix.slice(0, 8)}`
      const nextEmail = `UPDATED-${suffix}@Example.COM`
      const updated = await service.update(user, {
        phone: nextPhone,
        email: nextEmail,
        language: 'en-US',
      })
      assert.equal(updated.phone, nextPhone)
      assert.equal(updated.email, nextEmail.toLowerCase())
      assert.equal(updated.language, 'en-US')
      assert.equal(updated.departmentName, 'Prisma 研发部')
      assert.deepEqual(updated.roles, [{ id: role.id, name: role.name }])

      const stored = await prismaClient.orm.public.Users.where({ id: userRow.id })
        .select('phone', 'email', 'language')
        .first()
      assert.ok(stored)
      assert.equal(stored.phone, nextPhone)
      assert.equal(stored.email, nextEmail.toLowerCase())
      assert.equal(stored.language, 'en-US')
      assert.deepEqual(invalidated, [userRow.id])
      assert.deepEqual(actions, ['update'])

      await assert.rejects(
        () =>
          service.update(user, {
            phone: conflictPhone,
            email: `unique-${suffix}@example.com`,
            language: 'en-US',
          }),
        /该手机号已被使用/,
      )
      await assert.rejects(
        () =>
          service.update(user, {
            phone: `136${suffix.slice(0, 8)}`,
            email: conflictEmail.toUpperCase(),
            language: 'en-US',
          }),
        /该邮箱已被使用/,
      )
    } finally {
      if (tenantIds.length) {
        const users = await prismaClient.orm.public.Users.where((row) => row.tenantId.in(tenantIds))
          .select('id')
          .all()
        if (users.length) {
          await prismaClient.orm.public.UserExtensions.where((row) =>
            row.id.in(users.map((item) => item.id)),
          ).deleteAll()
        }
        await prismaClient.orm.public.UserRoles.where((row) =>
          row.tenantId.in(tenantIds),
        ).deleteAll()
        await prismaClient.orm.public.Users.where((row) => row.tenantId.in(tenantIds)).deleteAll()
        await prismaClient.orm.public.Roles.where((row) => row.tenantId.in(tenantIds)).deleteAll()
        await prismaClient.orm.public.Departments.where((row) =>
          row.tenantId.in(tenantIds),
        ).deleteAll()
        await prismaClient.orm.public.Tenants.where((row) => row.id.in(tenantIds)).deleteAll()
      }
      await testDb.close()
    }
  },
)
