import assert from 'node:assert/strict'
import test from 'node:test'
import type { MessageDelivery } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { WeComClient, WeComMessageResult } from '../enterprise-integrations/wecom.client'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import { MessageDeliveryService } from './message-delivery.service'

function delivery(id: string, externalSubject: string | null): MessageDelivery {
  const now = new Date()
  return {
    id,
    tenantId: 'tenant-a',
    integrationId: 'integration-a',
    channel: 'WECOM',
    event: 'CUSTOMER_ADD',
    userId: 'user-a',
    externalSubject,
    title: '新客户已分配',
    content: '客户：示例公司',
    link: '/customers/customer-a',
    status: 'PENDING',
    attempts: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    sentAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function createWorker(result: WeComMessageResult) {
  const rows = new Map<string, MessageDelivery>()
  const messageDelivery = {
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: string }
      data: Record<string, unknown>
    }) => {
      const row = where.id ? rows.get(where.id) : undefined
      if (!row || !['PENDING', 'FAILED'].includes(row.status)) return { count: 0 }
      Object.assign(row, data, {
        attempts:
          typeof data['attempts'] === 'object' && data['attempts']
            ? row.attempts + 1
            : row.attempts,
        updatedAt: new Date(),
      })
      return { count: 1 }
    },
    findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<MessageDelivery> }) => {
      const row = rows.get(where.id)
      assert.ok(row)
      Object.assign(row, data, { updatedAt: new Date() })
      return row
    },
  }
  const prisma = { messageDelivery } as unknown as PrismaService
  const settings = {} as MessageSettingsService
  const integrations = {
    getWeComRuntimeContext: async () => ({
      integration: { id: 'integration-a' },
      credentials: { corpId: 'ww-a', agentId: '1000001', appSecret: 'secret' },
    }),
  } as unknown as EnterpriseIntegrationsService
  const client = { sendTextMessage: async () => result } as unknown as WeComClient
  return {
    rows,
    service: new MessageDeliveryService(prisma, settings, integrations, client),
  }
}

test('企微 outbox 对缺失成员映射保留 DEAD 审计', async () => {
  const rows: MessageDelivery[] = []
  const prisma = {
    enterpriseIntegration: { findUnique: async () => ({ id: 'integration-a' }) },
    externalUserMapping: { findMany: async () => [] },
    messageDelivery: {
      create: async ({ data }: { data: Partial<MessageDelivery> }) => {
        const row = { ...delivery(`delivery-${rows.length + 1}`, null), ...data }
        rows.push(row)
        return row
      },
    },
    $transaction: async (operations: Array<Promise<MessageDelivery>>) => Promise.all(operations),
  } as unknown as PrismaService
  const settings = {
    isWeComEnabled: async () => true,
    getWeComChannelGate: async () => ({ available: true }),
  } as unknown as MessageSettingsService
  const service = new MessageDeliveryService(
    prisma,
    settings,
    {} as EnterpriseIntegrationsService,
    {} as WeComClient,
  )

  const count = await service.enqueue({
    tenantId: 'tenant-a',
    event: 'CUSTOMER_ADD',
    recipientIds: ['user-a'],
    title: '新客户已分配',
  })

  assert.equal(count, 1)
  assert.equal(rows[0]?.status, 'DEAD')
  assert.equal(rows[0]?.errorCode, 'EXTERNAL_USER_NOT_MAPPED')
})

test('企微 outbox 条件认领并记录成功或退避结果', async (t) => {
  await t.test('发送成功进入 SUCCEEDED 并保留 provider msgid', async () => {
    const { rows, service } = createWorker({
      success: true,
      transient: false,
      providerCode: 0,
      providerMessageId: 'message-1',
      message: 'ok',
    })
    rows.set('success', delivery('success', 'zhangsan'))
    await service.processIds(['success', 'success'])
    const row = rows.get('success')
    assert.equal(row?.status, 'SUCCEEDED')
    assert.equal(row?.attempts, 1)
    assert.equal(row?.providerMessageId, 'message-1')
  })

  await t.test('临时错误进入 FAILED 并安排下一次重试', async () => {
    const { rows, service } = createWorker({
      success: false,
      transient: true,
      providerCode: 45009,
      providerMessageId: null,
      message: 'api freq out of limit',
    })
    rows.set('retry', delivery('retry', 'zhangsan'))
    await service.processIds(['retry'])
    const row = rows.get('retry')
    assert.equal(row?.status, 'FAILED')
    assert.equal(row?.attempts, 1)
    assert.ok(row?.nextAttemptAt instanceof Date)
    assert.equal(row?.errorCode, 'WECOM_45009')
  })
})
