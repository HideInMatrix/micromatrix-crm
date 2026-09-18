import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { FollowUpPlansService } from './follow-up-plans.service'

test('FollowUpPlans reminder 使用 Prisma 8 扫描/CAS/失败回滚', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const prisma = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await prisma.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await prisma.tenant.create({
    data: { name: `p8-follow-plan-${suffix}`, slug: `p8-follow-plan-${suffix}` },
  })
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `owner-${suffix}@example.com`,
      passwordHash: 'test-only',
      name: '提醒负责人',
      defaultPwd: false,
    },
  })
  const nowMs = BigInt(Date.now())
  const customerId = randomUUID().replaceAll('-', '')
  await prisma.customer.create({
    data: {
      id: customerId,
      name: 'Prisma 8 提醒客户',
      owner: user.id,
      collectionTime: nowMs,
      createTime: nowMs,
      updateTime: nowMs,
      createUser: user.id,
      updateUser: user.id,
      inSharedPool: false,
      organizationId: tenant.id,
    },
  })

  const reminderAt = new Date('2026-09-16T10:00:00')
  const plan = await prisma.followUpPlan.create({
    data: {
      tenantId: tenant.id,
      targetType: 'customer',
      targetId: customerId,
      content: 'Prisma 8 到期提醒',
      estimatedAt: reminderAt,
      status: 'PREPARED',
      ownerId: user.id,
      createdById: user.id,
    },
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

    const claimed = await prisma.followUpPlan.findUnique({ where: { id: plan.id } })
    assert.ok(claimed?.dueNotifiedAt)

    const failedPlan = await prisma.followUpPlan.create({
      data: {
        tenantId: tenant.id,
        targetType: 'customer',
        targetId: customerId,
        content: 'Prisma 8 失败回滚提醒',
        estimatedAt: reminderAt,
        status: 'PREPARED',
        ownerId: user.id,
        createdById: user.id,
      },
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
    const released = await prisma.followUpPlan.findUnique({ where: { id: failedPlan.id } })
    assert.equal(released?.dueNotifiedAt, null)
  } finally {
    await prisma.followUpPlan.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.customer.delete({ where: { id: customerId } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.tenant.delete({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await prisma.$disconnect()
  }
})
