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
  type MessageDeliveryVO,
  type MessageTaskEvent,
} from '@micromatrix/shared'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import {
  prisma8Now,
  prisma8TimestampFromEpochMilliseconds,
  prisma8TimestampFromDate,
  prisma8TimestampToISOString,
} from '../../prisma/prisma8-temporal.js'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import { DingTalkClient } from '../enterprise-integrations/dingtalk.client'
import { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import { LarkClient } from '../enterprise-integrations/lark.client'
import { WeComClient } from '../enterprise-integrations/wecom.client'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import type { QueryMessageDeliveriesDto } from './dto/message-delivery.dto'

export interface EnqueueMessageInput {
  tenantId: string
  event: MessageTaskEvent
  recipientIds: string[]
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
  nextAttemptAt: ReturnType<typeof prisma8Now> | null
  providerMessageId: string | null
  errorCode: string | null
  errorMessage: string | null
  sentAt: ReturnType<typeof prisma8Now> | null
  createdAt: ReturnType<typeof prisma8Now>
  updatedAt: ReturnType<typeof prisma8Now>
}

type WorkerDelivery = {
  id: string
  tenantId: string
  integrationId: string | null
  channel: string
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

@Injectable()
export class MessageDeliveryService {
  private readonly logger = new Logger(MessageDeliveryService.name)

  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly messageSettings: MessageSettingsService,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly weComClient: WeComClient,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
    @Optional() private readonly dingTalkClient?: DingTalkClient,
    @Optional() private readonly larkClient?: LarkClient,
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
    const enabled =
      channel === 'DINGTALK'
        ? await this.messageSettings.isDingTalkEnabled(input.tenantId, input.event)
        : channel === 'LARK'
          ? await this.messageSettings.isLarkEnabled(input.tenantId, input.event)
          : await this.messageSettings.isWeComEnabled(input.tenantId, input.event)
    if (!enabled) return 0
    const gate =
      channel === 'DINGTALK'
        ? await this.messageSettings.getDingTalkChannelGate(input.tenantId)
        : channel === 'LARK'
          ? await this.messageSettings.getLarkChannelGate(input.tenantId)
          : await this.messageSettings.getWeComChannelGate(input.tenantId)
    if (!gate.available) return 0
    const integration = await this.prisma8.client.orm.public.EnterpriseIntegrations.where({
      tenantId: input.tenantId,
      provider: channel,
    })
      .select('id')
      .first()
    if (!integration) return 0

    const userIds = [...new Set(input.recipientIds)]
    if (userIds.length === 0) return 0
    const mappings = await this.prisma8.client.orm.public.ExternalUserMappings.where({
      tenantId: input.tenantId,
      provider: channel,
      active: true,
    })
      .where((mapping) => mapping.userId.in(userIds))
      .select('userId', 'externalId')
      .all()
    const mappingByUser = new Map(mappings.map((mapping) => [mapping.userId, mapping]))
    const updatedAt = prisma8Now()
    const created = await this.prisma8.client.transaction(async (tx) => {
      return tx.orm.public.MessageDeliveries.createAll(
        userIds.map((userId) => {
        const mapping = mappingByUser.get(userId)
          return {
            tenantId: input.tenantId,
            integrationId: integration.id,
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
        }),
      )
    })
    const pendingIds = created.filter((item) => item.status === 'PENDING').map((item) => item.id)
    if (pendingIds.length > 0) {
      void this.processIds(pendingIds).catch((error) =>
        this.logger.warn(
          `${this.channelName(channel)}投递即时处理失败: ${this.errorMessage(error)}`,
        ),
      )
    }
    return created.length
  }

  async list(tenantId: string, query: QueryMessageDeliveriesDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const keyword = query.keyword?.trim()
    const matchingUsers = keyword
      ? await this.prisma8.client.orm.public.Users.where({ tenantId })
          .where((user) => user.name.ilike(`%${keyword}%`))
          .select('id')
          .all()
      : []
    const scoped = this.prisma8.client.orm.public.MessageDeliveries.where({
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
    const names = await this.userNames(tenantId, items.map((item) => item.userId))
    return {
      items: items.map((item) => this.toVO(item, item.userId ? (names.get(item.userId) ?? null) : null)),
      total: aggregate.total,
      page,
      pageSize,
    }
  }

  async retry(tenantId: string, id: string): Promise<MessageDeliveryVO> {
    const delivery = await this.prisma8.client.orm.public.MessageDeliveries.where({ id, tenantId }).first()
    if (!delivery) throw new NotFoundException('投递记录不存在')
    if (!this.isSupportedChannel(delivery.channel)) {
      throw new BadRequestException('当前投递渠道暂不支持手工重试')
    }
    const channel = delivery.channel
    if (!['FAILED', 'DEAD'].includes(delivery.status)) {
      throw new BadRequestException('只有失败或已终止的投递可以重试')
    }
    const updated = await this.prisma8.client.orm.public.MessageDeliveries.where({ id, tenantId }).update({
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: null,
      errorCode: null,
      errorMessage: null,
      providerMessageId: null,
      sentAt: null,
      updatedAt: prisma8Now(),
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
    const nowTemporal = prisma8TimestampFromDate(now)
    const staleBefore = prisma8TimestampFromEpochMilliseconds(now.getTime() - STALE_SENDING_MS)
    await this.prisma8.client.orm.public.MessageDeliveries.where({ status: 'SENDING' })
      .where((delivery) => delivery.channel.in(SUPPORTED_CHANNELS))
      .where((delivery) => delivery.updatedAt.lt(staleBefore))
      .updateAll({
        status: 'FAILED',
        nextAttemptAt: nowTemporal,
        errorCode: 'WORKER_TIMEOUT',
        errorMessage: '投递处理超时，已恢复等待重试',
        updatedAt: nowTemporal,
      })
    const due = await this.prisma8.client.orm.public.MessageDeliveries.where((delivery) =>
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
    await this.processIds(due.map((item) => item.id))
    return due.length
  }

  async processIds(ids: string[]): Promise<void> {
    let cursor = 0
    const workers = Array.from({ length: Math.min(WORKER_CONCURRENCY, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        if (id) await this.processOne(id)
      }
    })
    await Promise.all(workers)
  }

  private async processOne(id: string): Promise<void> {
    if (!(await this.claimDelivery(id))) return
    const delivery = await this.prisma8.client.orm.public.MessageDeliveries.where({ id })
      .select(
        'id',
        'tenantId',
        'integrationId',
        'channel',
        'externalSubject',
        'title',
        'content',
        'link',
        'attempts',
        'maxAttempts',
      )
      .first()
    if (!delivery) return
    if (!this.isSupportedChannel(delivery.channel)) {
      await this.fail(delivery, 'UNSUPPORTED_CHANNEL', '当前投递渠道暂未实现', false)
      return
    }
    const channel = delivery.channel
    if (!delivery.externalSubject) {
      await this.fail(
        delivery,
        'EXTERNAL_USER_NOT_MAPPED',
        `接收人没有有效的${this.channelName(channel)}成员映射`,
        false,
      )
      return
    }
    try {
      const result = await this.sendByChannel(channel, delivery)
      if (result.success) {
        await this.completeDelivery(id, result.providerMessageId)
        return
      }
      await this.fail(
        delivery,
        result.providerCode === null
          ? `${channel}_UNAVAILABLE`
          : `${channel}_${result.providerCode}`,
        result.message,
        Boolean(result.transient),
      )
    } catch (error) {
      await this.fail(delivery, 'CHANNEL_UNAVAILABLE', this.errorMessage(error), true)
    }
  }

  private async completeDelivery(id: string, providerMessageId: string | null): Promise<void> {
    const sentAt = prisma8Now()
    const updated = await this.prisma8.client.orm.public.MessageDeliveries.where({ id }).update({
      status: 'SUCCEEDED',
      providerMessageId,
      sentAt,
      errorCode: null,
      errorMessage: null,
      updatedAt: sentAt,
    })
    if (!updated) throw new NotFoundException('投递记录不存在')
  }

  private async claimDelivery(id: string): Promise<boolean> {
    const client = this.prisma8.client
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
      RETURNING id`.returnsRow({ id: client.sql.public.message_deliveries.columns.id })
    let claimed = false
    for await (const _row of client.runtime().query(query.build())) claimed = true
    return claimed
  }

  private async sendByChannel(channel: SupportedDeliveryChannel, delivery: WorkerDelivery) {
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

    const runtime = await this.integrations.getWeComRuntimeContext(delivery.tenantId)
    if (delivery.integrationId && delivery.integrationId !== runtime.integration.id) {
      return {
        success: false,
        transient: false,
        providerCode: null,
        providerMessageId: null,
        message: '企业微信配置已变化，请手工重试',
      }
    }
    return this.weComClient.sendTextMessage({
      ...runtime.credentials,
      toUser: delivery.externalSubject!,
      content: this.buildContent(delivery),
    })
  }

  private async fail(
    delivery: WorkerDelivery,
    errorCode: string,
    errorMessage: string,
    transient: boolean,
  ): Promise<void> {
    const retryable = transient && delivery.attempts < delivery.maxAttempts
    const delay = RETRY_DELAYS_MS[Math.max(0, delivery.attempts - 1)] ?? RETRY_DELAYS_MS.at(-1)!
    const updatedAt = prisma8Now()
    const updated = await this.prisma8.client.orm.public.MessageDeliveries.where({
      id: delivery.id,
    }).update({
      status: retryable ? 'FAILED' : 'DEAD',
      nextAttemptAt: retryable ? prisma8Now().add({ milliseconds: delay }) : null,
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
    const users = await this.prisma8.client.orm.public.Users.where({ tenantId })
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
      nextAttemptAt: delivery.nextAttemptAt
        ? prisma8TimestampToISOString(delivery.nextAttemptAt)
        : null,
      providerMessageId: delivery.providerMessageId,
      errorCode: delivery.errorCode,
      errorMessage: delivery.errorMessage,
      sentAt: delivery.sentAt ? prisma8TimestampToISOString(delivery.sentAt) : null,
      createdAt: prisma8TimestampToISOString(delivery.createdAt),
      updatedAt: prisma8TimestampToISOString(delivery.updatedAt),
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
