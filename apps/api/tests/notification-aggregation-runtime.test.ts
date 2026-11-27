import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  process.env.CRM_NOTIFICATION_AGGREGATION = '1'
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant } = await import('../src/prisma/temporal')
  const { NotificationAggregationStore } =
    await import('../src/modules/notifications/notification-aggregation.store')
  const { NotificationAggregationConsumer } =
    await import('../src/modules/notifications/notification-aggregation.consumer')
  const { MessageSettingsService } =
    await import('../src/modules/message-settings/message-settings.service')
  const { NotificationsService } =
    await import('../src/modules/notifications/notifications.service')
  const { MessageDeliveryService } =
    await import('../src/modules/notifications/message-delivery.service')
  const { BusinessNotificationsService } =
    await import('../src/modules/notifications/business-notifications.service')
  const { MessageTemplateService } =
    await import('../src/modules/notifications/message-template.service')
  const { ExternalEventNotificationOutboxService } =
    await import('../src/modules/notifications/external-event-notification-outbox.service')
  const { externalEventNotificationIntent } =
    await import('../src/modules/notifications/external-event-notification-intent')
  const { WeComClient } = await import('../src/modules/enterprise-integrations/wecom.client')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const uid = () => randomUUID().replaceAll('-', '')
  const tenantId = uid(),
    recipientId = uid(),
    operatorId = uid()
  const now = nowInstant()
  const originalFetch = globalThis.fetch
  const posts: Record<string, unknown>[] = []
  let tokenCalls = 0
  globalThis.fetch = async (input, init) => {
    const endpoint = new URL(String(input))
    assert.equal(endpoint.origin, 'https://example.invalid')
    if (endpoint.pathname === '/cgi-bin/gettoken') {
      tokenCalls++
      return Response.json({ errcode: 0, access_token: 'fixture-token', expires_in: 7200 })
    }
    assert.equal(endpoint.pathname, '/cgi-bin/message/send')
    posts.push(JSON.parse(String(init?.body)))
    return Response.json({ errcode: 0, msgid: 'fixture-message' })
  }
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const align = async () => {
    const phase = Date.now() % 5000
    if (phase > 600) await sleep(5100 - phase)
  }
  try {
    await orm.Tenants.create({ id: tenantId, slug: tenantId, name: 'Fixture', updatedAt: now })
    await orm.Users.createAll(
      [recipientId, operatorId].map((id) => ({
        id,
        tenantId,
        name: 'Fixture member',
        passwordHash: 'unused-fixture',
        updatedAt: now,
      })),
    )
    const integration = await orm.EnterpriseIntegrations.create({
      tenantId,
      provider: 'WECOM',
      corpId: 'fixture-corp',
      agentId: '123',
      secretCiphertext: 'fixture',
      secretIv: 'fixture',
      secretAuthTag: 'fixture',
      syncEnabled: true,
      lastTestSucceeded: true,
      createdById: operatorId,
      updatedById: operatorId,
      updatedAt: now,
    })
    await orm.ExternalUserMappings.create({
      tenantId,
      userId: recipientId,
      provider: 'WECOM',
      externalId: 'fixture-member',
      externalKey: 'fixture-member',
      updatedAt: now,
    })
    const events = [
      { event: 'CLUE_ADD', module: 'CLUE' },
      { event: 'CLUE_CONVERT_CUSTOMER', module: 'CLUE' },
      { event: 'CUSTOMER_ADD', module: 'CUSTOMER' },
      { event: 'CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED', module: 'CLUE' },
    ]
    await orm.MessageTaskSettings.createAll(
      events.map((event) => ({
        ...event,
        tenantId,
        systemEnabled: true,
        weComEnabled: true,
        updatedAt: now,
      })),
    )
    const store = new NotificationAggregationStore(prisma)
    const settings = new MessageSettingsService(prisma)
    const notifications = new NotificationsService(prisma, settings, undefined, store)
    const sse: string[] = []
    const subscription = notifications.subscribe(recipientId).subscribe((event) => {
      if (event.type !== 'heartbeat') sse.push(event.type ?? '')
    })
    try {
      const config = {
        get: (key: string) =>
          key === 'WECOM_API_BASE_URL'
            ? 'https://example.invalid'
            : key === 'WEB_PUBLIC_URL'
              ? 'https://crm.example.invalid'
              : undefined,
      }
      const integrations = {
        getWeComRuntimeContext: async () => ({
          integration: await orm.EnterpriseIntegrations.where({ id: integration.id }).first(),
          credentials: { corpId: 'fixture-corp', agentId: '123', appSecret: 'fixture-secret' },
        }),
      }
      const deliveries = new MessageDeliveryService(
        prisma,
        settings,
        integrations as never,
        new WeComClient(config as never),
        undefined,
        undefined,
        undefined,
        store,
      )
      const templates = new MessageTemplateService(prisma)
      const business = new BusinessNotificationsService(
        prisma,
        notifications,
        settings,
        deliveries,
        templates,
      )
      const outbox = new ExternalEventNotificationOutboxService(
        prisma,
        business,
        settings,
        notifications,
        deliveries,
        store,
      )
      const consumer = new NotificationAggregationConsumer(prisma, store, notifications, deliveries)
      const systemRows = () => orm.Notifications.where({ tenantId }).all()
      const deliveryRows = () => orm.MessageDeliveries.where({ tenantId }).all()
      const batches = () => orm.NotificationBatch.where({ tenantId }).all()
      const waitSealed = async () => {
        const until = Date.now() + 9000
        while (Date.now() < until) {
          await consumer.drain()
          if ((await batches()).every((row) => row.sealedAt)) return
          await sleep(50)
        }
        throw Error('Unsealed fixture batches')
      }
      const waitSent = async () => {
        const until = Date.now() + 4000
        while (Date.now() < until) {
          const rows = await deliveryRows()
          if (rows.every((row) => row.status === 'SUCCEEDED' || row.status === 'DEAD')) return
          await sleep(25)
        }
        throw Error('Pending fixture deliveries')
      }
      await align()
      const intents = Array.from({ length: 5 }, (_, i) => [
        ...externalEventNotificationIntent(
          { tenantId, operatorId, inboxId: uid() },
          'CLUE_ADD',
          recipientId,
          'private-fixture-' + i,
          'lead-' + i,
        ),
        ...externalEventNotificationIntent(
          { tenantId, operatorId, inboxId: uid() },
          'CLUE_CONVERT_CUSTOMER',
          recipientId,
          'private-fixture-' + i,
          'customer-' + i,
        ),
        ...externalEventNotificationIntent(
          { tenantId, operatorId, inboxId: uid() },
          'CUSTOMER_ADD',
          recipientId,
          'private-fixture-' + i,
          'customer-' + i,
        ),
      ]).flat()
      await prisma.client.transaction((tx) => outbox.enqueue(tx, intents))
      await Promise.all([
        outbox.drain(),
        new ExternalEventNotificationOutboxService(
          prisma,
          business,
          settings,
          notifications,
          deliveries,
          store,
        ).drain(),
      ])
      assert.equal((await orm.ExternalEventNotification.where({ tenantId }).all()).length, 0)
      const before = await batches()
      assert.equal(
        before.reduce((sum, row) => sum + row.itemCount, 0),
        30,
      )
      assert.equal(before.length, 4)
      assert.equal((await systemRows()).length, 0)
      assert.equal((await deliveryRows()).length, 0)
      assert.equal(sse.length, 0)
      // Turning off new admission must not strand previously accepted batches.
      process.env.CRM_NOTIFICATION_AGGREGATION = '0'
      await waitSealed()
      await waitSent()
      assert.equal((await systemRows()).length, 2)
      assert.equal((await deliveryRows()).length, 2)
      assert.equal(posts.length, 2)
      assert.equal(tokenCalls, 1)
      assert.equal(sse.length, 2)
      assert.equal((await notifications.unreadCount(tenantId, recipientId)).count, 2)
      const visible = await notifications.list(tenantId, recipientId, 1, 10, true)
      assert.equal(visible.total, 2)
      await notifications.markRead(tenantId, operatorId, visible.items[0]!.id)
      assert.equal((await notifications.unreadCount(tenantId, recipientId)).count, 2)
      await notifications.markRead(tenantId, recipientId, visible.items[0]!.id)
      assert.equal((await notifications.unreadCount(tenantId, recipientId)).count, 1)

      assert.ok(
        (await systemRows()).every(
          (row) => row.content?.includes('条通知') && !row.content.includes('private-fixture'),
        ),
      )
      assert.ok(
        posts.every((body) => body.msgtype === 'textcard' && body.touser === 'fixture-member'),
      )
      assert.ok(
        posts.every((body) => {
          const card = body.textcard as { description: string; url: string }
          return (
            Buffer.byteLength(card.description, 'utf8') <= 512 &&
            new URL(card.url).searchParams
              .get('target')
              ?.startsWith('/mobile/mine/message/batch?id=')
          )
        }),
      )
      process.env.CRM_NOTIFICATION_AGGREGATION = '1'
      // WeCom only: system switch stays off; single-item preserves original.
      await orm.MessageTaskSettings.where({ tenantId, event: 'CUSTOMER_ADD' }).update({
        systemEnabled: false,
      })
      await align()
      await business.send({
        tenantId,
        operatorId,
        recipientIds: [recipientId],
        event: 'CUSTOMER_ADD',
        type: 'system',
        title: 'single fixture',
        content: 'original content',
        link: '/customers?id=fixture-single',
      })
      await waitSealed()
      await waitSent()
      assert.equal((await systemRows()).length, 2)
      const single = (await deliveryRows()).find((row) => row.title === 'single fixture')
      assert.equal(single?.link, '/customers?id=fixture-single')
      assert.equal(single?.content, 'original content')
      assert.equal(posts.length, 3)
      // Direct notifications + important @ mention remain separately handled.
      await align()
      await notifications.notify(tenantId, recipientId, {
        event: 'CLUE_ADD',
        type: 'assign',
        title: 'direct fixture',
        link: '/leads?id=direct',
      })
      await business.send({
        tenantId,
        operatorId,
        recipientIds: [recipientId],
        event: 'CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED',
        type: 'follow_record_comment',
        title: 'mention fixture',
      })
      await waitSent()
      assert.equal((await systemRows()).filter((row) => row.title === 'mention fixture').length, 1)
      assert.equal((await systemRows()).filter((row) => row.title === 'direct fixture').length, 0)
      // Revoke mapping after durable admission, before sending.
      await business.send({
        tenantId,
        operatorId,
        recipientIds: [recipientId],
        event: 'CLUE_ADD',
        type: 'assign',
        title: 'mapping fixture',
        link: '/leads?id=map',
      })
      await orm.ExternalUserMappings.where({ tenantId, userId: recipientId }).update({
        active: false,
      })
      await waitSealed()
      await waitSent()
      assert.equal(posts.length, 4)
      assert.equal(
        (await deliveryRows()).find((row) => row.title === 'mapping fixture')?.status,
        'DEAD',
      )
      assert.ok(
        (await systemRows()).some(
          (row) => row.title === 'direct fixture' || row.content?.includes('共 2 条通知'),
        ),
      )
      // System only; no WeCom candidate. Credentials revoked after admission
      // are rejected before HTTP even if the integration is otherwise available.
      await orm.ExternalUserMappings.where({ tenantId, userId: recipientId }).update({
        active: true,
      })
      await orm.MessageTaskSettings.where({ tenantId, event: 'CLUE_ADD' }).update({
        weComEnabled: false,
      })
      await align()
      await business.send({
        tenantId,
        operatorId,
        recipientIds: [recipientId],
        event: 'CLUE_ADD',
        type: 'assign',
        title: 'system-only fixture',
      })
      await waitSealed()
      assert.ok((await systemRows()).some((row) => row.title === 'system-only fixture'))
      assert.ok(!(await deliveryRows()).some((row) => row.title === 'system-only fixture'))
      await orm.MessageTaskSettings.where({ tenantId, event: 'CLUE_ADD' }).update({
        weComEnabled: true,
      })
      await align()
      await business.send({
        tenantId,
        operatorId,
        recipientIds: [recipientId],
        event: 'CLUE_ADD',
        type: 'assign',
        title: 'rotated fixture',
      })
      await orm.EnterpriseIntegrations.where({ id: integration.id }).update({
        credentialVersion: integration.credentialVersion + 1,
      })
      await waitSealed()
      await waitSent()
      assert.equal(
        (await deliveryRows()).find((row) => row.title === 'rotated fixture')?.status,
        'DEAD',
      )
      assert.equal(posts.length, 4)
      console.log(
        'Aggregation runtime real PG: 15 intents / 30 channel items -> 2 notifications, 2 mocked WeCom requests, 2 SSE events; channel-only, singleton, mention and mapping revocation passed.',
      )
    } finally {
      subscription.unsubscribe()
    }
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.CRM_NOTIFICATION_AGGREGATION
    await orm.ExternalEventNotification.where({ tenantId }).deleteAll()
    await orm.NotificationBatch.where({ tenantId }).deleteAll()
    await orm.Notifications.where({ tenantId }).deleteAll()
    await orm.MessageDeliveries.where({ tenantId }).deleteAll()
    await orm.ExternalUserMappings.where({ tenantId }).deleteAll()
    await orm.EnterpriseIntegrations.where({ tenantId }).deleteAll()
    await orm.Users.where({ tenantId }).deleteAll()
    await orm.Tenants.where({ id: tenantId }).deleteAll()
    await prisma.onModuleDestroy()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
