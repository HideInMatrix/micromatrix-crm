import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
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
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId = ''
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-comment')
      tenantId = tenant.id
      const [actorRow, mentionRow, ownerRow] = await Promise.all([
        createPrismaTestUser(prisma8Client, {
          tenantId,
          email: `actor-${suffix}@example.com`,
          passwordHash: 'test-only',
          name: '评论操作人',
        }),
        createPrismaTestUser(prisma8Client, {
          tenantId,
          email: `mention-${suffix}@example.com`,
          passwordHash: 'test-only',
          name: '被提及成员',
        }),
        createPrismaTestUser(prisma8Client, {
          tenantId,
          email: `owner-${suffix}@example.com`,
          passwordHash: 'test-only',
          name: '资源负责人',
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
      const organizationId = tenantId
      const actorId = actorRow.id
      const ownerId = ownerRow.id
      const customer = await prisma8Client.orm.public.Customer.select('id').create({
        id: createLegacyId32(),
        name: 'Prisma 8 评论客户',
        owner: ownerId,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
        organizationId,
      })
      const record = await prisma8Client.orm.public.FollowUpRecords.select(
        'id',
        'targetType',
        'targetId',
        'ownerId',
      ).create({
        tenantId,
        targetType: 'customer',
        targetId: customer.id,
        content: '真实跟进记录',
        ownerId: ownerRow.id,
        ownerName: ownerRow.name,
        createdById: actorRow.id,
        updatedAt: prisma8Now(),
      })
      const plan = await prisma8Client.orm.public.FollowUpPlans.select(
        'id',
        'targetType',
        'targetId',
        'ownerId',
      ).create({
        tenantId,
        targetType: 'customer',
        targetId: customer.id,
        content: '真实跟进计划',
        status: 'PREPARED',
        ownerId: ownerRow.id,
        createdById: actorRow.id,
        updatedAt: prisma8Now(),
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
      const persistedRecordComment = await prisma8Client.orm.public.FollowUpRecordComment.where({
        id: recordComment.id,
      }).first()
      assert.ok(persistedRecordComment)
      assert.equal(persistedRecordComment.content, '记录评论')
      const recordMentions = await prisma8Client.orm.public.FollowUpRecordCommentMention.where({
        commentId: recordComment.id,
      })
        .select('userId')
        .all()
      assert.deepEqual(
        recordMentions.map((item) => item.userId),
        [mentionRow.id],
      )
      assert.equal(
        (
          await prisma8Client.orm.public.FollowUpRecords.where({ id: record.id })
            .select('commentCount')
            .first()
        )?.commentCount,
        1,
      )

      const updatedRecordComment = await recordService.update(actor, {
        id: recordComment.id,
        content: '记录评论已编辑',
        mentionedUserIds: [],
      })
      assert.equal(updatedRecordComment.content, '记录评论已编辑')
      assert.equal(
        (
          await prisma8Client.orm.public.FollowUpRecordCommentMention.where({
            commentId: recordComment.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
      assert.deepEqual(await recordService.remove(actor, recordComment.id), {
        id: recordComment.id,
        commentCount: 0,
      })
      assert.equal(
        (
          await prisma8Client.orm.public.FollowUpRecords.where({ id: record.id })
            .select('commentCount')
            .first()
        )?.commentCount,
        0,
      )

      const planComment = await planService.add(actor, {
        resourceId: plan.id,
        content: '计划评论',
        mentionedUserIds: [mentionRow.id],
      })
      const persistedPlanComment = await prisma8Client.orm.public.FollowUpPlanComment.where({
        id: planComment.id,
      }).first()
      assert.ok(persistedPlanComment)
      assert.equal(persistedPlanComment.content, '计划评论')
      const planMentions = await prisma8Client.orm.public.FollowUpPlanCommentMention.where({
        commentId: planComment.id,
      })
        .select('userId')
        .all()
      assert.deepEqual(
        planMentions.map((item) => item.userId),
        [mentionRow.id],
      )
      assert.equal(
        (
          await prisma8Client.orm.public.FollowUpPlans.where({ id: plan.id })
            .select('commentCount')
            .first()
        )?.commentCount,
        1,
      )

      await planService.update(actor, {
        id: planComment.id,
        content: '计划评论已编辑',
        mentionedUserIds: [],
      })
      assert.equal(
        (
          await prisma8Client.orm.public.FollowUpPlanCommentMention.where({
            commentId: planComment.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
      assert.deepEqual(await planService.remove(actor, planComment.id), {
        id: planComment.id,
        commentCount: 0,
      })
      assert.equal(
        (
          await prisma8Client.orm.public.FollowUpPlans.where({ id: plan.id })
            .select('commentCount')
            .first()
        )?.commentCount,
        0,
      )
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.FollowUpRecords.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.FollowUpPlans.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Customer.where({ organizationId: tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
