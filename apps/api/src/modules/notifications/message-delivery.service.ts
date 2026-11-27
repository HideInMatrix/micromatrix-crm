import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { Cron, Interval } from '@nestjs/schedule'
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
import { nowInstant, instantFromDate, instantToISOString } from '../../prisma/temporal.js'
import { PrismaService } from '../../prisma.service.js'
import { DingTalkClient } from '../enterprise-integrations/dingtalk.client'
import { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import { LarkClient } from '../enterprise-integrations/lark.client'
import {
  WeComClient,
  type WeComConnectionInput,
  type WeComMessageInput,
} from '../enterprise-integrations/wecom.client'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import type { QueryMessageDeliveriesDto } from './dto/message-delivery.dto'
import { randomUUID } from 'node:crypto'
import { NotificationAggregationStore } from './notification-aggregation.store'
import {
  aggregationEnabled,
  deliveryAggregationItem,
  buildAggregationSummary,
} from './notification-aggregation-runtime'
import { projectAggregationItems } from './notification-aggregation-projection'
import { DeliveryExecutor } from './delivery-executor'
import { WeComRateLimitService, weComRateLimitEnabled } from './wecom-rate-limit.service'

import { DeliveryPerformance, measureDelivery } from './delivery-performance'
import type { NotificationPreparationReads } from './notification-preparation-reads'

class QuotaPersistenceError extends Error {}

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
  event: string
  userId: string | null
  externalSubject: string | null
  title: string
  content: string | null
  link: string | null
  attempts: number
  maxAttempts: number
  claimToken: string
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
  private rateWaitRunning = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageSettings: MessageSettingsService,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly weComClient: WeComClient,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
    @Optional() private readonly dingTalkClient?: DingTalkClient,
    @Optional() private readonly larkClient?: LarkClient,
    @Optional() private readonly aggregation?: NotificationAggregationStore,
    @Optional() private readonly rateLimit?: WeComRateLimitService,
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
    if (
      [
        'AGGREGATION_RECIPIENT_REMOVED',
        'AGGREGATION_DETAILS_ARCHIVED',
        'AGGREGATION_BATCH_MISSING',
      ].includes(delivery.errorCode ?? '')
    ) {
      throw new BadRequestException('聚合明细已清理或接收人已删除，不允许重试')
    }
    if (!['FAILED', 'DEAD'].includes(delivery.status)) {
      throw new BadRequestException('只有失败或已终止的投递可以重试')
    }
    const changed = await this.prisma.client.orm.public.MessageDeliveries.where({
      id,
      tenantId,
      status: delivery.status,
      attempts: delivery.attempts,
      claimToken: delivery.claimToken,
      updatedAt: delivery.updatedAt,
    }).updateAndCount({
      status: 'PENDING',
      attempts: 0,
      claimToken: randomUUID(),
      nextAttemptAt: null,
      errorCode: null,
      errorMessage: null,
      providerMessageId: null,
      sentAt: null,
      updatedAt: nowInstant(),
    })
    if (changed !== 1) throw new BadRequestException('投递状态已变化，请刷新后重试')
    const updated = await this.prisma.client.orm.public.MessageDeliveries.where({
      id,
      tenantId,
    }).first()
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
    await this.recoverStaleDeliveries()
    if (weComRateLimitEnabled() && this.rateLimit) {
      try {
        await this.rateLimit.cleanupExpired()
      } catch {
        this.logger.warn('企业微信频控账本清理失败，等待定时恢复')
      }
    }
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

  @Interval(1_000)
  async scheduledRateWait(): Promise<void> {
    if (!weComRateLimitEnabled() || this.rateWaitRunning) return
    this.rateWaitRunning = true
    try {
      const now = nowInstant()
      const rows = await this.prisma.client.orm.public.MessageDeliveries.where({
        channel: 'WECOM',
        status: 'PENDING',
      })
        .where((row) => row.errorCode.in(['WECOM_RATE_LIMIT_WAIT', 'WECOM_RATE_LIMIT_UNAVAILABLE']))
        .where((row) => row.nextAttemptAt.lte(now))
        .orderBy((row) => row.nextAttemptAt.asc())
        .orderBy((row) => row.createdAt.asc())
        .select('id')
        .limit(MAX_BATCH_SIZE)
        .all()
      await this.processIds(rows.map((row) => row.id))
    } catch {
      this.logger.warn('企业微信频控等待任务扫描失败')
    } finally {
      this.rateWaitRunning = false
    }
  }

  private async recoverStaleDeliveries(): Promise<void> {
    const client = this.prisma.client
    // Column-to-column attempt comparisons are expressed in SQL. The same
    // statement decides retry vs exhausted, using the database clock.
    const query = client.raw.sql`WITH recovered AS (
      UPDATE message_deliveries
      SET status = CASE WHEN attempts >= "maxAttempts" THEN 'DEAD' ELSE 'FAILED' END::"MessageDeliveryStatus",
          "nextAttemptAt" = CASE WHEN attempts >= "maxAttempts" THEN NULL ELSE clock_timestamp() END,
          "errorCode" = 'WORKER_TIMEOUT_UNKNOWN',
          "errorMessage" = CASE WHEN attempts >= "maxAttempts"
            THEN '投递处理超时，结果未知且已耗尽重试次数'
            ELSE '投递处理超时，结果未知，已恢复等待重试' END,
          "updatedAt" = clock_timestamp()
      WHERE status = 'SENDING' AND channel IN ('WECOM','DINGTALK','LARK')
        AND "updatedAt" < clock_timestamp() - (${STALE_SENDING_MS}::bigint * interval '1 millisecond')
      RETURNING 1
    ), exhausted AS (
      UPDATE message_deliveries
      SET status = 'DEAD', "nextAttemptAt" = NULL,
          "errorCode" = 'ATTEMPTS_EXHAUSTED', "errorMessage" = '已耗尽投递重试次数',
          "updatedAt" = clock_timestamp()
      WHERE status IN ('PENDING','FAILED') AND channel IN ('WECOM','DINGTALK','LARK')
        AND attempts >= "maxAttempts"
      RETURNING 1
    ) SELECT (SELECT count(*) FROM recovered)::text AS recovered,
             (SELECT count(*) FROM exhausted)::text AS exhausted`.returnsRow({
      recovered: 'pg/text@1',
      exhausted: 'pg/text@1',
    })
    for await (const _row of client.runtime().query(query.build())) {
      /* consume */
    }
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
      const applied = await measureDelivery(perf, 'persist_failure', () =>
        this.fail(delivery, 'UNSUPPORTED_CHANNEL', '当前投递渠道暂未实现', false),
      )
      if (perf) perf.outcome = applied ? 'dead' : 'stale_claim'
      return
    }
    const channel = delivery.channel
    if (!delivery.externalSubject) {
      const applied = await measureDelivery(perf, 'persist_failure', () =>
        this.fail(
          delivery,
          'EXTERNAL_USER_NOT_MAPPED',
          `接收人没有有效的${this.channelName(channel)}成员映射`,
          false,
        ),
      )
      if (perf) perf.outcome = applied ? 'dead' : 'stale_claim'
      return
    }
    let result: Awaited<ReturnType<MessageDeliveryService['sendByChannel']>>
    try {
      result = await measureDelivery(perf, 'send', () =>
        this.sendByChannel(channel, delivery, perf),
      )
    } catch (error) {
      if (error instanceof QuotaPersistenceError) throw error
      const applied = await measureDelivery(perf, 'persist_failure', () =>
        this.fail(delivery, 'CHANNEL_UNAVAILABLE', this.errorMessage(error), true),
      )
      if (perf)
        perf.outcome = !applied
          ? 'stale_claim'
          : delivery.attempts < delivery.maxAttempts
            ? 'retry'
            : 'dead'
      return
    }
    if (
      'deferred' in result &&
      (result.deferred === 'rate_wait' ||
        result.deferred === 'stale_claim' ||
        result.deferred === 'suppressed')
    ) {
      if (perf) perf.outcome = result.deferred
      return
    }
    if (perf) perf.providerCode = result.providerCode
    if (result.success) {
      const applied = await measureDelivery(perf, 'persist_success', () =>
        this.completeDelivery(delivery, result.providerMessageId),
      )
      if (perf) perf.outcome = applied ? 'succeeded' : 'stale_claim'
      return
    }
    const applied = await measureDelivery(perf, 'persist_failure', () =>
      this.fail(
        delivery,
        result.providerCode === null
          ? channel === 'WECOM' && 'rateLimited' in result && result.rateLimited === true
            ? 'WECOM_HTTP_429'
            : `${channel}_UNAVAILABLE`
          : `${channel}_${result.providerCode}`,
        result.message,
        Boolean(result.transient),
      ),
    )
    if (perf)
      perf.outcome = !applied
        ? 'stale_claim'
        : result.transient && delivery.attempts < delivery.maxAttempts
          ? 'retry'
          : 'dead'
  }

  private async completeDelivery(
    delivery: WorkerDelivery,
    providerMessageId: string | null,
  ): Promise<boolean> {
    const sentAt = nowInstant()
    const count = await this.prisma.client.orm.public.MessageDeliveries.where({
      id: delivery.id,
      tenantId: delivery.tenantId,
      status: 'SENDING',
      claimToken: delivery.claimToken,
    }).updateAndCount({
      status: 'SUCCEEDED',
      providerMessageId,
      sentAt,
      errorCode: null,
      errorMessage: null,
      updatedAt: sentAt,
    })
    return count === 1
  }

  private async claimDelivery(id: string): Promise<WorkerDelivery | null> {
    const client = this.prisma.client
    const claimToken = randomUUID()
    const query = client.raw.sql`UPDATE message_deliveries
      SET status = 'SENDING',
          attempts = attempts + 1,
          claim_token = ${claimToken},
          "nextAttemptAt" = NULL,
          "errorCode" = NULL,
          "errorMessage" = NULL,
          "updatedAt" = clock_timestamp()
      WHERE id = ${id}
        AND status IN ('PENDING', 'FAILED')
        AND attempts < "maxAttempts"
        AND (
          "nextAttemptAt" IS NULL
          OR "nextAttemptAt" <= clock_timestamp()
        )
      RETURNING id, "tenantId", "integrationId", channel::text AS channel, event, "userId", "externalSubject",
        title, content, link, attempts, "maxAttempts", claim_token AS "claimToken"`.returnsRow({
      id: client.sql.public.message_deliveries.columns.id,
      tenantId: client.sql.public.message_deliveries.columns.tenantId,
      integrationId: client.sql.public.message_deliveries.columns.integrationId,
      channel: 'pg/text@1',
      event: client.sql.public.message_deliveries.columns.event,
      userId: client.sql.public.message_deliveries.columns.userId,
      externalSubject: client.sql.public.message_deliveries.columns.externalSubject,
      title: client.sql.public.message_deliveries.columns.title,
      content: client.sql.public.message_deliveries.columns.content,
      link: client.sql.public.message_deliveries.columns.link,
      attempts: client.sql.public.message_deliveries.columns.attempts,
      maxAttempts: client.sql.public.message_deliveries.columns.maxAttempts,
      claimToken: 'pg/text@1',
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

    // Locate aggregate output independently of the rollout flag. Legacy
    // sealed singletons still have a batch association and must not bypass.
    const batch = await this.prisma.client.orm.public.NotificationBatch.where({
      channel: 'WECOM',
      outputId: delivery.id,
    }).first()
    const stop = (deferred: 'suppressed' | 'stale_claim') => ({
      success: false,
      transient: false,
      providerCode: null,
      providerMessageId: null,
      message: '聚合通知已抑制或认领已失效',
      deferred,
    })
    if (!batch && delivery.event.startsWith('AGGREGATED:')) {
      return stop(await this.suppressOrphanBatch(delivery))
    }
    let runtime: Awaited<ReturnType<EnterpriseIntegrationsService['getWeComRuntimeContext']>>
    try {
      runtime = await measureDelivery(perf, 'runtime', () =>
        this.integrations.getWeComRuntimeContext(delivery.tenantId),
      )
    } catch (error) {
      // Configuration rejection is terminal for a previously admitted batch;
      // infrastructure failures remain eligible for ordinary durable retry.
      if (batch && (error instanceof BadRequestException || error instanceof NotFoundException)) {
        const projection = await this.prepareWeComBatch(delivery, batch.id, null)
        return stop(projection.kind === 'stale_claim' ? 'stale_claim' : 'suppressed')
      }
      throw error
    }
    if (delivery.integrationId && delivery.integrationId !== runtime.integration.id) {
      if (batch) {
        const projection = await this.prepareWeComBatch(delivery, batch.id, null)
        return stop(projection.kind === 'stale_claim' ? 'stale_claim' : 'suppressed')
      }
      return {
        success: false,
        transient: false,
        providerCode: null,
        providerMessageId: null,
        message: '企业微信配置已变化，请手工重试',
      }
    }
    // A delayed legacy row may carry an unsafe business URL. The projection
    // always replaces it with a batch URL before constructing the POST.
    const tenant =
      batch || delivery.link
        ? await measureDelivery(perf, 'tenant', () =>
            this.prisma.client.orm.public.Tenants.where({ id: delivery.tenantId })
              .select('slug')
              .first(),
          )
        : null
    const quota = weComRateLimitEnabled()
      ? (this.rateLimit ?? new WeComRateLimitService(this.prisma))
      : null
    const identity = {
      corpId: runtime.credentials.corpId,
      agentId: runtime.credentials.agentId,
      externalSubject: delivery.externalSubject!,
    }
    // Do not let a malformed mapping turn a one-recipient budget into a broadcast.
    if (
      identity.externalSubject.trim() !== identity.externalSubject ||
      identity.externalSubject.includes('|') ||
      identity.externalSubject.toLowerCase() === '@all'
    ) {
      return {
        success: false,
        transient: false,
        providerCode: null,
        providerMessageId: null,
        message: '企业微信接收人必须为单个成员',
      }
    }
    const input: WeComMessageInput = {
      ...runtime.credentials,
      toUser: delivery.externalSubject!,
      title: delivery.title,
      content: delivery.content ?? '',
      link: delivery.link,
      tenantSlug: tenant?.slug,
    }
    const beforePost = async () => {
      if (batch) {
        const projection = await measureDelivery(perf, 'batch_projection', () =>
          this.prepareWeComBatch(delivery, batch.id, {
            id: runtime.integration.id,
            credentialVersion: runtime.integration.credentialVersion,
            corpId: runtime.credentials.corpId,
            agentId: runtime.credentials.agentId,
          }),
        )
        if (projection.kind !== 'granted') return projection.kind
        Object.assign(input, {
          title: projection.summary.title,
          content: projection.summary.content,
          link: projection.summary.link,
        })
      }
      if (!quota) {
        if (batch) return 'granted' as const
        const owned = await this.prisma.client.orm.public.MessageDeliveries.where({
          id: delivery.id,
          tenantId: delivery.tenantId,
          status: 'SENDING',
          claimToken: delivery.claimToken,
        })
          .select('id')
          .first()
        return owned ? ('granted' as const) : ('stale_claim' as const)
      }
      return measureDelivery(perf, 'quota', async () => {
        try {
          return await quota.reserve(delivery, identity)
        } catch {
          this.logger.warn('企业微信频控不可用，禁止发送并尝试延期')
          try {
            return await quota.deferUnavailable(delivery)
          } catch {
            throw new QuotaPersistenceError('企业微信配额等待状态无法持久化')
          }
        }
      })
    }
    const result = await this.weComClient.sendTextMessage(input, perf, beforePost)
    if (quota && (result.providerCode === 45009 || result.rateLimited)) {
      try {
        await quota.block(identity)
      } catch {
        this.logger.warn('企业微信频控冷却记录失败')
      }
    }
    return result
  }

  private async suppressOrphanBatch(
    delivery: WorkerDelivery,
  ): Promise<'suppressed' | 'stale_claim'> {
    const count = await this.prisma.client.orm.public.MessageDeliveries.where({
      id: delivery.id,
      tenantId: delivery.tenantId,
      status: 'SENDING',
      claimToken: delivery.claimToken,
    }).updateAndCount({
      status: 'DEAD',
      attempts: Math.max(0, delivery.attempts - 1),
      nextAttemptAt: null,
      title: '聚合通知不可用',
      content: null,
      link: null,
      errorCode: 'AGGREGATION_BATCH_MISSING',
      errorMessage: '聚合批次不存在或已不可用',
      updatedAt: nowInstant(),
    })
    return count === 1 ? 'suppressed' : 'stale_claim'
  }

  private async prepareWeComBatch(
    delivery: WorkerDelivery,
    batchId: string,
    runtime:
      | (Pick<WeComConnectionInput, 'corpId' | 'agentId'> & {
          id: string
          credentialVersion: number
        })
      | null,
  ): Promise<
    | { kind: 'granted'; summary: ReturnType<typeof buildAggregationSummary> }
    | { kind: 'suppressed' | 'stale_claim' }
  > {
    return this.prisma.client.transaction(async (tx) => {
      const orm = tx.orm.public
      const owned = () =>
        orm.MessageDeliveries.where({
          id: delivery.id,
          tenantId: delivery.tenantId,
          status: 'SENDING',
          claimToken: delivery.claimToken,
        })
      // The write locks the delivery row through the entire projection. A
      // stale claim can never change suppression markers or the output.
      if ((await owned().updateAndCount({ updatedAt: nowInstant() })) !== 1)
        return { kind: 'stale_claim' }
      const batch = await orm.NotificationBatch.where({
        id: batchId,
        channel: 'WECOM',
        outputId: delivery.id,
        tenantId: delivery.tenantId,
      }).first()
      const terminate = async (code: string) => {
        await owned().updateAndCount({
          status: 'DEAD',
          attempts: Math.max(0, delivery.attempts - 1),
          nextAttemptAt: null,
          title: '聚合通知不可用',
          content: null,
          link: null,
          errorCode: code,
          errorMessage: '聚合通知已停止发送，保留原明细供审计',
          updatedAt: nowInstant(),
        })
        return { kind: 'suppressed' } as const
      }
      if (
        !batch ||
        !batch.sealedAt ||
        batch.recipientId !== delivery.userId ||
        batch.integrationId !== delivery.integrationId ||
        batch.externalSubject !== delivery.externalSubject
      ) {
        return terminate('AGGREGATION_IDENTITY_CHANGED')
      }
      if (batch.detailsArchivedAt) return terminate('AGGREGATION_DETAILS_ARCHIVED')
      const items = await orm.NotificationItem.where({ batchId: batch.id }).all()
      if (items.length !== batch.itemCount || !items.length)
        return terminate('AGGREGATION_ITEM_COUNT_MISMATCH')
      const [integration, tenant, mapping] = await Promise.all([
        orm.EnterpriseIntegrations.where({ tenantId: batch.tenantId, provider: 'WECOM' })
          .select(
            'id',
            'corpId',
            'agentId',
            'credentialVersion',
            'syncEnabled',
            'lastTestSucceeded',
          )
          .first(),
        orm.Tenants.where({ id: batch.tenantId, status: 'ACTIVE', enterpriseSyncResource: 'WECOM' })
          .select('id')
          .first(),
        orm.ExternalUserMappings.where({
          tenantId: batch.tenantId,
          userId: batch.recipientId,
          provider: 'WECOM',
          active: true,
          externalId: batch.externalSubject!,
        })
          .select('id')
          .first(),
      ])
      const identityValid = !!(
        runtime &&
        integration &&
        tenant &&
        mapping &&
        integration.syncEnabled &&
        integration.lastTestSucceeded === true &&
        batch.integrationId === integration.id &&
        runtime.id === integration.id &&
        batch.credentialVersion === integration.credentialVersion &&
        runtime.credentialVersion === integration.credentialVersion &&
        runtime.corpId === integration.corpId &&
        runtime.agentId === integration.agentId
      )
      const active = await projectAggregationItems(
        tx,
        batch,
        items,
        identityValid ? undefined : 'CHANNEL_IDENTITY_CHANGED',
      )
      if (!active.length)
        return terminate(
          identityValid ? 'AGGREGATION_ALL_SUPPRESSED' : 'AGGREGATION_IDENTITY_CHANGED',
        )
      const summary = buildAggregationSummary(batch, active)
      await owned().updateAndCount({
        event: summary.event,
        title: summary.title,
        content: summary.content,
        link: summary.link,
        updatedAt: nowInstant(),
      })
      return { kind: 'granted', summary }
    })
  }

  private async fail(
    delivery: WorkerDelivery,
    errorCode: string,
    errorMessage: string,
    transient: boolean,
  ): Promise<boolean> {
    const retryable = transient && delivery.attempts < delivery.maxAttempts
    const delay = RETRY_DELAYS_MS[Math.max(0, delivery.attempts - 1)] ?? RETRY_DELAYS_MS.at(-1)!
    const updatedAt = nowInstant()
    const updated = await this.prisma.client.orm.public.MessageDeliveries.where({
      id: delivery.id,
      tenantId: delivery.tenantId,
      status: 'SENDING',
      claimToken: delivery.claimToken,
    }).updateAndCount({
      status: retryable ? 'FAILED' : 'DEAD',
      nextAttemptAt: retryable ? nowInstant().add({ milliseconds: delay }) : null,
      errorCode: errorCode.slice(0, 100),
      errorMessage: errorMessage.slice(0, 500),
      updatedAt,
    })
    return updated === 1
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
