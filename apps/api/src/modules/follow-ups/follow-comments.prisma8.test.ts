import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { FollowPlanCommentsService } from '../follow-up-plans/follow-plan-comments.service'
import type { FollowUpPlansService } from '../follow-up-plans/follow-up-plans.service'
import { FollowCommentsService } from './follow-comments.service'
import type { FollowUpsService } from './follow-ups.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'FollowRecord/FollowPlan 评论使用 Prisma 8 保持 Comment/Mention/commentCount 原子事务',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId = ''
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `p8-comment-${suffix}`, slug: `p8-comment-${suffix}` },
      })
      tenantId = tenant.id
      const [actorRow, mentionRow, ownerRow] = await Promise.all([
        fixtureDb.user.create({
          data: {
            tenantId,
            email: `actor-${suffix}@example.com`,
            passwordHash: 'test-only',
            name: '评论操作人',
          },
        }),
        fixtureDb.user.create({
          data: {
            tenantId,
            email: `mention-${suffix}@example.com`,
            passwordHash: 'test-only',
            name: '被提及成员',
          },
        }),
        fixtureDb.user.create({
          data: {
            tenantId,
            email: `owner-${suffix}@example.com`,
            passwordHash: 'test-only',
            name: '资源负责人',
          },
        }),
      ])
      const actor: AuthUser = {
        id: actorRow.id,
        tenantId,
        email: actorRow.email,
        name: actorRow.name,
        deptId: null,
        leaderId: null,
        roles: [],
        permissions: ['*'],
      }
      const now = BigInt(Date.now())
      const customer = await fixtureDb.customer.create({
        data: {
          id: randomUUID().replaceAll('-', ''),
          name: 'Prisma 8 评论客户',
          owner: ownerRow.id,
          createTime: now,
          updateTime: now,
          createUser: actorRow.id,
          updateUser: actorRow.id,
          organizationId: tenantId,
        },
      })
      const record = await fixtureDb.followUpRecord.create({
        data: {
          tenantId,
          targetType: 'customer',
          targetId: customer.id,
          content: '真实跟进记录',
          ownerId: ownerRow.id,
          ownerName: ownerRow.name,
          createdById: actorRow.id,
        },
      })
      const plan = await fixtureDb.followUpPlan.create({
        data: {
          tenantId,
          targetType: 'customer',
          targetId: customer.id,
          content: '真实跟进计划',
          status: 'PREPARED',
          ownerId: ownerRow.id,
          createdById: actorRow.id,
        },
      })

      const prisma8 = { client: prisma8Client } as Prisma8Service
      const notifications = { send: async () => 1 } as unknown as BusinessNotificationsService
      const recordService = new FollowCommentsService(
        prisma8,
        { assertRecordAccess: async () => record } as unknown as FollowUpsService,
        notifications,
      )
      const planService = new FollowPlanCommentsService(
        prisma8,
        { assertPlanAccess: async () => plan } as unknown as FollowUpPlansService,
        notifications,
      )

      const recordComment = await recordService.add(actor, {
        resourceId: record.id,
        content: '  记录评论  ',
        mentionedUserIds: [mentionRow.id],
      })
      const persistedRecordComment = await fixtureDb.followUpRecordComment.findUniqueOrThrow({
        where: { id: recordComment.id },
        include: { mentions: true },
      })
      assert.equal(persistedRecordComment.content, '记录评论')
      assert.deepEqual(
        persistedRecordComment.mentions.map((item: { userId: string }) => item.userId),
        [mentionRow.id],
      )
      assert.equal(
        (await fixtureDb.followUpRecord.findUniqueOrThrow({ where: { id: record.id } })).commentCount,
        1,
      )

      const updatedRecordComment = await recordService.update(actor, {
        id: recordComment.id,
        content: '记录评论已编辑',
        mentionedUserIds: [],
      })
      assert.equal(updatedRecordComment.content, '记录评论已编辑')
      assert.equal(
        await fixtureDb.followUpRecordCommentMention.count({ where: { commentId: recordComment.id } }),
        0,
      )
      assert.deepEqual(await recordService.remove(actor, recordComment.id), {
        id: recordComment.id,
        commentCount: 0,
      })
      assert.equal(
        (await fixtureDb.followUpRecord.findUniqueOrThrow({ where: { id: record.id } })).commentCount,
        0,
      )

      const planComment = await planService.add(actor, {
        resourceId: plan.id,
        content: '计划评论',
        mentionedUserIds: [mentionRow.id],
      })
      const persistedPlanComment = await fixtureDb.followUpPlanComment.findUniqueOrThrow({
        where: { id: planComment.id },
        include: { mentions: true },
      })
      assert.equal(persistedPlanComment.content, '计划评论')
      assert.deepEqual(
        persistedPlanComment.mentions.map((item: { userId: string }) => item.userId),
        [mentionRow.id],
      )
      assert.equal(
        (await fixtureDb.followUpPlan.findUniqueOrThrow({ where: { id: plan.id } })).commentCount,
        1,
      )

      await planService.update(actor, {
        id: planComment.id,
        content: '计划评论已编辑',
        mentionedUserIds: [],
      })
      assert.equal(
        await fixtureDb.followUpPlanCommentMention.count({ where: { commentId: planComment.id } }),
        0,
      )
      assert.deepEqual(await planService.remove(actor, planComment.id), {
        id: planComment.id,
        commentCount: 0,
      })
      assert.equal(
        (await fixtureDb.followUpPlan.findUniqueOrThrow({ where: { id: plan.id } })).commentCount,
        0,
      )
    } finally {
      if (tenantId) {
        await fixtureDb.followUpRecord.deleteMany({ where: { tenantId } })
        await fixtureDb.followUpPlan.deleteMany({ where: { tenantId } })
        await fixtureDb.customer.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
