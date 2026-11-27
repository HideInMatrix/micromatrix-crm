import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { AuthUser } from '../src/common/auth-user'
import type { AggregationItemInput } from '../src/modules/notifications/notification-aggregation.store'

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant, instantFromEpochMilliseconds } = await import('../src/prisma/temporal')
  const { NotificationAggregationStore } =
    await import('../src/modules/notifications/notification-aggregation.store')
  const {
    NotificationLifecycleService,
    notificationRetentionDays,
    notificationDedupRetentionDays,
  } = await import('../src/modules/notifications/notification-lifecycle.service')
  const { NotificationDedupCleanupService } =
    await import('../src/modules/notifications/notification-dedup-cleanup.service')
  const { lockNotificationRecipient } =
    await import('../src/modules/notifications/notification-lifecycle-locks')
  const { MembersService } = await import('../src/modules/members/members.service')
  const { MessageSettingsService } =
    await import('../src/modules/message-settings/message-settings.service')
  const { MessageDeliveryService } =
    await import('../src/modules/notifications/message-delivery.service')
  const { WeComClient } = await import('../src/modules/enterprise-integrations/wecom.client')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const uid = () => randomUUID().replaceAll('-', '')
  const tenantId = uid(),
    otherTenantId = uid(),
    member = uid(),
    removed = uid(),
    operator = uid(),
    foreign = uid()
  const tenants = [tenantId, otherTenantId]
  const sourceKeys = new Set<string>()
  const batches = new Set<string>()
  const now = nowInstant(),
    old = instantFromEpochMilliseconds(Date.now() - 100 * 86400_000)
  const previousEnv = { ...process.env }
  const originalFetch = globalThis.fetch
  const store = new NotificationAggregationStore(prisma)
  const lifecycle = new NotificationLifecycleService(prisma)
  type LifecycleTest = {
    cleanBatch(id: string, days: number | null): Promise<{ kind: string; items: number } | null>
    nextPage(): Promise<string[]>
  }
  const clean = lifecycle as unknown as LifecycleTest
  const batchRow = (id: string) => orm.NotificationBatch.where({ id }).first()
  const itemRows = (id: string) => orm.NotificationItem.where({ batchId: id }).all()
  const delivery = (id: string) => orm.MessageDeliveries.where({ id }).first()
  let posts = 0
  const oldCursor = await orm.NotificationLifecycleCursor.where({
    id: 'aggregation-lifecycle-v1',
  }).first()
  Object.assign(process.env, {
    CRM_NOTIFICATION_RETENTION: '0',
    CRM_NOTIFICATION_DEDUP_RETENTION_DAYS: '30',
    CRM_NOTIFICATION_AGGREGATION: '1',
    CRM_WECOM_RATE_LIMIT: '0',
  })
  globalThis.fetch = async () => {
    throw Error('Unexpected provider network')
  }
  try {
    await orm.Tenants.createAll(
      tenants.map((id) => ({ id, slug: id, name: 'Lifecycle fixture', updatedAt: now })),
    )
    await orm.Users.createAll(
      [
        { id: member, tenantId },
        { id: removed, tenantId },
        { id: operator, tenantId },
        { id: foreign, tenantId: otherTenantId },
      ].map((row) => ({
        ...row,
        name: 'Fixture member',
        passwordHash: 'unused-fixture',
        updatedAt: now,
      })),
    )
    const corpId = uid(),
      agentId = '123',
      externalSubject = 'fixture-member'
    const integration = await orm.EnterpriseIntegrations.create({
      tenantId,
      provider: 'WECOM',
      corpId,
      agentId,
      secretCiphertext: 'fixture',
      secretIv: 'fixture',
      secretAuthTag: 'fixture',
      syncEnabled: true,
      lastTestSucceeded: true,
      createdById: operator,
      updatedById: operator,
      updatedAt: now,
    })
    await orm.ExternalUserMappings.create({
      tenantId,
      userId: removed,
      provider: 'WECOM',
      externalId: externalSubject,
      externalKey: externalSubject,
      updatedAt: now,
    })
    await orm.MessageTaskSettings.create({
      tenantId,
      module: 'CLUE',
      event: 'CLUE_ADD',
      systemEnabled: true,
      weComEnabled: true,
      updatedAt: now,
    })
    const make = async (
      opts: {
        channel?: 'SYSTEM' | 'WECOM'
        recipientId?: string
        tenant?: string
        status?: 'PENDING' | 'SENDING' | 'FAILED' | 'DEAD' | 'SUCCEEDED'
        read?: boolean
        sealed?: boolean
        quarantine?: boolean
        fresh?: boolean
        noOutput?: boolean
        allSuppressed?: boolean
        mismatch?: boolean
        newCompletion?: boolean
      } = {},
    ) => {
      const id = uid(),
        channel = opts.channel ?? 'SYSTEM',
        recipientId = opts.recipientId ?? member,
        t = opts.tenant ?? tenantId
      const createdAt = opts.fresh ? now : old
      let outputId: string | null = null
      if (!opts.noOutput && opts.sealed !== false) {
        if (channel === 'SYSTEM')
          outputId = (
            await orm.Notifications.create({
              tenantId: opts.mismatch ? otherTenantId : t,
              userId: opts.mismatch ? foreign : recipientId,
              _type: 'system',
              title: 'Summary',
              content: 'Historical summary',
              readAt: opts.read ? (opts.newCompletion ? now : old) : null,
              createdAt,
            })
          ).id
        else
          outputId = (
            await orm.MessageDeliveries.create({
              tenantId: t,
              userId: recipientId,
              integrationId: integration.id,
              channel: 'WECOM',
              externalSubject,
              event: 'CLUE_ADD',
              title: 'Private legacy title',
              content: 'Private legacy body',
              link: '/leads?id=fixture',
              status: opts.status ?? 'SUCCEEDED',
              attempts: 1,
              claimToken: uid(),
              sentAt:
                (opts.status ?? 'SUCCEEDED') === 'SUCCEEDED'
                  ? opts.newCompletion
                    ? now
                    : old
                  : null,
              updatedAt: opts.newCompletion ? now : createdAt,
              createdAt,
            })
          ).id
      }
      await orm.NotificationBatch.create({
        id,
        scopeKey: uid(),
        tenantId: t,
        recipientId,
        channel,
        category: 'LEAD_ACTIVITY',
        aggregationGroup: 'LEAD_ACTIVITY',
        aggregationMode: 'SAME_CATEGORY',
        priority: 'NORMAL',
        language: 'zh-CN',
        windowStart: createdAt,
        windowEnd: createdAt,
        createdAt,
        sealedAt: opts.sealed === false ? null : createdAt,
        outputId,
        itemCount: 1,
        ...(channel === 'WECOM'
          ? {
              integrationId: integration.id,
              credentialVersion: integration.credentialVersion,
              externalSubject,
            }
          : {}),
        ...(opts.quarantine ? { sealDeadAt: old, sealFailures: 5 } : {}),
      })
      const sourceKey = uid() + uid()
      sourceKeys.add(sourceKey)
      batches.add(id)
      const item = await orm.NotificationItem.create({
        batchId: id,
        sourceKey,
        event: 'CLUE_ADD',
        _type: 'system',
        title: 'Private item',
        content: 'Private original body',
        link: '/leads?id=fixture',
        occurredAt: createdAt,
        createdAt,
        ...(opts.allSuppressed
          ? { suppressedAt: old, suppressionReason: 'CHANNEL_EVENT_DISABLED' }
          : {}),
      })
      return { id, outputId, item }
    }
    // Actual admission with deterministic source key, then age a sealed row.
    const input: AggregationItemInput = {
      channel: 'SYSTEM',
      tenantId,
      recipientId: member,
      intentId: uid(),
      event: 'CLUE_ADD',
      type: 'system',
      language: 'zh-CN',
      title: 'Private replay',
      content: 'Private payload',
      occurredAt: now,
    }
    const accepted = (await prisma.client.transaction((tx) => store.append(tx, input)))!
    batches.add(accepted.batchId)
    const admitted = (await itemRows(accepted.batchId))[0]!
    sourceKeys.add(admitted.sourceKey)
    await orm.NotificationBatch.where({ id: accepted.batchId }).update({
      windowEnd: old,
      windowStart: old,
      createdAt: old,
    })
    const sealed = (await store.seal(
      accepted.batchId,
      async (tx, batch) =>
        (
          await tx.orm.public.Notifications.create({
            tenantId: batch.tenantId,
            userId: batch.recipientId,
            _type: 'system',
            title: 'Summary',
            readAt: old,
            createdAt: old,
            sourceType: 'NOTIFICATION_BATCH',
            sourceId: batch.id,
          })
        ).id,
    ))!
    await orm.NotificationBatch.where({ id: accepted.batchId }).update({ sealedAt: old })
    assert.equal(notificationRetentionDays(), null)
    assert.equal(await clean.cleanBatch(accepted.batchId, notificationRetentionDays()), null)
    assert.equal((await itemRows(accepted.batchId)).length, 1)
    process.env.CRM_NOTIFICATION_RETENTION = '1'
    process.env.CRM_NOTIFICATION_RETENTION_DAYS = '1'
    assert.equal(notificationRetentionDays(), null)
    process.env.CRM_NOTIFICATION_RETENTION_DAYS = '90'
    assert.equal(notificationRetentionDays(), 90)
    // Concurrent replay and cleanup cannot create new output/items. A new
    // service instance must consult the durable tombstone after deletion.
    const results = await Promise.all([
      clean.cleanBatch(accepted.batchId, 90),
      (new NotificationLifecycleService(prisma) as unknown as LifecycleTest).cleanBatch(
        accepted.batchId,
        90,
      ),
      prisma.client.transaction((tx) => store.append(tx, input)),
    ])
    // Both cleaners may legitimately skip while replay owns the recipient lock.
    // A later bounded pass must archive once, never duplicate the tombstone.
    const archivedCount = results.slice(0, 2).filter(Boolean).length
    assert.ok(archivedCount <= 1)
    if (!archivedCount)
      assert.deepEqual(await clean.cleanBatch(accepted.batchId, 90), { kind: 'archive', items: 1 })
    assert.equal((await itemRows(accepted.batchId)).length, 0)
    assert.ok((await batchRow(accepted.batchId))?.detailsArchivedAt)
    assert.equal((await batchRow(accepted.batchId))?.itemCount, 1)
    assert.ok((await orm.Notifications.where({ id: sealed.outputId! }).first())?.readAt)
    const replay = await prisma.client.transaction((tx) =>
      new NotificationAggregationStore(prisma).append(tx, input),
    )
    assert.deepEqual(replay, { ...accepted, inserted: false })
    assert.equal(
      (await orm.NotificationSourceTombstone.where({ sourceKey: admitted.sourceKey }).first())
        ?.itemId,
      admitted.id,
    )

    const tombstone = (await orm.NotificationSourceTombstone.where({
      sourceKey: admitted.sourceKey,
    }).first())!
    assert.ok(tombstone.expiresAt)
    assert.equal(tombstone.tenantId, tenantId)
    assert.equal(
      tombstone.expiresAt!.epochMilliseconds,
      (await batchRow(accepted.batchId))!.detailsArchivedAt!.epochMilliseconds + 30 * 86400_000,
    )
    assert.equal(notificationDedupRetentionDays(), 30)
    process.env.CRM_NOTIFICATION_DEDUP_RETENTION_DAYS = '0'
    assert.equal(notificationDedupRetentionDays(), 30)
    process.env.CRM_NOTIFICATION_DEDUP_RETENTION_DAYS = '1.5'
    assert.equal(notificationDedupRetentionDays(), 30)
    process.env.CRM_NOTIFICATION_DEDUP_RETENTION_DAYS = '7'
    assert.equal(notificationDedupRetentionDays(), 7)
    // Read/replay and configuration changes cannot renew or shorten an
    // existing expiry. Cleanup leaves valid records alone.
    await lifecycle.sweep()
    assert.equal(
      (await orm.NotificationSourceTombstone.where({ sourceKey: admitted.sourceKey }).first())
        ?.expiresAt?.epochMilliseconds,
      tombstone.expiresAt!.epochMilliseconds,
    )
    process.env.CRM_NOTIFICATION_DEDUP_RETENTION_DAYS = '30'
    const protectedRows = await Promise.all([
      make(),
      make({ read: true, fresh: true }),
      make({ read: true, newCompletion: true }),
      make({ sealed: false }),
      make({ sealed: false, quarantine: true, noOutput: true }),
      ...(['PENDING', 'SENDING', 'FAILED', 'DEAD'] as const).map((status) =>
        make({ channel: 'WECOM', status }),
      ),
      make({ channel: 'WECOM', status: 'SUCCEEDED', newCompletion: true }),
    ])
    for (const row of protectedRows) {
      assert.equal(await clean.cleanBatch(row.id, 90), null)
      assert.equal((await itemRows(row.id)).length, 1)
      assert.equal((await batchRow(row.id))?.detailsArchivedAt, null)
    }
    const success = await make({ channel: 'WECOM' })
    assert.deepEqual(await clean.cleanBatch(success.id, 90), { kind: 'archive', items: 1 })
    assert.equal((await delivery(success.outputId!))?.status, 'SUCCEEDED')
    assert.ok(await batchRow(success.id))
    const suppressed = await make({ noOutput: true, allSuppressed: true })
    assert.deepEqual(await clean.cleanBatch(suppressed.id, 90), { kind: 'archive', items: 1 })
    // Corrupt association and duplicate tombstone both fail atomically.
    const wrong = await make({ read: true, mismatch: true })
    await assert.rejects(clean.cleanBatch(wrong.id, 90), /scope mismatch/)
    assert.equal((await itemRows(wrong.id)).length, 1)
    const rollback = await make({ read: true })
    await orm.NotificationSourceTombstone.create({
      sourceKey: rollback.item.sourceKey,
      batchId: rollback.id,
      itemId: rollback.item.id,
    })
    await assert.rejects(clean.cleanBatch(rollback.id, 90))
    assert.equal((await itemRows(rollback.id)).length, 1)
    assert.equal((await batchRow(rollback.id))?.detailsArchivedAt, null)
    await orm.NotificationSourceTombstone.where({
      sourceKey: rollback.item.sourceKey,
    }).deleteAndCount()
    assert.deepEqual(await clean.cleanBatch(rollback.id, 90), { kind: 'archive', items: 1 })
    // Busy recipient lock: try-lock skips instead of blocking normal work.
    const busy = await make({ read: true })
    let acquired!: () => void, release!: () => void
    const started = new Promise<void>((r) => {
      acquired = r
    })
    const gate = new Promise<void>((r) => {
      release = r
    })
    const locked = prisma.client.transaction(async (tx) => {
      await lockNotificationRecipient(prisma.client, tx, tenantId, member)
      acquired()
      await gate
    })
    await started
    try {
      assert.equal(await clean.cleanBatch(busy.id, 90), null)
    } finally {
      release()
      await locked
    }
    assert.deepEqual(await clean.cleanBatch(busy.id, 90), { kind: 'archive', items: 1 })
    // Disabled is not deleted. Even with retention off, only actual orphans
    // are removed. Exercise the real member removal workflow.
    await orm.Users.where({ id: member, tenantId }).update({ status: 'DISABLED' })
    assert.equal(await clean.cleanBatch(protectedRows[0]!.id, null), null)
    await orm.Users.where({ id: member, tenantId }).update({ status: 'ACTIVE' })
    const orphanStation = await make({ recipientId: removed })
    const orphanPending = await make({ channel: 'WECOM', recipientId: removed, status: 'PENDING' })
    const orphanSuccess = await make({
      channel: 'WECOM',
      recipientId: removed,
      status: 'SUCCEEDED',
    })
    const orphanQuarantine = await make({
      recipientId: removed,
      sealed: false,
      quarantine: true,
      noOutput: true,
    })
    const orphanArchived = await make({ recipientId: removed, read: true })
    assert.ok(await clean.cleanBatch(orphanArchived.id, 90))
    const memberService = new MembersService(
      prisma,
      {} as never,
      { invalidateMany: async () => {} } as never,
    )
    const runtime = {
      getWeComRuntimeContext: async () => ({
        integration,
        credentials: { corpId, agentId, appSecret: 'fixture-secret' },
      }),
    }
    const config = {
      get: (key: string) => (key === 'WECOM_API_BASE_URL' ? 'https://example.invalid' : undefined),
    }
    const worker = new MessageDeliveryService(
      prisma,
      new MessageSettingsService(prisma),
      runtime as never,
      new WeComClient(config as never),
    )
    let removedDuringToken = false
    globalThis.fetch = async (input) => {
      const endpoint = new URL(String(input))
      assert.equal(endpoint.origin, 'https://example.invalid')
      if (endpoint.pathname === '/cgi-bin/gettoken') {
        await memberService.remove(tenantId, operator, removed)
        assert.ok(await clean.cleanBatch(orphanPending.id, null))
        removedDuringToken = true
        return Response.json({ errcode: 0, access_token: 'fixture', expires_in: 7200 })
      }
      posts++
      return Response.json({ errcode: 0 })
    }
    await worker.processIds([orphanPending.outputId!])
    assert.equal(removedDuringToken, true)
    assert.equal(posts, 0)
    assert.equal(await orm.Users.where({ id: removed, tenantId }).first(), null)
    assert.equal(await batchRow(orphanPending.id), null)
    const scrubbed = await delivery(orphanPending.outputId!)
    assert.equal(scrubbed?.status, 'DEAD')
    assert.equal(scrubbed?.errorCode, 'AGGREGATION_RECIPIENT_REMOVED')
    assert.equal(scrubbed?.externalSubject, null)
    assert.equal(scrubbed?.content, null)
    assert.equal(scrubbed?.link, null)
    await assert.rejects(worker.retry(tenantId, orphanPending.outputId!), /不允许重试/)
    for (const row of [orphanStation, orphanSuccess, orphanQuarantine, orphanArchived]) {
      assert.ok(await clean.cleanBatch(row.id, null))
      assert.equal(await batchRow(row.id), null)
      assert.equal((await itemRows(row.id)).length, 0)
      assert.ok(
        await orm.NotificationSourceTombstone.where({ sourceKey: row.item.sourceKey }).first(),
      )
    }
    assert.equal(await orm.Notifications.where({ id: orphanStation.outputId! }).first(), null)
    assert.equal((await delivery(orphanSuccess.outputId!))?.status, 'SUCCEEDED')
    assert.equal((await delivery(orphanSuccess.outputId!))?.externalSubject, null)
    // Tenant hard-deletion fallback: no API hard-delete workflow exists.
    const tenantOrphan = await make({ tenant: otherTenantId, recipientId: foreign, read: true })
    await orm.Users.where({ tenantId: otherTenantId }).deleteAll()
    await orm.Tenants.where({ id: otherTenantId }).deleteAll()
    assert.deepEqual(await clean.cleanBatch(tenantOrphan.id, null), { kind: 'orphan', items: 1 })
    assert.equal(await orm.Notifications.where({ id: tenantOrphan.outputId! }).first(), null)
    // Persistent cursor is bounded, shared and restart-safe. Use only the
    // guarded isolated DB. Do not modify unrelated candidates during scan.
    const cursorId = 'aggregation-lifecycle-v1'
    const cursor = await orm.NotificationLifecycleCursor.where({ id: cursorId }).first()
    if (cursor)
      await orm.NotificationLifecycleCursor.where({ id: cursorId }).update({ lastBatchId: '' })
    else await orm.NotificationLifecycleCursor.create({ id: cursorId, lastBatchId: '' })
    const page = await clean.nextPage()
    assert.ok(page.length > 0 && page.length <= 50)
    const persisted = await orm.NotificationLifecycleCursor.where({ id: cursorId }).first()
    assert.equal(persisted?.lastBatchId, page.length === 50 ? page.at(-1) : '')
    const next = await (
      new NotificationLifecycleService(prisma) as unknown as LifecycleTest
    ).nextPage()
    assert.ok(next.length <= 50)
    // Expiry is eligibility only. No scheduled deletion. User must confirm
    // exactly the previewed tenant-scoped candidates before deleting.
    const dedup = new NotificationDedupCleanupService(prisma)
    const roleId = uid()
    await orm.Roles.create({
      id: roleId,
      tenantId,
      name: 'Dedup fixture administrator',
      permissions: ['system:message', 'system:message:update'],
      dataScope: 'ALL',
      updatedAt: now,
    })
    await orm.UserRoles.create({ tenantId, userId: operator, roleId, updatedAt: now })
    const actor: AuthUser = {
      id: operator,
      tenantId,
      name: 'Fixture',
      email: null,
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: ['system:message', 'system:message:update'],
    }
    const expiryFixture = uid(),
      legacyKey = uid() + uid(),
      liveKey = uid() + uid(),
      foreignKey = uid() + uid(),
      unownedKey = uid() + uid()
    const future = instantFromEpochMilliseconds(Date.now() + 86400_000)
    const past = instantFromEpochMilliseconds(Date.now() - 1000)
    const older = instantFromEpochMilliseconds(Date.now() - 2000)
    await orm.NotificationSourceTombstone.createAll([
      { sourceKey: legacyKey, tenantId, batchId: expiryFixture, itemId: uid() },
      { sourceKey: liveKey, tenantId, batchId: expiryFixture, itemId: uid(), expiresAt: future },
      {
        sourceKey: foreignKey,
        tenantId: otherTenantId,
        batchId: expiryFixture,
        itemId: uid(),
        expiresAt: past,
      },
      { sourceKey: unownedKey, batchId: expiryFixture, itemId: uid(), expiresAt: past },
    ])
    try {
      for (let i = 0; i < 5001; i += 500) {
        await orm.NotificationSourceTombstone.createAll(
          Array.from({ length: Math.min(500, 5001 - i) }, () => ({
            sourceKey: uid() + uid(),
            tenantId,
            batchId: expiryFixture,
            itemId: uid(),
            expiresAt: past,
          })),
        )
      }
      process.env.CRM_NOTIFICATION_RETENTION = '0'
      process.env.CRM_NOTIFICATION_AGGREGATION = '0'
      await new NotificationLifecycleService(prisma).sweep()
      assert.equal(
        (
          await orm.NotificationSourceTombstone.where({ batchId: expiryFixture }).aggregate(
            (agg) => ({ count: agg.count() }),
          )
        ).count,
        5005,
      )
      const preview = await dedup.preview(actor)
      assert.equal(preview.count, 5000)
      assert.equal(preview.hasMore, true)
      await assert.rejects(dedup.cleanup(actor, { ...preview, confirm: false }), /明确确认/)
      await assert.rejects(dedup.preview({ ...actor, id: member }), /没有清理/)
      await assert.rejects(dedup.preview({ ...actor, tenantId: otherTenantId }), /没有清理/)
      // Role is read fresh despite stale cached permissions.
      await orm.Roles.where({ id: roleId, tenantId }).update({ permissions: ['system:message'] })
      await assert.rejects(dedup.cleanup(actor, { ...preview, confirm: true }), /没有清理/)
      await orm.Roles.where({ id: roleId, tenantId }).update({
        permissions: ['system:message', 'system:message:update'],
      })
      // A newly eligible older source invalidates the exact preview.
      await orm.NotificationSourceTombstone.where({ sourceKey: admitted.sourceKey }).update({
        expiresAt: older,
      })
      await assert.rejects(dedup.cleanup(actor, { ...preview, confirm: true }), /重新预览/)
      assert.deepEqual(await prisma.client.transaction((tx) => store.append(tx, input)), {
        ...accepted,
        inserted: false,
      })
      const confirmed = await dedup.preview(actor)
      const concurrent = await Promise.allSettled([
        dedup.cleanup(actor, { ...confirmed, confirm: true }),
        new NotificationDedupCleanupService(prisma).cleanup(actor, { ...confirmed, confirm: true }),
      ])
      assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
      assert.equal(concurrent.find((result) => result.status === 'fulfilled')?.value.deleted, 5000)
      assert.equal(
        await orm.NotificationSourceTombstone.where({ sourceKey: admitted.sourceKey }).first(),
        null,
      )
      const nextPreview = await dedup.preview(actor)
      assert.equal(nextPreview.count, 2)
      assert.equal(nextPreview.hasMore, false)
      // No implicit continuation; the next two rows survive another sweep.
      await new NotificationLifecycleService(prisma).sweep()
      assert.deepEqual(await dedup.preview(actor), nextPreview)
      assert.equal((await dedup.cleanup(actor, { ...nextPreview, confirm: true })).deleted, 2)
      assert.equal((await dedup.preview(actor)).count, 0)
      for (const key of [liveKey, legacyKey, foreignKey, unownedKey])
        assert.ok(await orm.NotificationSourceTombstone.where({ sourceKey: key }).first())
      assert.equal(
        (await orm.NotificationSourceTombstone.where({ sourceKey: legacyKey }).first())?.expiresAt,
        null,
      )
      assert.equal(
        (await orm.NotificationSourceTombstone.where({ sourceKey: liveKey }).first())?.expiresAt
          ?.epochMilliseconds,
        future.epochMilliseconds,
      )
      assert.ok(await orm.Notifications.where({ id: sealed.outputId! }).first())
      assert.ok((await batchRow(accepted.batchId))?.detailsArchivedAt)
      assert.equal((await itemRows(protectedRows[0]!.id)).length, 1)
      const logs = await orm.OperationLogs.where({
        tenantId,
        userId: operator,
        module: 'messageSetting',
        action: 'cleanupNotificationDedup',
      }).all()
      assert.equal(logs.length, 2)
      assert.ok(logs.some((log) => log.targetName === '去重凭据清理 5000 条'))
      assert.ok(logs.some((log) => log.targetName === '去重凭据清理 2 条'))
      assert.equal(
        (
          await orm.OperationLogBlobs.where((row) =>
            row.operationLogId.in(logs.map((log) => log.id)),
          ).all()
        ).length,
        2,
      )
      const postExpiry = await prisma.client.transaction((tx) => store.append(tx, input))
      assert.equal(postExpiry?.inserted, true)
      assert.notEqual(postExpiry?.batchId, accepted.batchId)
      console.log(
        'Manual dedup cleanup: no scheduled deletion, exact preview, cancel, tenant isolation, fresh permission, stale preview, 5000 bound, concurrent confirmation, audit, replay boundary passed.',
      )
    } finally {
      await orm.NotificationSourceTombstone.where({ batchId: expiryFixture }).deleteAndCount()
      await orm.OperationLogs.where({
        tenantId,
        module: 'messageSetting',
        action: 'cleanupNotificationDedup',
      }).deleteAndCount()
      await orm.UserRoles.where({ tenantId, roleId }).deleteAndCount()
      await orm.Roles.where({ tenantId, id: roleId }).deleteAndCount()
    }

    console.log(
      'Real PostgreSQL lifecycle: retention opt-in, archive/read/terminal guards, finite replay tombstones, concurrent cleanup, rollback, busy lock, real member deletion during token, orphan purge/legacy send fencing, tenant fallback and persistent cursor passed. No real provider requests.',
    )
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]
    Object.assign(process.env, previousEnv)
    for (const sourceKey of sourceKeys)
      await orm.NotificationSourceTombstone.where({ sourceKey }).deleteAndCount()
    for (const tenant of tenants) {
      await orm.NotificationBatch.where({ tenantId: tenant }).deleteAll()
      await orm.Notifications.where({ tenantId: tenant }).deleteAll()
      await orm.MessageDeliveries.where({ tenantId: tenant }).deleteAll()
      await orm.ExternalUserMappings.where({ tenantId: tenant }).deleteAll()
      await orm.EnterpriseIntegrations.where({ tenantId: tenant }).deleteAll()
      await orm.UserRoles.where({ tenantId: tenant }).deleteAll()
      await orm.Roles.where({ tenantId: tenant }).deleteAll()
      await orm.Users.where({ tenantId: tenant }).deleteAll()
      await orm.Tenants.where({ id: tenant }).deleteAll()
    }
    const cursor = await orm.NotificationLifecycleCursor.where({
      id: 'aggregation-lifecycle-v1',
    }).first()
    if (oldCursor && cursor)
      await orm.NotificationLifecycleCursor.where({ id: oldCursor.id }).update({
        lastBatchId: oldCursor.lastBatchId,
      })
    else if (!oldCursor && cursor)
      await orm.NotificationLifecycleCursor.where({ id: cursor.id }).deleteAndCount()
    await prisma.onModuleDestroy()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
