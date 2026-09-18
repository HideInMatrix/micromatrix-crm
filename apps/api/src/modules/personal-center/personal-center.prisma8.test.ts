import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import type { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { AuthService } from '../../auth/auth.service'
import type { FollowUpPlansService } from '../follow-up-plans/follow-up-plans.service'
import { PersonalCenterService } from './personal-center.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'PersonalCenter 使用 Prisma 8 保持关系装配、全局唯一规则与跨 runtime 更新一致',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    const tenantIds: string[] = []
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 Personal ${suffix}`, slug: `p8-personal-${suffix}` },
      })
      tenantIds.push(tenant.id)
      const department = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: 'Prisma8 研发部' },
      })
      const role = await fixtureDb.role.create({
        data: { tenantId: tenant.id, name: `Prisma8 Role ${suffix}` },
      })
      const userRow = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Personal User',
          passwordHash: 'not-used',
          deptId: department.id,
          phone: `138${suffix.slice(0, 8)}`,
          email: `personal-${suffix}@example.com`,
          language: 'zh-CN',
        },
      })
      await fixtureDb.userExtension.create({
        data: { id: userRow.id, avatar: `https://example.com/${suffix}.png` },
      })
      await fixtureDb.userRole.create({
        data: { tenantId: tenant.id, userId: userRow.id, roleId: role.id },
      })

      const otherTenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 Personal Other ${suffix}`, slug: `p8-personal-other-${suffix}` },
      })
      tenantIds.push(otherTenant.id)
      const conflictPhone = `139${suffix.slice(0, 8)}`
      const conflictEmail = `conflict-${suffix}@example.com`
      await fixtureDb.user.create({
        data: {
          tenantId: otherTenant.id,
          name: 'Conflict User',
          passwordHash: 'not-used',
          phone: conflictPhone,
          email: conflictEmail,
        },
      })

      const invalidated: string[] = []
      const actions: string[] = []
      const service = new PersonalCenterService(
        { client: prisma8Client } as Prisma8Service,
        {} as AuthService,
        {} as FollowUpPlansService,
        {
          record: async (_user: AuthUser, input: { action: string }) => void actions.push(input.action),
        } as unknown as BusinessChangeLogService,
        {
          invalidate: async (userId: string) => void invalidated.push(userId),
        } as unknown as AuthContextCacheService,
      )
      const user = { id: userRow.id, tenantId: tenant.id } as AuthUser

      const before = await service.info(user)
      assert.equal(before.departmentId, department.id)
      assert.equal(before.departmentName, 'Prisma8 研发部')
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
      assert.equal(updated.departmentName, 'Prisma8 研发部')
      assert.deepEqual(updated.roles, [{ id: role.id, name: role.name }])

      const stored = await fixtureDb.user.findUniqueOrThrow({ where: { id: userRow.id } })
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
        await fixtureDb.userRole.deleteMany({ where: { tenantId: { in: tenantIds } } })
        await fixtureDb.userExtension.deleteMany({ where: { user: { tenantId: { in: tenantIds } } } })
        await fixtureDb.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
        await fixtureDb.role.deleteMany({ where: { tenantId: { in: tenantIds } } })
        await fixtureDb.department.deleteMany({ where: { tenantId: { in: tenantIds } } })
        await fixtureDb.tenant.deleteMany({ where: { id: { in: tenantIds } } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)

