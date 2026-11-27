import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthUser } from '../src/common/auth-user'
import { resolveMobileNotificationPath } from '../../mobile/src/utils/notification-link'

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant, instantFromEpochMilliseconds } = await import('../src/prisma/temporal')
  const { DataScopeService } = await import('../src/common/services/data-scope.service')
  const { CustomerAccessService } = await import('../src/customers/customer-access.service')
  const { ResourcePoolsService } = await import('../src/modules/pool-rules/resource-pools.service')
  const { CluePoolRepository } = await import('../src/modules/pool-rules/clue-pool.repository')
  const { CustomerPoolRepository } =
    await import('../src/modules/pool-rules/customer-pool.repository')
  const { FollowUpPlansService } =
    await import('../src/modules/follow-up-plans/follow-up-plans.service')
  const { FollowUpsService } = await import('../src/modules/follow-ups/follow-ups.service')
  const { NotificationBatchDetailService } =
    await import('../src/modules/notifications/notification-batch-detail.service')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const uid = () => randomUUID().replaceAll('-', '')
  const tenantId = uid(),
    otherTenantId = uid(),
    member = uid(),
    other = uid(),
    foreign = uid(),
    roleId = uid(),
    leadId = uid(),
    hiddenLead = uid(),
    customerId = uid(),
    foreignLead = uid(),
    planId = uid(),
    recordId = uid(),
    commentId = uid()
  const now = nowInstant()
  const times = {
    createTime: BigInt(Date.now()),
    updateTime: BigInt(Date.now()),
    createUser: member,
    updateUser: member,
  }
  const cachedAuth: AuthUser = {
    id: member,
    tenantId,
    email: null,
    name: 'Fixture member',
    deptId: null,
    leaderId: null,
    permissions: ['*'],
    roles: [
      { id: roleId, name: 'Stale cache', permissions: ['*'], dataScope: 'ALL', scopeDeptIds: [] },
    ],
  }
  const scope = new DataScopeService(prisma)
  const pools = new ResourcePoolsService(
    prisma,
    new CluePoolRepository(prisma, {} as never, {} as never),
    new CustomerPoolRepository(prisma, {} as never, {} as never),
    {} as never,
  )
  const customers = new CustomerAccessService(prisma, scope, pools)
  const plans = new FollowUpPlansService(
    prisma,
    scope,
    customers,
    pools,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  const records = new FollowUpsService(
    prisma,
    customers,
    scope,
    pools,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  const service = new NotificationBatchDetailService(prisma, scope, customers, plans, records)
  const permits = ['menu:lead', 'menu:customer', 'customer:read']
  try {
    await orm.Tenants.createAll(
      [tenantId, otherTenantId].map((id) => ({ id, slug: id, name: 'Fixture', updatedAt: now })),
    )
    await orm.Users.createAll(
      [
        { id: member, tenantId },
        { id: other, tenantId },
        { id: foreign, tenantId: otherTenantId },
      ].map((row) => ({ ...row, name: 'Fixture', passwordHash: 'unused-fixture', updatedAt: now })),
    )
    await orm.Roles.create({
      id: roleId,
      tenantId,
      name: 'Fixture role',
      permissions: permits,
      dataScope: 'SELF',
      updatedAt: now,
    })
    await orm.UserRoles.create({ tenantId, userId: member, roleId, updatedAt: now })
    await orm.Clue.createAll(
      [
        { id: leadId, owner: member, organizationId: tenantId },
        { id: hiddenLead, owner: other, organizationId: tenantId },
        { id: foreignLead, owner: foreign, organizationId: otherTenantId },
      ].map((row) => ({ ...row, name: 'Fixture lead', ...times })),
    )
    await orm.Customer.create({
      id: customerId,
      owner: other,
      organizationId: tenantId,
      name: 'Fixture customer',
      ...times,
    })
    await orm.CustomerCollaboration.create({
      id: uid(),
      customerId,
      userId: member,
      collaborationType: 'READ_ONLY',
      createUser: member,
      updateUser: member,
      createTime: times.createTime,
      updateTime: times.updateTime,
    })
    await orm.FollowUpPlans.create({
      id: planId,
      tenantId,
      targetType: 'lead',
      targetId: leadId,
      content: 'Fixture plan',
      ownerId: member,
      createdById: member,
      updatedAt: now,
    })
    await orm.FollowUpRecords.create({
      id: recordId,
      tenantId,
      targetType: 'lead',
      targetId: leadId,
      content: 'Fixture record',
      ownerId: member,
      ownerName: 'Fixture',
      createdById: member,
      updatedAt: now,
    })
    await orm.FollowUpRecordComment.create({
      id: commentId,
      resourceId: recordId,
      organizationId: tenantId,
      content: 'Fixture comment',
      createUser: member,
      updateUser: member,
      updateTime: now,
    })
    const output = await orm.Notifications.create({
      tenantId,
      userId: member,
      _type: 'system',
      title: 'Fixture summary',
    })
    const batchId = uid()
    const sample = [
      { event: 'CLUE_ADD', link: '/leads?id=' + leadId, allowed: true },
      { event: 'CLUE_ADD', link: '/leads?id=' + hiddenLead, allowed: false },
      { event: 'CLUE_ADD', link: '/leads?id=' + foreignLead, allowed: false },
      { event: 'CLUE_ADD', link: '/leads', allowed: false },
      { event: 'CLUE_ADD', link: '//external.invalid/leads?id=' + leadId, allowed: false },
      { event: 'CLUE_ADD', link: '/leads?id=' + leadId + '&id=' + hiddenLead, allowed: false },
      { event: 'CUSTOMER_ADD', link: '/customers?id=' + customerId, allowed: true },
      { event: 'CLUE_FOLLOW_UP_PLAN_DUE', link: '/follow-plans?id=' + planId, allowed: true },
      {
        event: 'CLUE_FOLLOW_UP_RECORD_COMMENT_ADDED',
        link: '/leads?id=' + leadId + '&followUpId=' + recordId + '&commentId=' + commentId,
        allowed: true,
      },
      {
        event: 'CLUE_FOLLOW_UP_RECORD_COMMENT_ADDED',
        link: '/leads?id=' + leadId + '&followUpId=' + recordId + '&commentId=' + uid(),
        allowed: false,
      },
    ]
    const makeBatch = async (
      id: string,
      channel: 'SYSTEM' | 'WECOM',
      outputId: string | null,
      sealed: boolean,
      count: number,
    ) => {
      await orm.NotificationBatch.create({
        id,
        scopeKey: uid(),
        tenantId,
        recipientId: member,
        channel,
        category: 'LEAD_ACTIVITY',
        aggregationGroup: 'LEAD_ACTIVITY',
        aggregationMode: 'SAME_CATEGORY',
        priority: 'NORMAL',
        language: 'zh-CN',
        windowStart: now,
        windowEnd: now,
        itemCount: count,
        outputId,
        sealedAt: sealed ? now : null,
      })
    }
    await makeBatch(batchId, 'SYSTEM', output.id, true, sample.length)
    await orm.NotificationItem.createAll(
      sample.map((row, i) => ({
        id: uid(),
        batchId,
        sourceKey: uid(),
        event: row.event,
        _type: 'system',
        title: 'fixture-private-title-' + i,
        content: 'fixture-private-body-' + i,
        link: row.link,
        occurredAt: now,
        createdAt: instantFromEpochMilliseconds(now.epochMilliseconds + i),
      })),
    )
    const first = await service.list(cachedAuth, batchId, 1, 5)
    const second = await service.list(cachedAuth, batchId, 2, 5)
    assert.equal(first.total, sample.length)
    assert.deepEqual(
      [...first.items, ...second.items].map((row) => row.accessible),
      sample.map((row) => row.allowed),
    )
    for (const row of [...first.items, ...second.items].filter((row) => !row.accessible)) {
      assert.equal(row.title, null)
      assert.equal(row.content, null)
      assert.equal(row.link, null)
      assert.equal(row.linkLabel, null)
      assert.ok(!JSON.stringify(row).includes('fixture-private'))
    }
    assert.equal(first.items[0]?.link, '/leads?id=' + leadId)
    assert.ok(!JSON.stringify([...first.items, ...second.items]).includes('fixture-private'))
    assert.equal(first.items[0]?.content, null)
    assert.equal(
      new Set([...first.items, ...second.items].map((row) => row.id)).size,
      sample.length,
    )
    assert.equal((await service.list(cachedAuth, batchId, 3, 5)).items.length, 0)
    await assert.rejects(service.list({ ...cachedAuth, id: other }, batchId), /通知批次不存在/)
    await assert.rejects(
      service.list({ ...cachedAuth, tenantId: otherTenantId, id: foreign }, batchId),
      /通知批次不存在/,
    )
    await assert.rejects(service.list(cachedAuth, batchId, 1, 101), /通知批次不存在/)
    const pending = uid()
    await makeBatch(pending, 'SYSTEM', null, false, 0)
    await assert.rejects(service.list(cachedAuth, pending), /通知批次不存在/)
    const external = await orm.MessageDeliveries.create({
      tenantId,
      userId: member,
      channel: 'WECOM',
      externalSubject: 'fixture',
      event: 'AGGREGATED:LEAD_ACTIVITY',
      title: 'Fixture summary',
      updatedAt: now,
    })
    const externalBatch = uid()
    await makeBatch(externalBatch, 'WECOM', external.id, true, 1)
    await orm.NotificationItem.create({
      batchId: externalBatch,
      sourceKey: uid(),
      event: 'CLUE_ADD',
      _type: 'system',
      title: 'fixture external',
      content: 'fixture external body',
      link: '/leads?id=' + leadId,
      occurredAt: now,
    })
    assert.equal((await service.list(cachedAuth, externalBatch)).items[0]?.accessible, true)
    // Transfer and collaboration revocation must take effect even though the
    // caller carries a stale ALL permissions context.
    await orm.Clue.where({ id: leadId, organizationId: tenantId }).update({ owner: other })
    await orm.CustomerCollaboration.where({ customerId, userId: member }).deleteAll()
    const transferred = await service.list(cachedAuth, batchId)
    assert.ok(transferred.items.every((row) => !row.accessible))
    await orm.Clue.where({ id: leadId, organizationId: tenantId }).update({ owner: member })
    await orm.FollowUpRecordComment.where({ id: commentId, organizationId: tenantId }).deleteAll()
    const deleted = await service.list(cachedAuth, batchId)
    assert.equal(deleted.items[0]?.accessible, true)
    assert.equal(deleted.items[8]?.accessible, false)
    await orm.Roles.where({ id: roleId, tenantId }).update({ permissions: [] })
    assert.ok((await service.list(cachedAuth, batchId)).items.every((row) => !row.accessible))
    const excludedId = first.items[0]!.id
    await orm.NotificationItem.where({ id: excludedId, batchId }).update({
      suppressedAt: now,
      suppressionReason: 'CHANNEL_EVENT_DISABLED',
    })
    const filtered = await service.list(cachedAuth, batchId, 1, 100)
    assert.equal(filtered.total, sample.length - 1)
    assert.equal(filtered.items.length, sample.length - 1)
    assert.ok(!filtered.items.some((row) => row.id === excludedId))

    await prisma.client.transaction(async (tx) => {
      await tx.orm.public.NotificationItem.where({ batchId }).deleteAndCount()
      await tx.orm.public.NotificationBatch.where({ id: batchId }).update({
        detailsArchivedAt: now,
      })
    })
    const archived = await service.list(cachedAuth, batchId)
    assert.equal(archived.total, 0)
    assert.deepEqual(archived.items, [])
    assert.ok(archived.detailsArchivedAt)
    await assert.rejects(service.list({ ...cachedAuth, id: other }, batchId), /通知批次不存在/)
    await orm.Users.where({ id: member, tenantId }).update({ status: 'DISABLED' })
    await assert.rejects(service.list(cachedAuth, batchId), /通知批次不存在/)
    assert.equal(
      resolveMobileNotificationPath('/notifications/batches/' + batchId),
      '/mine/message/batch?id=' + batchId,
    )
    assert.equal(
      resolveMobileNotificationPath('/mobile/mine/message/batch?id=' + batchId),
      '/mine/message/batch?id=' + batchId,
    )
    assert.equal(
      resolveMobileNotificationPath('//external.invalid/notifications/batches/' + batchId),
      null,
    )
    assert.equal(resolveMobileNotificationPath('/mine/message/batch'), null)
    console.log(
      'Batch detail real PG: fresh role scope, lead/customer collaboration/plan/comment access, pagination, transfer, revocation, deleted comment, recipient/tenant isolation, WECOM-only access and mobile link checks passed.',
    )
  } finally {
    for (const tenant of [tenantId, otherTenantId]) {
      await orm.NotificationBatch.where({ tenantId: tenant }).deleteAll()
      await orm.Notifications.where({ tenantId: tenant }).deleteAll()
      await orm.MessageDeliveries.where({ tenantId: tenant }).deleteAll()
      await orm.FollowUpRecordComment.where({ organizationId: tenant }).deleteAll()
      await orm.FollowUpRecords.where({ tenantId: tenant }).deleteAll()
      await orm.FollowUpPlans.where({ tenantId: tenant }).deleteAll()
      await orm.Customer.where({ organizationId: tenant }).deleteAll()
      await orm.Clue.where({ organizationId: tenant }).deleteAll()
      await orm.UserRoles.where({ tenantId: tenant }).deleteAll()
      await orm.Roles.where({ tenantId: tenant }).deleteAll()
      await orm.Users.where({ tenantId: tenant }).deleteAll()
      await orm.Tenants.where({ id: tenant }).deleteAll()
    }
    await prisma.onModuleDestroy()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
