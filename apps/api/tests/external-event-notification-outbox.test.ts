import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  externalEventNotificationIntent,
  externalEventNotificationInput,
} from '../src/modules/notifications/external-event-notification-intent'

// Require an explicitly supplied disposable local database. Never use the default .env DB.
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant, instantFromEpochMilliseconds } = await import('../src/prisma/temporal')
  const { ExternalEventNotificationOutboxService } =
    await import('../src/modules/notifications/external-event-notification-outbox.service')
  const { MessageSettingsService } =
    await import('../src/modules/message-settings/message-settings.service')
  const { MessageTemplateService } =
    await import('../src/modules/notifications/message-template.service')
  const { NotificationsService } =
    await import('../src/modules/notifications/notifications.service')
  const { MessageDeliveryService } =
    await import('../src/modules/notifications/message-delivery.service')
  const { BusinessNotificationsService } =
    await import('../src/modules/notifications/business-notifications.service')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const tenantId = randomUUID().replaceAll('-', '')
  const operatorId = randomUUID().replaceAll('-', '')
  const recipientId = randomUUID().replaceAll('-', '')
  const now = nowInstant()
  const context = { tenantId, operatorId, inboxId: randomUUID() }
  const create = externalEventNotificationIntent(
    context,
    'CLUE_ADD',
    recipientId,
    'test student',
    'lead-id',
  )
  const conversionContext = { ...context, inboxId: randomUUID() }
  const convert = [
    ...externalEventNotificationIntent(
      conversionContext,
      'CUSTOMER_ADD',
      recipientId,
      'test student',
      'customer-id',
    ),
    ...externalEventNotificationIntent(
      conversionContext,
      'CLUE_CONVERT_CUSTOMER',
      recipientId,
      'test student',
      'customer-id',
    ),
  ]
  assert.equal(externalEventNotificationInput(create[0]!).type, 'assign')
  assert.equal(externalEventNotificationInput(convert[0]!).type, 'system')
  assert.deepEqual(
    externalEventNotificationIntent(context, 'CLUE_ADD', operatorId, 'self', 'lead'),
    [],
  )
  assert.deepEqual(
    externalEventNotificationIntent(context, 'CLUE_ADD', null, 'unassigned', 'lead'),
    [],
  )
  try {
    await orm.Tenants.create({ id: tenantId, name: 'Outbox test', slug: tenantId, updatedAt: now })
    await orm.Users.createAll(
      [operatorId, recipientId].map((id) => ({
        id,
        tenantId,
        name: id === operatorId ? 'Operator' : 'Recipient',
        passwordHash: 'unused-test-fixture',
        updatedAt: now,
      })),
    )
    await orm.EnterpriseIntegrations.create({
      tenantId,
      provider: 'WECOM',
      corpId: 'fixture',
      agentId: 'fixture',
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
      externalId: 'fixture-user',
      externalKey: 'fixture-user',
      updatedAt: now,
    })
    await orm.MessageTaskSettings.createAll(
      [
        { event: 'CLUE_ADD', module: 'CLUE' },
        { event: 'CUSTOMER_ADD', module: 'CUSTOMER' },
        { event: 'CLUE_CONVERT_CUSTOMER', module: 'CLUE' },
      ].map((row) => ({
        ...row,
        tenantId,
        systemEnabled: true,
        weComEnabled: true,
        updatedAt: now,
      })),
    )

    const settings = new MessageSettingsService(prisma)
    const notifications = new NotificationsService(prisma, settings)
    const templates = new MessageTemplateService(prisma)
    const deliveries = new MessageDeliveryService(prisma, settings, {} as never, {} as never)
    const kicked: string[] = []
    const published: string[] = []
    deliveries.processIds = async (ids) => {
      kicked.push(...ids)
      return ids.length
    }
    notifications.publishCreated = async (_tenant, _user, row) => {
      published.push(row.id)
    }
    const business = new BusinessNotificationsService(
      prisma,
      notifications,
      settings,
      deliveries,
      templates,
    )
    const makeWorker = () =>
      new ExternalEventNotificationOutboxService(
        prisma,
        business,
        settings,
        notifications,
        deliveries,
      )
    const worker = makeWorker()
    const pending = () => orm.ExternalEventNotification.where({ tenantId }).all()
    const systemRows = () => orm.Notifications.where({ tenantId }).all()
    const deliveryRows = () => orm.MessageDeliveries.where({ tenantId }).all()

    // Enqueue belongs to the business transaction, not an independent transaction.
    await assert.rejects(
      prisma.client.transaction(async (tx) => {
        await worker.enqueue(tx, create)
        throw new Error('rollback')
      }),
      /rollback/,
    )
    assert.equal((await pending()).length, 0)
    await prisma.client.transaction((tx) => worker.enqueue(tx, [...create, ...convert]))
    assert.equal((await pending()).length, 3)
    assert.equal((await systemRows()).length, 0)
    assert.equal((await deliveryRows()).length, 0)
    // Two workers race for the same rows; both real PostgreSQL transactions cannot win.
    await Promise.all([worker.drain(), makeWorker().drain()])
    assert.equal((await pending()).length, 0)
    assert.equal((await systemRows()).length, 3)
    const rows = await deliveryRows()
    assert.equal(rows.length, 3)
    assert.deepEqual(
      new Set(rows.map((r) => r.event)),
      new Set(['CLUE_ADD', 'CUSTOMER_ADD', 'CLUE_CONVERT_CUSTOMER']),
    )
    assert.ok(rows.every((r) => r.status === 'PENDING' && r.channel === 'WECOM'))
    assert.equal(kicked.length, 3)
    assert.equal(published.length, 3)

    // Force a real DB FK failure after system notification insertion.
    const retry = externalEventNotificationIntent(
      { ...context, inboxId: randomUUID() },
      'CLUE_ADD',
      recipientId,
      'retry',
      'lead-retry',
    )
    await prisma.client.transaction((tx) => worker.enqueue(tx, retry))
    const prepareRecords = deliveries.prepareOutboxRecords.bind(deliveries)
    deliveries.prepareOutboxRecords = async (...args) =>
      (await prepareRecords(...args)).map((row) => ({ ...row, tenantId: 'does-not-exist' }))
    await worker.drain()
    const failed = await pending()
    assert.equal(failed.length, 1)
    assert.equal(failed[0]!.attempts, 1)
    assert.equal((await systemRows()).length, 3)
    assert.equal((await deliveryRows()).length, 3)
    assert.equal(published.length, 3)
    deliveries.prepareOutboxRecords = prepareRecords
    await orm.ExternalEventNotification.where({ id: failed[0]!.id }).update({
      nextAttemptAt: instantFromEpochMilliseconds(Date.now() - 1),
    })
    await makeWorker().drain()
    assert.equal((await pending()).length, 0)
    assert.equal((await systemRows()).length, 4)
    assert.equal((await deliveryRows()).length, 4)

    // Disabled settings and inactive recipients must still suppress messages.
    await orm.MessageTaskSettings.where({ tenantId, event: 'CLUE_ADD' }).updateAll({
      systemEnabled: false,
      weComEnabled: false,
    })
    await prisma.client.transaction((tx) =>
      worker.enqueue(
        tx,
        externalEventNotificationIntent(
          { ...context, inboxId: randomUUID() },
          'CLUE_ADD',
          recipientId,
          'disabled',
          'lead-disabled',
        ),
      ),
    )
    await worker.drain()
    assert.equal((await pending()).length, 0)
    assert.equal((await systemRows()).length, 4)
    assert.equal((await deliveryRows()).length, 4)
    await orm.MessageTaskSettings.where({ tenantId, event: 'CLUE_ADD' }).updateAll({
      systemEnabled: true,
      weComEnabled: true,
    })
    await orm.Users.where({ id: recipientId, tenantId }).update({ status: 'DISABLED' })
    await prisma.client.transaction((tx) =>
      worker.enqueue(
        tx,
        externalEventNotificationIntent(
          { ...context, inboxId: randomUUID() },
          'CLUE_ADD',
          recipientId,
          'inactive',
          'lead-inactive',
        ),
      ),
    )
    await worker.drain()
    assert.equal((await pending()).length, 0)
    assert.equal((await systemRows()).length, 4)
    assert.equal((await deliveryRows()).length, 4)
    console.log(
      'Real PostgreSQL outbox rollback, concurrent claim, channel settings, retry and notification deduplication tests passed; no provider requests sent.',
    )
  } finally {
    await orm.ExternalEventNotification.where({ tenantId }).deleteAndCount()
    await orm.Notifications.where({ tenantId }).deleteAndCount()
    await orm.MessageDeliveries.where({ tenantId }).deleteAndCount()
    await orm.ExternalUserMappings.where({ tenantId }).deleteAndCount()
    await orm.Users.where({ tenantId }).deleteAndCount()
    await orm.Tenants.where({ id: tenantId }).deleteAndCount()
    await prisma.onModuleDestroy()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
