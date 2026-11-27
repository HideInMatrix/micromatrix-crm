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
  const service = new NotificationBatchDetailService(prisma)
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
      { event: 'CLUE_ADD', link: '/leads?id=' + hiddenLead, allowed: true },
      { event: 'CLUE_ADD', link: '/leads?id=' + foreignLead, allowed: true },
      { event: 'CLUE_ADD', link: '/leads', allowed: true },
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
        allowed: true,
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
    const assertSnapshots = (rows: typeof first.items) => {
      assert.equal(rows.length, sample.length)
      for (const [i, row] of rows.entries()) {
        assert.equal(row.accessible, true)
        assert.equal(row.title, 'fixture-private-title-' + i)
        assert.equal(row.content, 'fixture-private-body-' + i)
        assert.equal(row.link, sample[i]!.allowed ? sample[i]!.link : null)
        assert.equal(row.linkLabel, sample[i]!.allowed ? '查看业务记录' : null)
        assert.ok(!('sourceKey' in row) && !('sourceId' in row))
      }
    }
    assertSnapshots([...first.items, ...second.items])
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
    // Notification history remains readable when live business access changes.
    const selfAuth: AuthUser = {
      ...cachedAuth,
      permissions: permits,
      roles: [
        { id: roleId, name: 'Fixture', permissions: permits, dataScope: 'SELF', scopeDeptIds: [] },
      ],
    }
    assert.equal(await scope.matchesBusinessOwner(selfAuth, member), true)
    await customers.assertRead(selfAuth, customerId)
    await orm.Clue.where({ id: leadId, organizationId: tenantId }).update({ owner: other })
    await orm.CustomerCollaboration.where({ customerId, userId: member }).deleteAll()
    assert.equal(await scope.matchesBusinessOwner(selfAuth, other), false)
    await assert.rejects(customers.assertRead(selfAuth, customerId))
    assertSnapshots((await service.list(cachedAuth, batchId)).items)
    await orm.Clue.where({ id: leadId, organizationId: tenantId }).update({ owner: member })
    await orm.FollowUpRecordComment.where({ id: commentId, organizationId: tenantId }).deleteAll()
    assertSnapshots((await service.list(cachedAuth, batchId)).items)
    await orm.Roles.where({ id: roleId, tenantId }).update({ permissions: [] })
    assertSnapshots((await service.list(cachedAuth, batchId)).items)
    const unsafeLinks = [
      null,
      'javascript:alert(1)',
      'https://external.invalid/leads',
      '/admin',
      '/leads?id=' + leadId + '&redirect=https://external.invalid',
      '/leads?id=' + leadId + '#fragment',
      '/leads?id=%2F',
      '/leads?id=' + leadId + '&followUpId=' + recordId,
      '/follow-plans?id=' + planId,
      '/leads?id=' + leadId + '&id=' + leadId,
    ]
    await orm.NotificationItem.createAll(
      unsafeLinks.map((link, i) => ({
        batchId: externalBatch,
        sourceKey: uid(),
        event: 'CLUE_ADD',
        _type: 'system',
        title: 'unsafe link fixture ' + i,
        content: 'snapshot remains visible',
        link,
        occurredAt: now,
        createdAt: instantFromEpochMilliseconds(now.epochMilliseconds + 100 + i),
      })),
    )
    const externalDetail = await service.list(cachedAuth, externalBatch)
    assert.equal(externalDetail.items.length, unsafeLinks.length + 1)
    assert.equal(
      externalDetail.items.filter((row) => row.content === 'fixture external body').length,
      1,
    )
    for (const row of externalDetail.items.filter(
      (row) => row.content !== 'fixture external body',
    )) {
      assert.equal(row.accessible, true)
      assert.equal(row.content, 'snapshot remains visible')
      assert.equal(row.link, null)
      assert.equal(row.linkLabel, null)
    }
    // A batch cannot confer access through another recipient's output.
    const mismatched = await orm.Notifications.create({
      tenantId,
      userId: other,
      _type: 'system',
      title: 'Other output',
    })
    const mismatchedBatch = uid()
    await makeBatch(mismatchedBatch, 'SYSTEM', mismatched.id, true, 0)
    await assert.rejects(service.list(cachedAuth, mismatchedBatch), /通知批次不存在/)
    await orm.Tenants.where({ id: tenantId }).update({ status: 'SUSPENDED' })
    await assert.rejects(service.list(cachedAuth, externalBatch), /通知批次不存在/)
    await orm.Tenants.where({ id: tenantId }).update({ status: 'ACTIVE' })
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
      'Batch detail real PG: recipient snapshot, target business scope, pagination, transfer, revocation, deleted comment, unsafe links, output/recipient/tenant isolation, suppression/archive, WECOM-only and mobile link checks passed.',
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
