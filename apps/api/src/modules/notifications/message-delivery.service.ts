import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { or } from '@prisma/orm-postgres/orm-client'
import {
  MESSAGE_TASK_DEFINITIONS,
  type MessageDeliveryStatus,
  type MessageLanguage,
  type NotificationBizType,
  type MessageDeliveryVO,
  type MessageTaskEvent,
} from '@micromatrix/shared'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import {
  nowInstant,
  instantFromEpochMilliseconds,
  instantFromDate,
  instantToISOString,
} from '../../prisma/temporal.js'
import { PrismaService } from '../../prisma.service.js'
import { DingTalkClient } from '../enterprise-integrations/dingtalk.client'
import { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import { LarkClient } from '../enterprise-integrations/lark.client'
import { WeComClient } from '../enterprise-integrations/wecom.client'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import type { QueryMessageDeliveriesDto } from './dto/message-delivery.dto'
import { randomUUID } from 'node:crypto'
import { NotificationAggregationStore } from './notification-aggregation.store'
import { aggregationEnabled, deliveryAggregationItem } from './notification-aggregation-runtime'
import { DeliveryExecutor } from './delivery-executor'
import { DeliveryPerformance, measureDelivery } from './delivery-performance'
import type { NotificationPreparationReads } from './notification-preparation-reads'

export interface EnqueueMessageInput {
  tenantId: string
  event: MessageTaskEvent
  recipientIds: string[]
  language?: MessageLanguage
  type?: NotificationBizType
  title: string
  content?: string
  link?: string
}

type SupportedDeliveryChannel = 'WECOM' | 'DINGTALK' | 'LARK'

type MessageDeliveryRow = {
  id: string
  tenantId: string
  integrationId: string | null
  channel: string
  event: string
  userId: string | null
  externalSubject: string | null
  title: string
  content: string | null
  link: string | null
  status: MessageDeliveryStatus
  attempts: number
  maxAttempts: number
  nextAttemptAt: ReturnType<typeof nowInstant> | null
  providerMessageId: string | null
  errorCode: string | null
  errorMessage: string | null
  sentAt: ReturnType<typeof nowInstant> | null
  createdAt: ReturnType<typeof nowInstant>
  updatedAt: ReturnType<typeof nowInstant>
}

type WorkerDelivery = {
  id: string
  tenantId: string
  integrationId: string | null
  channel: string
  userId: string | null
  externalSubject: string | null
  title: string
  content: string | null
  link: string | null
  attempts: number
  maxAttempts: number
}

const SUPPORTED_CHANNELS: SupportedDeliveryChannel[] = ['WECOM', 'DINGTALK', 'LARK']

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000]
const STALE_SENDING_MS = 5 * 60_000
const MAX_BATCH_SIZE = 50
const WORKER_CONCURRENCY = 5
const MAX_OUTSTANDING_DELIVERIES = 1_000

@Injectable()
export class MessageDeliveryService {
  private readonly logger = new Logger(MessageDeliveryService.name)
  private readonly executor = new DeliveryExecutor(
    (id) => this.processOne(id),
    WORKER_CONCURRENCY,
    MAX_OUTSTANDING_DELIVERIES,
  )
  private lastOverflowWarningAt = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageSettings: MessageSettingsService,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly weComClient: WeComClient,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
    @Optional() private readonly dingTalkClient?: DingTalkClient,
    @Optional() private readonly larkClient?: LarkClient,
    @Optional() private readonly aggregation?: NotificationAggregationStore,
  ) {}

  async enqueue(input: EnqueueMessageInput): Promise<number> {
    const results = await Promise.allSettled(
      SUPPORTED_CHANNELS.map((channel) => this.enqueueChannel(channel, input)),
    )
    let count = 0
    for (const [index, result] of results.entries()) {
      const channel = SUPPORTED_CHANNELS[index]!
      if (result.status === 'fulfilled') count += result.value
      else {
        this.logger.warn(
          `${this.channelName(channel)}消息入队失败: ${this.errorMessage(result.reason)}`,
        )
      }
    }
    return count
  }

  private async enqueueChannel(
    channel: SupportedDeliveryChannel,
    input: EnqueueMessageInput,
  ): Promise<number> {
    const rows = await this.prepareChannelRecords(channel, input)
    if (!rows.length) return 0
    const created = await this.prisma.client.transaction(async (tx) => {
      const immediate = []
      const aggregated = []
      for (const { aggregationCredentialVersion, ...row } of rows) {
        const item =
          this.aggregation && aggregationEnabled()
            ? deliveryAggregationItem(row, aggregationCredentialVersion, {
                intentId: randomUUID(),
                event: input.event,
                type: input.type ?? 'system',
                language: input.language ?? 'zh-CN',
                occurredAt: row.updatedAt,
              })
            : null
        if (item)
          aggregated.push({ ...item, title: input.title, content: input.content, link: input.link })
        else immediate.push(row)
      }
      if (aggregated.length) await this.aggregation!.appendMany(tx, aggregated)
      return immediate.length ? tx.orm.public.MessageDeliveries.createAll(immediate) : []
    })
    const pendingIds = created.filter((item) => item.status === 'PENDING').map((item) => item.id)
    if (pendingIds.length > 0) {
      void this.processIds(pendingIds).catch((error) =>
        this.logger.warn(
          `${this.channelName(channel)}投递即时处理失败: ${this.errorMessage(error)}`,
        ),
      )
    }
    return rows.length
  }

  /** Resolve channel settings once per intent; errors propagate to the durable retry worker. */
  async prepareOutboxRecords(
    input: EnqueueMessageInput,
    setting: {
      weComEnabled: boolean
      dingTalkEnabled: boolean
      larkEnabled: boolean
    },
    reads?: NotificationPreparationReads,
  ) {
    const enabled = {
      WECOM: setting.weComEnabled,
      DINGTALK: setting.dingTalkEnabled,
      LARK: setting.larkEnabled,
    }
    const rows = await Promise.all(
      SUPPORTED_CHANNELS.map((channel) =>
        this.prepareChannelRecords(channel, input, enabled[channel], reads),
      ),
    )
    return rows.flat()
  }

  private async prepareChannelRecords(
    channel: SupportedDeliveryChannel,
    input: EnqueueMessageInput,
    enabledOverride?: boolean,
    reads?: NotificationPreparationReads,
  ) {
    const enabled =
      enabledOverride ??
      (channel === 'DINGTALK'
        ? await this.messageSettings.isDingTalkEnabled(input.tenantId, input.event)
        : channel === 'LARK'
          ? await this.messageSettings.isLarkEnabled(input.tenantId, input.event)
          : await this.messageSettings.isWeComEnabled(input.tenantId, input.event))
    if (!enabled) return []
    const loadGate = () => this.messageSettings.getDeliveryChannelGate(input.tenantId, channel)
    const { gate, integrationId, credentialVersion } = await (reads
      ? reads.read(['gate', input.tenantId, channel], loadGate)
      : loadGate())
    if (!gate.available || !integrationId) return []

    const userIds = [...new Set(input.recipientIds)]
    if (userIds.length === 0) return []
    const loadMappings = async () =>
      this.prisma.client.orm.public.ExternalUserMappings.where({
        tenantId: input.tenantId,
        provider: channel,
        active: true,
      })
        .where((mapping) => mapping.userId.in(userIds))
        .select('userId', 'externalId')
        .all()
    const mappings = await (reads
      ? reads.read(['mapping', input.tenantId, channel, ...userIds.slice().sort()], loadMappings)
      : loadMappings())
    const mappingByUser = new Map(mappings.map((mapping) => [mapping.userId, mapping]))
    const updatedAt = nowInstant()
    return userIds.map((userId) => {
      const mapping = mappingByUser.get(userId)
      return {
        tenantId: input.tenantId,
        integrationId,
        aggregationCredentialVersion: credentialVersion,
        channel,
        event: input.event,
        userId,
        externalSubject: mapping?.externalId ?? null,
        title: input.title.slice(0, 500),
        content: input.content?.slice(0, 4_000) ?? null,
        link: input.link?.slice(0, 1_000) ?? null,
        status: mapping ? ('PENDING' as const) : ('DEAD' as const),
        errorCode: mapping ? null : 'EXTERNAL_USER_NOT_MAPPED',
        errorMessage: mapping ? null : `接收人没有有效的${this.channelName(channel)}成员映射`,
        updatedAt,
      }
    })
  }

  async list(tenantId: string, query: QueryMessageDeliveriesDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const keyword = query.keyword?.trim()
    const matchingUsers = keyword
      ? await this.prisma.client.orm.public.Users.where({ tenantId })
          .where((user) => user.name.ilike(`%${keyword}%`))
          .select('id')
          .all()
      : []
    const scoped = this.prisma.client.orm.public.MessageDeliveries.where({
      tenantId,
      channel: query.channel ?? 'WECOM',
      ...(query.status ? { status: query.status } : {}),
      ...(query.event ? { event: query.event } : {}),
    })
    const filtered = keyword
      ? scoped.where((delivery) =>
          or(
            delivery.title.ilike(`%${keyword}%`),
            delivery.externalSubject.ilike(`%${keyword}%`),
            delivery.errorMessage.ilike(`%${keyword}%`),
            ...(matchingUsers.length
              ? [delivery.userId.in(matchingUsers.map((user) => user.id))]
              : []),
          ),
        )
      : scoped
    const [items, aggregate] = await Promise.all([
      filtered
        .orderBy((delivery) => delivery.createdAt.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      filtered.aggregate((agg) => ({ total: agg.count() })),
    ])
    const names = await this.userNames(
      tenantId,
      items.map((item) => item.userId),
    )
    return {
      items: items.map((item) =>
        this.toVO(item, item.userId ? (names.get(item.userId) ?? null) : null),
      ),
      total: aggregate.total,
      page,
      pageSize,
    }
  }

  async retry(tenantId: string, id: string): Promise<MessageDeliveryVO> {
    const delivery = await this.prisma.client.orm.public.MessageDeliveries.where({
      id,
      tenantId,
    }).first()
    if (!delivery) throw new NotFoundException('投递记录不存在')
    if (!this.isSupportedChannel(delivery.channel)) {
      throw new BadRequestException('当前投递渠道暂不支持手工重试')
    }
    const channel = delivery.channel
    if (!['FAILED', 'DEAD'].includes(delivery.status)) {
      throw new BadRequestException('只有失败或已终止的投递可以重试')
    }
    const updated = await this.prisma.client.orm.public.MessageDeliveries.where({
      id,
      tenantId,
    }).update({
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: null,
      errorCode: null,
      errorMessage: null,
      providerMessageId: null,
      sentAt: null,
      updatedAt: nowInstant(),
    })
    if (!updated) throw new NotFoundException('投递记录不存在')
    const names = await this.userNames(tenantId, [updated.userId])
    void this.processIds([id]).catch((error) =>
      this.logger.warn(`${this.channelName(channel)}投递手工重试失败: ${this.errorMessage(error)}`),
    )
    return this.toVO(updated, updated.userId ? (names.get(updated.userId) ?? null) : null)
  }

  @Cron('0 * * * * *')
  async scheduledProcessDueDeliveries(): Promise<void> {
    if (!this.coordinator) return void (await this.processDueDeliveries())
    await this.coordinator.runScheduledOnce('message-delivery', 'MINUTE', () =>
      this.processDueDeliveries(),
    )
  }

  async processDueDeliveries(): Promise<number> {
    const now = new Date()
    const nowTemporal = instantFromDate(now)
    const staleBefore = instantFromEpochMilliseconds(now.getTime() - STALE_SENDING_MS)
    await this.prisma.client.orm.public.MessageDeliveries.where({ status: 'SENDING' })
      .where((delivery) => delivery.channel.in(SUPPORTED_CHANNELS))
      .where((delivery) => delivery.updatedAt.lt(staleBefore))
      .updateAll({
        status: 'FAILED',
        nextAttemptAt: nowTemporal,
        errorCode: 'WORKER_TIMEOUT',
        errorMessage: '投递处理超时，已恢复等待重试',
        updatedAt: nowTemporal,
      })
    const due = await this.prisma.client.orm.public.MessageDeliveries.where((delivery) =>
      delivery.channel.in(SUPPORTED_CHANNELS),
    )
      .where((delivery) => delivery.status.in(['PENDING', 'FAILED']))
      .where((delivery) =>
        or(delivery.nextAttemptAt.isNull(), delivery.nextAttemptAt.lte(nowTemporal)),
      )
      .select('id')
      .orderBy((delivery) => delivery.createdAt.asc())
      .limit(MAX_BATCH_SIZE)
      .all()
    return this.processIds(due.map((item) => item.id))
  }

  executorSnapshot() {
    return this.executor.snapshot()
  }

  async processIds(ids: string[]): Promise<number> {
    const { accepted, deferred } = await this.executor.run(ids)
    if (deferred && Date.now() - this.lastOverflowWarningAt >= 30_000) {
      this.lastOverflowWarningAt = Date.now()
      this.logger.warn(`消息投递进程队列已满，本批 ${deferred} 条留在数据库等待定时恢复`)
    }
    return accepted
  }

  private async processOne(id: string): Promise<void> {
    const perf = process.env.CRM_EXTERNAL_EVENT_PERF === '1' ? new DeliveryPerformance() : undefined
    try {
      await this.processOneMeasured(id, perf)
    } catch (error) {
      if (perf) perf.outcome = 'exception'
      throw error
    } finally {
      if (perf) perf.finish((line) => this.logger.log(line))
    }
  }

  private async processOneMeasured(id: string, perf?: DeliveryPerformance): Promise<void> {
    const delivery = await measureDelivery(perf, 'claim', () => this.claimDelivery(id))
    if (!delivery) return
    if (perf)
      perf.channel = this.isSupportedChannel(delivery.channel) ? delivery.channel : 'UNKNOWN'
    if (!this.isSupportedChannel(delivery.channel)) {
      await measureDelivery(perf, 'persist_failure', () =>
        this.fail(delivery, 'UNSUPPORTED_CHANNEL', '当前投递渠道暂未实现', false),
      )
      if (perf) perf.outcome = 'dead'
      return
    }
    const channel = delivery.channel
    if (!delivery.externalSubject) {
      await measureDelivery(perf, 'persist_failure', () =>
        this.fail(
          delivery,
          'EXTERNAL_USER_NOT_MAPPED',
          `接收人没有有效的${this.channelName(channel)}成员映射`,
          false,
        ),
      )
      if (perf) perf.outcome = 'dead'
      return
    }
    try {
      const result = await measureDelivery(perf, 'send', () =>
        this.sendByChannel(channel, delivery, perf),
      )
      if (perf) perf.providerCode = result.providerCode
      if (result.success) {
        await measureDelivery(perf, 'persist_success', () =>
          this.completeDelivery(id, result.providerMessageId),
        )
        if (perf) perf.outcome = 'succeeded'
        return
      }
      await measureDelivery(perf, 'persist_failure', () =>
        this.fail(
          delivery,
          result.providerCode === null
            ? `${channel}_UNAVAILABLE`
            : `${channel}_${result.providerCode}`,
          result.message,
          Boolean(result.transient),
        ),
      )
      if (perf)
        perf.outcome =
          result.transient && delivery.attempts < delivery.maxAttempts ? 'retry' : 'dead'
    } catch (error) {
      await measureDelivery(perf, 'persist_failure', () =>
        this.fail(delivery, 'CHANNEL_UNAVAILABLE', this.errorMessage(error), true),
      )
      if (perf) perf.outcome = delivery.attempts < delivery.maxAttempts ? 'retry' : 'dead'
    }
  }

  private async completeDelivery(id: string, providerMessageId: string | null): Promise<void> {
    const sentAt = nowInstant()
    const updated = await this.prisma.client.orm.public.MessageDeliveries.where({ id }).update({
      status: 'SUCCEEDED',
      providerMessageId,
      sentAt,
      errorCode: null,
      errorMessage: null,
      updatedAt: sentAt,
    })
    if (!updated) throw new NotFoundException('投递记录不存在')
  }

  private async claimDelivery(id: string): Promise<WorkerDelivery | null> {
    const client = this.prisma.client
    const now = new Date().toISOString()
    const query = client.raw.sql`UPDATE message_deliveries
      SET status = 'SENDING',
          attempts = attempts + 1,
          "nextAttemptAt" = NULL,
          "errorCode" = NULL,
          "errorMessage" = NULL,
          "updatedAt" = ${now}::timestamptz
      WHERE id = ${id}
        AND status IN ('PENDING', 'FAILED')
        AND (
          "nextAttemptAt" IS NULL
          OR "nextAttemptAt" <= ${now}::timestamptz
        )
      RETURNING id, "tenantId", "integrationId", channel::text AS channel, "userId", "externalSubject",
        title, content, link, attempts, "maxAttempts"`.returnsRow({
      id: client.sql.public.message_deliveries.columns.id,
      tenantId: client.sql.public.message_deliveries.columns.tenantId,
      integrationId: client.sql.public.message_deliveries.columns.integrationId,
      channel: 'pg/text@1',
      userId: client.sql.public.message_deliveries.columns.userId,
      externalSubject: client.sql.public.message_deliveries.columns.externalSubject,
      title: client.sql.public.message_deliveries.columns.title,
      content: client.sql.public.message_deliveries.columns.content,
      link: client.sql.public.message_deliveries.columns.link,
      attempts: client.sql.public.message_deliveries.columns.attempts,
      maxAttempts: client.sql.public.message_deliveries.columns.maxAttempts,
    })
    for await (const row of client.runtime().query(query.build())) return row
    return null
  }

  private async sendByChannel(
    channel: SupportedDeliveryChannel,
    delivery: WorkerDelivery,
    perf?: DeliveryPerformance,
  ) {
    if (channel === 'DINGTALK') {
      if (!this.dingTalkClient) {
        return {
          success: false,
          transient: false,
          providerCode: null,
          providerMessageId: null,
          message: '钉钉 Provider 未加载',
        }
      }
      const runtime = await this.integrations.getDingTalkRuntimeContext(delivery.tenantId)
      if (delivery.integrationId && delivery.integrationId !== runtime.integration.id) {
        return {
          success: false,
          transient: false,
          providerCode: null,
          providerMessageId: null,
          message: '钉钉配置已变化，请手工重试',
        }
      }
      return this.dingTalkClient.sendTextMessage({
        ...runtime.credentials,
        toUser: delivery.externalSubject!,
        content: this.buildContent(delivery),
      })
    }

    if (channel === 'LARK') {
      if (!this.larkClient) {
        return {
          success: false,
          transient: false,
          providerCode: null,
          providerMessageId: null,
          message: '飞书 Provider 未加载',
        }
      }
      const runtime = await this.integrations.getLarkRuntimeContext(delivery.tenantId)
      if (delivery.integrationId && delivery.integrationId !== runtime.integration.id) {
        return {
          success: false,
          transient: false,
          providerCode: null,
          providerMessageId: null,
          message: '飞书配置已变化，请手工重试',
        }
      }
      return this.larkClient.sendTextMessage({
        ...runtime.credentials,
        toUser: delivery.externalSubject!,
        content: this.buildContent(delivery),
      })
    }

    const runtime = await measureDelivery(perf, 'runtime', () =>
      this.integrations.getWeComRuntimeContext(delivery.tenantId),
    )
    if (delivery.integrationId && delivery.integrationId !== runtime.integration.id) {
      return {
        success: false,
        transient: false,
        providerCode: null,
        providerMessageId: null,
        message: '企业微信配置已变化，请手工重试',
      }
    }
    const batch = await this.prisma.client.orm.public.NotificationBatch.where({
      channel: 'WECOM',
      outputId: delivery.id,
      tenantId: delivery.tenantId,
    }).first()
    if (batch) {
      const [member, mapping, items] = await Promise.all([
        this.prisma.client.orm.public.Users.where({
          id: batch.recipientId,
          tenantId: batch.tenantId,
          status: 'ACTIVE',
        })
          .select('id')
          .first(),
        this.prisma.client.orm.public.ExternalUserMappings.where({
          tenantId: batch.tenantId,
          userId: batch.recipientId,
          provider: 'WECOM',
          active: true,
          externalId: batch.externalSubject!,
        })
          .select('id')
          .first(),
        this.prisma.client.orm.public.NotificationItem.where({ batchId: batch.id })
          .select('event')
          .all(),
      ])
      const settings = await Promise.all(
        [...new Set(items.map((item) => item.event))].map((event) =>
          this.messageSettings.getFreshEffectiveSetting(batch.tenantId, event),
        ),
      )
      if (
        !batch.sealedAt ||
        batch.integrationId !== runtime.integration.id ||
        batch.credentialVersion !== runtime.integration.credentialVersion ||
        batch.externalSubject !== delivery.externalSubject ||
        batch.recipientId !== delivery.userId ||
        !member ||
        !mapping ||
        items.length !== batch.itemCount ||
        settings.some((setting) => !setting.weComEnabled)
      ) {
        return {
          success: false,
          transient: false,
          providerCode: null,
          providerMessageId: null,
          message: '聚合通知应用、成员映射或事件开关已变化，保留批次等待人工核查',
        }
      }
    }
    // 企业微信仅使用卡片跳转支持的移动端页面；其他渠道仍保留原有正文格式。
    const tenant = delivery.link
      ? await measureDelivery(perf, 'tenant', () =>
          this.prisma.client.orm.public.Tenants.where({ id: delivery.tenantId })
            .select('slug')
            .first(),
        )
      : null
    return this.weComClient.sendTextMessage(
      {
        ...runtime.credentials,
        toUser: delivery.externalSubject!,
        title: delivery.title,
        content: delivery.content ?? '',
        link: delivery.link,
        tenantSlug: tenant?.slug,
      },
      perf,
    )
  }

  private async fail(
    delivery: WorkerDelivery,
    errorCode: string,
    errorMessage: string,
    transient: boolean,
  ): Promise<void> {
    const retryable = transient && delivery.attempts < delivery.maxAttempts
    const delay = RETRY_DELAYS_MS[Math.max(0, delivery.attempts - 1)] ?? RETRY_DELAYS_MS.at(-1)!
    const updatedAt = nowInstant()
    const updated = await this.prisma.client.orm.public.MessageDeliveries.where({
      id: delivery.id,
    }).update({
      status: retryable ? 'FAILED' : 'DEAD',
      nextAttemptAt: retryable ? nowInstant().add({ milliseconds: delay }) : null,
      errorCode: errorCode.slice(0, 100),
      errorMessage: errorMessage.slice(0, 500),
      updatedAt,
    })
    if (!updated) throw new NotFoundException('投递记录不存在')
  }

  private buildContent(delivery: WorkerDelivery): string {
    return [delivery.title, delivery.content, delivery.link]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2_048)
  }

  private async userNames(tenantId: string, rawUserIds: Array<string | null>) {
    const userIds = [...new Set(rawUserIds.filter((id): id is string => Boolean(id)))]
    if (!userIds.length) return new Map<string, string>()
    const users = await this.prisma.client.orm.public.Users.where({ tenantId })
      .where((user) => user.id.in(userIds))
      .select('id', 'name')
      .all()
    return new Map(users.map((user) => [user.id, user.name]))
  }

  private toVO(delivery: MessageDeliveryRow, userName: string | null): MessageDeliveryVO {
    if (!this.isSupportedChannel(delivery.channel)) {
      throw new Error(`不支持的消息投递渠道：${delivery.channel}`)
    }
    return {
      id: delivery.id,
      channel: delivery.channel,
      event: delivery.event,
      eventName:
        MESSAGE_TASK_DEFINITIONS.find((definition) => definition.event === delivery.event)
          ?.eventName ?? delivery.event,
      userId: delivery.userId,
      userName,
      externalSubject: delivery.externalSubject,
      title: delivery.title,
      content: delivery.content,
      link: delivery.link,
      status: delivery.status,
      attempts: delivery.attempts,
      maxAttempts: delivery.maxAttempts,
      nextAttemptAt: delivery.nextAttemptAt ? instantToISOString(delivery.nextAttemptAt) : null,
      providerMessageId: delivery.providerMessageId,
      errorCode: delivery.errorCode,
      errorMessage: delivery.errorMessage,
      sentAt: delivery.sentAt ? instantToISOString(delivery.sentAt) : null,
      createdAt: instantToISOString(delivery.createdAt),
      updatedAt: instantToISOString(delivery.updatedAt),
    }
  }

  private isSupportedChannel(channel: string): channel is SupportedDeliveryChannel {
    return channel === 'WECOM' || channel === 'DINGTALK' || channel === 'LARK'
  }

  private channelName(channel: SupportedDeliveryChannel): string {
    return channel === 'DINGTALK' ? '钉钉' : channel === 'LARK' ? '飞书' : '企业微信'
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
  }
}
