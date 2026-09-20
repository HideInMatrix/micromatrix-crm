import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant, instantFromDate } from '../../prisma/temporal'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { FollowUpPlansService } from './follow-up-plans.service'

test('FollowUpPlans reminder 使用 Prisma 扫描/CAS/失败回滚', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prismaClient = testDb.client
  const prisma = { client: prismaClient } as PrismaService

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prismaClient, 'p8-follow-plan')
  const user = await createPrismaTestUser(prismaClient, {
    tenantId: tenant.id,
    email: `owner-${suffix}@example.com`,
    passwordHash: 'test-only',
    name: '提醒负责人',
  })
  const nowMs = BigInt(Date.now())
  const customerId = createLegacyId32()
  const ownerId = user.id
  const organizationId = tenant.id
  await prismaClient.orm.public.Customer.create({
    id: customerId,
    name: 'Prisma 提醒客户',
    owner: ownerId,
    collectionTime: nowMs,
    createTime: nowMs,
    updateTime: nowMs,
    createUser: ownerId,
    updateUser: ownerId,
    inSharedPool: false,
    organizationId,
  })

  const reminderAt = new Date('2026-09-16T10:00:00')
  const plan = await prismaClient.orm.public.FollowUpPlans.select('id').create({
    tenantId: tenant.id,
    targetType: 'customer',
    targetId: customerId,
    content: 'Prisma 到期提醒',
    estimatedAt: instantFromDate(reminderAt),
    status: 'PREPARED',
    ownerId: user.id,
    createdById: user.id,
    updatedAt: nowInstant(),
  })

  let notices = 0
  const service = new FollowUpPlansService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      notify: async () => {
        notices += 1
      },
    } as never,
  )

  try {
    assert.equal(await service.runDueReminders(reminderAt), 1)
    assert.equal(await service.runDueReminders(new Date('2026-09-16T10:05:00')), 0)
    assert.equal(notices, 1)

    const claimed = await prismaClient.orm.public.FollowUpPlans.where({ id: plan.id }).first()
    assert.ok(claimed?.dueNotifiedAt)

    const failedPlan = await prismaClient.orm.public.FollowUpPlans.select('id').create({
      tenantId: tenant.id,
      targetType: 'customer',
      targetId: customerId,
      content: 'Prisma 失败回滚提醒',
      estimatedAt: instantFromDate(reminderAt),
      status: 'PREPARED',
      ownerId: user.id,
      createdById: user.id,
      updatedAt: nowInstant(),
    })
    const failingService = new FollowUpPlansService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        notify: async () => {
          throw new Error('expected notification failure')
        },
      } as never,
    )

    await assert.rejects(
      () => failingService.runDueReminders(new Date('2026-09-16T10:10:00')),
      /expected notification failure/,
    )
    const released = await prismaClient.orm.public.FollowUpPlans.where({
      id: failedPlan.id,
    }).first()
    assert.equal(released?.dueNotifiedAt, null)
  } finally {
    await prismaClient.orm.public.FollowUpPlans.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Customer.where({ id: customerId }).deleteAll()
    await prismaClient.orm.public.Users.where({ id: user.id }).deleteAll()
    await prismaClient.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
