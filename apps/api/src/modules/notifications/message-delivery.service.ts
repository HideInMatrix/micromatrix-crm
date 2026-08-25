import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  MESSAGE_TASK_DEFINITIONS,
  type MessageDeliveryVO,
  type MessageTaskEvent,
} from '@micromatrix/shared'
import type { MessageDelivery, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import { WeComClient } from '../enterprise-integrations/wecom.client'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import type { QueryMessageDeliveriesDto } from './dto/message-delivery.dto'

export interface EnqueueWeComMessageInput {
  tenantId: string
  event: MessageTaskEvent
  recipientIds: string[]
  title: string
  content?: string
  link?: string
}

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000]
const STALE_SENDING_MS = 5 * 60_000
const MAX_BATCH_SIZE = 50
const WORKER_CONCURRENCY = 5

@Injectable()
export class MessageDeliveryService {
  private readonly logger = new Logger(MessageDeliveryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageSettings: MessageSettingsService,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly weComClient: WeComClient,
  ) {}

  async enqueue(input: EnqueueWeComMessageInput): Promise<number> {
    if (!(await this.messageSettings.isWeComEnabled(input.tenantId, input.event))) return 0
    const gate = await this.messageSettings.getWeComChannelGate(input.tenantId)
    if (!gate.available) return 0
    const integration = await this.prisma.enterpriseIntegration.findUnique({
      where: { tenantId_provider: { tenantId: input.tenantId, provider: 'WECOM' } },
    })
    if (!integration) return 0

    const userIds = [...new Set(input.recipientIds)]
    if (userIds.length === 0) return 0
    const mappings = await this.prisma.externalUserMapping.findMany({
      where: {
        tenantId: input.tenantId,
        provider: 'WECOM',
        active: true,
        userId: { in: userIds },
      },
    })
    const mappingByUser = new Map(mappings.map((mapping) => [mapping.userId, mapping]))
    const created = await this.prisma.$transaction(
      userIds.map((userId) => {
        const mapping = mappingByUser.get(userId)
        return this.prisma.messageDelivery.create({
          data: {
            tenantId: input.tenantId,
            integrationId: integration.id,
            channel: 'WECOM',
            event: input.event,
            userId,
            externalSubject: mapping?.externalId,
            title: input.title.slice(0, 500),
            content: input.content?.slice(0, 4_000),
            link: input.link?.slice(0, 1_000),
            status: mapping ? 'PENDING' : 'DEAD',
            errorCode: mapping ? null : 'EXTERNAL_USER_NOT_MAPPED',
            errorMessage: mapping ? null : '接收人没有有效的企业微信成员映射',
          },
        })
      }),
    )
    const pendingIds = created.filter((item) => item.status === 'PENDING').map((item) => item.id)
    if (pendingIds.length > 0) {
      void this.processIds(pendingIds).catch((error) =>
        this.logger.warn(`企微投递即时处理失败: ${this.errorMessage(error)}`),
      )
    }
    return created.length
  }

  async list(tenantId: string, query: QueryMessageDeliveriesDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const keyword = query.keyword?.trim()
    const where: Prisma.MessageDeliveryWhereInput = {
      tenantId,
      channel: 'WECOM',
      ...(query.status ? { status: query.status } : {}),
      ...(query.event ? { event: query.event } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword, mode: 'insensitive' } },
              { externalSubject: { contains: keyword, mode: 'insensitive' } },
              { errorMessage: { contains: keyword, mode: 'insensitive' } },
              { user: { name: { contains: keyword, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.messageDelivery.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.messageDelivery.count({ where }),
    ])
    return {
      items: items.map((item) => this.toVO(item, item.user?.name ?? null)),
      total,
      page,
      pageSize,
    }
  }

  async retry(tenantId: string, id: string): Promise<MessageDeliveryVO> {
    const delivery = await this.prisma.messageDelivery.findFirst({
      where: { id, tenantId, channel: 'WECOM' },
      include: { user: { select: { name: true } } },
    })
    if (!delivery) throw new NotFoundException('投递记录不存在')
    if (!['FAILED', 'DEAD'].includes(delivery.status)) {
      throw new BadRequestException('只有失败或已终止的投递可以重试')
    }
    const updated = await this.prisma.messageDelivery.update({
      where: { id },
      data: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: null,
        errorCode: null,
        errorMessage: null,
        providerMessageId: null,
        sentAt: null,
      },
      include: { user: { select: { name: true } } },
    })
    void this.processIds([id]).catch((error) =>
      this.logger.warn(`企微投递手工重试失败: ${this.errorMessage(error)}`),
    )
    return this.toVO(updated, updated.user?.name ?? null)
  }

  @Cron('0 * * * * *')
  async processDueDeliveries(): Promise<number> {
    await this.prisma.messageDelivery.updateMany({
      where: {
        status: 'SENDING',
        updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) },
      },
      data: {
        status: 'FAILED',
        nextAttemptAt: new Date(),
        errorCode: 'WORKER_TIMEOUT',
        errorMessage: '投递处理超时，已恢复等待重试',
      },
    })
    const due = await this.prisma.messageDelivery.findMany({
      where: {
        channel: 'WECOM',
        status: { in: ['PENDING', 'FAILED'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_BATCH_SIZE,
      select: { id: true },
    })
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
    const claimed = await this.prisma.messageDelivery.updateMany({
      where: {
        id,
        status: { in: ['PENDING', 'FAILED'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      data: {
        status: 'SENDING',
        attempts: { increment: 1 },
        nextAttemptAt: null,
        errorCode: null,
        errorMessage: null,
      },
    })
    if (claimed.count !== 1) return
    const delivery = await this.prisma.messageDelivery.findUnique({ where: { id } })
    if (!delivery) return
    if (!delivery.externalSubject) {
      await this.fail(
        delivery,
        'EXTERNAL_USER_NOT_MAPPED',
        '接收人没有有效的企业微信成员映射',
        false,
      )
      return
    }
    try {
      const runtime = await this.integrations.getWeComRuntimeContext(delivery.tenantId)
      if (delivery.integrationId && delivery.integrationId !== runtime.integration.id) {
        await this.fail(delivery, 'INTEGRATION_CHANGED', '企业微信配置已变化，请手工重试', false)
        return
      }
      const result = await this.weComClient.sendTextMessage({
        ...runtime.credentials,
        toUser: delivery.externalSubject,
        content: this.buildContent(delivery),
      })
      if (result.success) {
        await this.prisma.messageDelivery.update({
          where: { id },
          data: {
            status: 'SUCCEEDED',
            providerMessageId: result.providerMessageId,
            sentAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        })
        return
      }
      await this.fail(
        delivery,
        result.providerCode === null ? 'WECOM_UNAVAILABLE' : `WECOM_${result.providerCode}`,
        result.message,
        result.transient,
      )
    } catch (error) {
      await this.fail(delivery, 'CHANNEL_UNAVAILABLE', this.errorMessage(error), true)
    }
  }

  private async fail(
    delivery: MessageDelivery,
    errorCode: string,
    errorMessage: string,
    transient: boolean,
  ): Promise<void> {
    const retryable = transient && delivery.attempts < delivery.maxAttempts
    const delay = RETRY_DELAYS_MS[Math.max(0, delivery.attempts - 1)] ?? RETRY_DELAYS_MS.at(-1)!
    await this.prisma.messageDelivery.update({
      where: { id: delivery.id },
      data: {
        status: retryable ? 'FAILED' : 'DEAD',
        nextAttemptAt: retryable ? new Date(Date.now() + delay) : null,
        errorCode: errorCode.slice(0, 100),
        errorMessage: errorMessage.slice(0, 500),
      },
    })
  }

  private buildContent(delivery: MessageDelivery): string {
    return [delivery.title, delivery.content, delivery.link]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2_048)
  }

  private toVO(delivery: MessageDelivery, userName: string | null): MessageDeliveryVO {
    return {
      id: delivery.id,
      channel: 'WECOM',
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
      nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
      providerMessageId: delivery.providerMessageId,
      errorCode: delivery.errorCode,
      errorMessage: delivery.errorMessage,
      sentAt: delivery.sentAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
  }
}
