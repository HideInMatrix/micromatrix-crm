import assert from 'node:assert/strict'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampFromDate } from '../../prisma/prisma8-temporal'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { FollowUpPlansService } from './follow-up-plans.service'

test('FollowUpPlans reminder 使用 Prisma 8 扫描/CAS/失败回滚', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-follow-plan')
  const user = await createPrismaTestUser(prisma8Client, {
    tenantId: tenant.id,
    email: `owner-${suffix}@example.com`,
    passwordHash: 'test-only',
    name: '提醒负责人',
  })
  const nowMs = BigInt(Date.now())
  const customerId = prisma8Id32()
  const ownerId = prisma8Varchar(user.id, 32)
  const organizationId = prisma8Varchar(tenant.id, 32)
  await prisma8Client.orm.public.Customer.create({
    id: customerId,
    name: prisma8Varchar('Prisma 8 提醒客户', 255),
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
  const plan = await prisma8Client.orm.public.FollowUpPlans
    .select('id')
    .create({
      tenantId: tenant.id,
      targetType: 'customer',
      targetId: customerId,
      content: 'Prisma 8 到期提醒',
      estimatedAt: prisma8TimestampFromDate(reminderAt),
      status: 'PREPARED',
      ownerId: user.id,
      createdById: user.id,
      updatedAt: prisma8Now(),
    })

  let notices = 0
  const service = new FollowUpPlansService(
    prisma8,
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

    const claimed = await prisma8Client.orm.public.FollowUpPlans.where({ id: plan.id }).first()
    assert.ok(claimed?.dueNotifiedAt)

    const failedPlan = await prisma8Client.orm.public.FollowUpPlans
      .select('id')
      .create({
        tenantId: tenant.id,
        targetType: 'customer',
        targetId: customerId,
        content: 'Prisma 8 失败回滚提醒',
        estimatedAt: prisma8TimestampFromDate(reminderAt),
        status: 'PREPARED',
        ownerId: user.id,
        createdById: user.id,
        updatedAt: prisma8Now(),
      })
    const failingService = new FollowUpPlansService(
      prisma8,
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
    const released = await prisma8Client.orm.public.FollowUpPlans.where({ id: failedPlan.id }).first()
    assert.equal(released?.dueNotifiedAt, null)
  } finally {
    await prisma8Client.orm.public.FollowUpPlans.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Customer.where({ id: customerId }).deleteAll()
    await prisma8Client.orm.public.Users.where({ id: user.id }).deleteAll()
    await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
