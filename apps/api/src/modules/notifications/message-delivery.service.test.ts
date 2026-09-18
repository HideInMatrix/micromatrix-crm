import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import type {
  DingTalkClient,
  DingTalkMessageResult,
} from '../enterprise-integrations/dingtalk.client'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { LarkClient, LarkMessageResult } from '../enterprise-integrations/lark.client'
import type { WeComClient, WeComMessageResult } from '../enterprise-integrations/wecom.client'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import { MessageDeliveryService } from './message-delivery.service'

interface MessageDelivery {
  id: string
  tenantId: string
  integrationId: string
  channel: 'WECOM' | 'DINGTALK' | 'LARK' | 'EMAIL'
  event: string
  userId: string
  externalSubject: string | null
  title: string
  content: string
  link: string | null
  status: 'PENDING' | 'SENDING' | 'SUCCEEDED' | 'FAILED' | 'DEAD'
  attempts: number
  maxAttempts: number
  nextAttemptAt: Date | null
  providerMessageId: string | null
  errorCode: string | null
  errorMessage: string | null
  sentAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function delivery(
  id: string,
  externalSubject: string | null,
  channel: 'WECOM' | 'DINGTALK' | 'LARK' = 'WECOM',
): MessageDelivery {
  const now = new Date()
  return {
    id,
    tenantId: 'tenant-a',
    integrationId: 'integration-a',
    channel,
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

function outbox(
  rows: MessageDelivery[],
  integrationForChannel: (channel: string) => { id: string } | null = () => ({
    id: 'integration-a',
  }),
  mappings: Array<{ userId: string; externalId: string }> = [],
): PrismaService {
  const messageDeliveries = {
    createAll: async (data: Array<Partial<MessageDelivery>>) =>
      data.map((item) => {
        const channel = (item.channel ?? 'WECOM') as 'WECOM' | 'DINGTALK' | 'LARK'
        const row = {
          ...delivery(`delivery-${rows.length + 1}`, item.externalSubject ?? null, channel),
          ...item,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as MessageDelivery
        rows.push(row)
        return row
      }),
  }
  const externalMappings = {
    where: () => externalMappings,
    select: () => externalMappings,
    all: async () => mappings,
  }
  return {
    client: {
      orm: {
        public: {
          EnterpriseIntegrations: {
            where: ({ provider }: { provider: string }) => ({
              select: () => ({ first: async () => integrationForChannel(provider) }),
            }),
          },
          ExternalUserMappings: externalMappings,
          MessageDeliveries: messageDeliveries,
        },
      },
      transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ orm: { public: { MessageDeliveries: messageDeliveries } } }),
    },
  } as unknown as PrismaService
}

function workerRows(rows: Map<string, MessageDelivery>): PrismaService {
  const collection = (id?: string) => ({
    where(input: { id?: string }) {
      return collection(input.id ?? id)
    },
    select() {
      return this
    },
    first: async () => (id ? (rows.get(id) ?? null) : null),
  })
  return {
    client: { orm: { public: { MessageDeliveries: collection() } } },
  } as unknown as PrismaService
}

function installWorkerClaim(
  service: MessageDeliveryService,
  rows: Map<string, MessageDelivery>,
): MessageDeliveryService {
  const internals = service as unknown as {
    claimDelivery(id: string): Promise<boolean>
    completeDelivery(id: string, providerMessageId: string | null): Promise<void>
    fail(
      delivery: MessageDelivery,
      errorCode: string,
      errorMessage: string,
      transient: boolean,
    ): Promise<void>
  }
  internals.claimDelivery = async (id: string) => {
    const row = rows.get(id)
    if (!row || !['PENDING', 'FAILED'].includes(row.status)) return false
    if (row.nextAttemptAt && row.nextAttemptAt.getTime() > Date.now()) return false
    row.status = 'SENDING'
    row.attempts += 1
    row.nextAttemptAt = null
    row.errorCode = null
    row.errorMessage = null
    row.updatedAt = new Date()
    return true
  }
  internals.completeDelivery = async (id: string, providerMessageId: string | null) => {
    const row = rows.get(id)
    assert.ok(row)
    row.status = 'SUCCEEDED'
    row.providerMessageId = providerMessageId
    row.sentAt = new Date()
    row.errorCode = null
    row.errorMessage = null
    row.updatedAt = new Date()
  }
  internals.fail = async (
    failedDelivery: MessageDelivery,
    errorCode: string,
    errorMessage: string,
    transient: boolean,
  ) => {
    const row = rows.get(failedDelivery.id)
    assert.ok(row)
    const retryable = transient && failedDelivery.attempts < failedDelivery.maxAttempts
    const delays = [60_000, 5 * 60_000, 15 * 60_000]
    const delay = delays[Math.max(0, failedDelivery.attempts - 1)] ?? delays.at(-1)!
    row.status = retryable ? 'FAILED' : 'DEAD'
    row.nextAttemptAt = retryable ? new Date(Date.now() + delay) : null
    row.errorCode = errorCode.slice(0, 100)
    row.errorMessage = errorMessage.slice(0, 500)
    row.updatedAt = new Date()
  }
  return service
}

function createWorker(result: WeComMessageResult) {
  const rows = new Map<string, MessageDelivery>()
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
    service: installWorkerClaim(
      new MessageDeliveryService(workerRows(rows), settings, integrations, client),
      rows,
    ),
  }
}

test('消息投递 Cron 通过 Prisma 恢复超时 SENDING，并保持 due 扫描边界', async () => {
  const whereCalls: unknown[] = []
  let updateData: Record<string, unknown> | undefined
  let processedIds: string[] = []
  let phase: 'recover' | 'due' = 'recover'
  let selected: string[] = []
  let orderByCalled = false
  let limitValue: number | undefined
  const collection = {
    where(input: unknown) {
      if (typeof input === 'function') {
        if (phase === 'recover') {
          whereCalls.push(
            input({
              channel: {
                in: (values: unknown[]) => ({ op: 'in', field: 'channel', values }),
              },
              updatedAt: {
                lt: (value: unknown) => ({ op: 'lt', field: 'updatedAt', value }),
              },
            }),
          )
        } else {
          whereCalls.push({ phase: 'due', callback: true })
        }
      } else {
        whereCalls.push(input)
      }
      return collection
    },
    async updateAll(data: Record<string, unknown>) {
      updateData = data
      phase = 'due'
      return []
    },
    select(...fields: string[]) {
      selected = fields
      return collection
    },
    orderBy(_input: unknown) {
      orderByCalled = true
      return collection
    },
    limit(value: number) {
      limitValue = value
      return collection
    },
    async all() {
      return [{ id: 'due-1' }]
    },
  }
  const prisma = {
    client: { orm: { public: { MessageDeliveries: collection } } },
  } as unknown as PrismaService
  const service = new MessageDeliveryService(
    prisma,
    {} as MessageSettingsService,
    {} as EnterpriseIntegrationsService,
    {} as WeComClient,
  )
  service.processIds = async (ids) => {
    processedIds = ids
  }

  const count = await service.processDueDeliveries()

  assert.equal(count, 1)
  assert.deepEqual(whereCalls[0], { status: 'SENDING' })
  assert.deepEqual(whereCalls[1], {
    op: 'in',
    field: 'channel',
    values: ['WECOM', 'DINGTALK', 'LARK'],
  })
  assert.equal((whereCalls[2] as { op?: string }).op, 'lt')
  assert.equal((whereCalls[2] as { field?: string }).field, 'updatedAt')
  assert.equal(updateData?.['status'], 'FAILED')
  assert.equal(updateData?.['errorCode'], 'WORKER_TIMEOUT')
  assert.equal(updateData?.['errorMessage'], '投递处理超时，已恢复等待重试')
  assert.ok(updateData?.['nextAttemptAt'])
  assert.equal(updateData?.['nextAttemptAt'], updateData?.['updatedAt'])
  assert.deepEqual(whereCalls.slice(3), [
    { phase: 'due', callback: true },
    { phase: 'due', callback: true },
    { phase: 'due', callback: true },
  ])
  assert.deepEqual(selected, ['id'])
  assert.equal(orderByCalled, true)
  assert.equal(limitValue, 50)
  assert.deepEqual(processedIds, ['due-1'])
})

test('企微 outbox 对缺失成员映射保留 DEAD 审计', async () => {
  const rows: MessageDelivery[] = []
  const settings = {
    isWeComEnabled: async () => true,
    isDingTalkEnabled: async () => false,
    isLarkEnabled: async () => false,
    getWeComChannelGate: async () => ({ available: true }),
  } as unknown as MessageSettingsService
  const service = new MessageDeliveryService(
    outbox(rows, () => ({ id: 'integration-a' }), []),
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

test('钉钉 outbox 使用独立 channel、成员映射与 Provider 状态机', async (t) => {
  await t.test('只开启钉钉时生成 DINGTALK 投递记录', async () => {
    const rows: MessageDelivery[] = []
    const settings = {
      isWeComEnabled: async () => false,
      isDingTalkEnabled: async () => true,
      isLarkEnabled: async () => false,
      getDingTalkChannelGate: async () => ({ available: true }),
    } as unknown as MessageSettingsService
    const service = new MessageDeliveryService(
      outbox(rows, (channel) => (channel === 'DINGTALK' ? { id: 'ding-integration' } : null), [
        { userId: 'user-a', externalId: 'ding-user-a' },
      ]),
      settings,
      {} as EnterpriseIntegrationsService,
      {} as WeComClient,
    )
    service.processIds = async () => undefined
    const count = await service.enqueue({
      tenantId: 'tenant-a',
      event: 'CUSTOMER_ADD',
      recipientIds: ['user-a'],
      title: '新客户已分配',
    })
    assert.equal(count, 1)
    assert.equal(rows[0]?.channel, 'DINGTALK')
    assert.equal(rows[0]?.externalSubject, 'ding-user-a')
  })

  function createDingTalkWorker(result: DingTalkMessageResult) {
    const rows = new Map<string, MessageDelivery>()
    const integrations = {
      getDingTalkRuntimeContext: async () => ({
        integration: { id: 'integration-a' },
        credentials: {
          corpId: 'ding-corp',
          clientId: 'app-key',
          agentId: '10001',
          appSecret: 'secret',
        },
      }),
    } as unknown as EnterpriseIntegrationsService
    const client = { sendTextMessage: async () => result } as unknown as DingTalkClient
    return {
      rows,
      service: installWorkerClaim(
        new MessageDeliveryService(
          workerRows(rows),
          {} as MessageSettingsService,
          integrations,
          {} as WeComClient,
          undefined,
          client,
        ),
        rows,
      ),
    }
  }

  await t.test('发送成功记录 task_id', async () => {
    const { rows, service } = createDingTalkWorker({
      success: true,
      transient: false,
      providerCode: 0,
      providerMessageId: '9988',
      message: 'ok',
    })
    rows.set('success', delivery('success', 'ding-user', 'DINGTALK'))
    await service.processIds(['success'])
    assert.equal(rows.get('success')?.status, 'SUCCEEDED')
    assert.equal(rows.get('success')?.providerMessageId, '9988')
  })

  await t.test('临时错误进入 FAILED 并使用 DINGTALK 错误码', async () => {
    const { rows, service } = createDingTalkWorker({
      success: false,
      transient: true,
      providerCode: 88,
      providerMessageId: null,
      message: 'system busy',
    })
    rows.set('retry', delivery('retry', 'ding-user', 'DINGTALK'))
    await service.processIds(['retry'])
    assert.equal(rows.get('retry')?.status, 'FAILED')
    assert.equal(rows.get('retry')?.errorCode, 'DINGTALK_88')
    assert.ok(rows.get('retry')?.nextAttemptAt instanceof Date)
  })
})

test('飞书 outbox 使用 LARK channel、open_id 映射与 message_id 状态机', async (t) => {
  await t.test('只开启飞书时生成 LARK 投递记录', async () => {
    const rows: MessageDelivery[] = []
    const settings = {
      isWeComEnabled: async () => false,
      isDingTalkEnabled: async () => false,
      isLarkEnabled: async () => true,
      getLarkChannelGate: async () => ({ available: true }),
    } as unknown as MessageSettingsService
    const service = new MessageDeliveryService(
      outbox(rows, (channel) => (channel === 'LARK' ? { id: 'lark-integration' } : null), [
        { userId: 'user-a', externalId: 'ou_user_a' },
      ]),
      settings,
      {} as EnterpriseIntegrationsService,
      {} as WeComClient,
    )
    service.processIds = async () => undefined
    const count = await service.enqueue({
      tenantId: 'tenant-a',
      event: 'CUSTOMER_ADD',
      recipientIds: ['user-a'],
      title: '新客户已分配',
    })
    assert.equal(count, 1)
    assert.equal(rows[0]?.channel, 'LARK')
    assert.equal(rows[0]?.externalSubject, 'ou_user_a')
  })

  function createLarkWorker(result: LarkMessageResult) {
    const rows = new Map<string, MessageDelivery>()
    const integrations = {
      getLarkRuntimeContext: async () => ({
        integration: { id: 'integration-a' },
        credentials: {
          corpId: 'tenant-key',
          agentId: 'cli_aabbcc',
          appSecret: 'secret',
          redirectUrl: 'https://crm.example.com/login/lark/callback',
        },
      }),
    } as unknown as EnterpriseIntegrationsService
    const client = { sendTextMessage: async () => result } as unknown as LarkClient
    return {
      rows,
      service: installWorkerClaim(
        new MessageDeliveryService(
          workerRows(rows),
          {} as MessageSettingsService,
          integrations,
          {} as WeComClient,
          undefined,
          undefined,
          client,
        ),
        rows,
      ),
    }
  }

  await t.test('发送成功记录 message_id', async () => {
    const { rows, service } = createLarkWorker({
      success: true,
      transient: false,
      providerCode: 0,
      providerMessageId: 'om_message_1',
      message: 'ok',
    })
    rows.set('success', delivery('success', 'ou_user_a', 'LARK'))
    await service.processIds(['success'])
    assert.equal(rows.get('success')?.status, 'SUCCEEDED')
    assert.equal(rows.get('success')?.providerMessageId, 'om_message_1')
  })

  await t.test('临时错误进入 FAILED 并使用 LARK 错误码', async () => {
    const { rows, service } = createLarkWorker({
      success: false,
      transient: true,
      providerCode: 99991400,
      providerMessageId: null,
      message: 'system busy',
    })
    rows.set('retry', delivery('retry', 'ou_user_a', 'LARK'))
    await service.processIds(['retry'])
    assert.equal(rows.get('retry')?.status, 'FAILED')
    assert.equal(rows.get('retry')?.errorCode, 'LARK_99991400')
    assert.ok(rows.get('retry')?.nextAttemptAt instanceof Date)
  })
})
