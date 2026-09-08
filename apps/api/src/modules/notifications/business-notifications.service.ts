import { Injectable, Logger, Optional } from '@nestjs/common'
import {
  type MessageLanguage,
  type MessageTaskEvent,
  type NotificationBizType,
} from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import { NotificationsService } from './notifications.service'
import { MessageDeliveryService } from './message-delivery.service'
import { MessageTemplateService } from './message-template.service'

export interface BusinessNotificationInput {
  tenantId: string
  event: MessageTaskEvent
  operatorId?: string
  recipientIds: Array<string | null | undefined>
  excludeSelf?: boolean
  type: NotificationBizType
  title?: string
  content?: string
  link?: string
  templateContext?: Record<string, unknown>
  language?: MessageLanguage
}

export interface ConfiguredBusinessNotificationInput extends Omit<
  BusinessNotificationInput,
  'recipientIds'
> {
  ownerId?: string | null
  createUserId?: string | null
}

@Injectable()
export class BusinessNotificationsService {
  private readonly logger = new Logger(BusinessNotificationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly messageSettings: MessageSettingsService,
    @Optional() private readonly deliveries?: MessageDeliveryService,
    private readonly templates?: MessageTemplateService,
  ) {}

  async send(input: BusinessNotificationInput): Promise<number> {
    try {
      const candidateIds = [
        ...new Set(
          input.recipientIds.filter(
            (id): id is string => Boolean(id) && !(input.excludeSelf && id === input.operatorId),
          ),
        ),
      ]
      if (candidateIds.length === 0) return 0
      const [users, operator] = await Promise.all([
        this.prisma.user.findMany({
          where: {
            tenantId: input.tenantId,
            status: 'ACTIVE',
            id: { in: candidateIds },
          },
          select: { id: true },
        }),
        input.operatorId
          ? this.prisma.user.findFirst({
              where: { id: input.operatorId, tenantId: input.tenantId },
              select: { name: true, language: true },
            })
          : null,
      ])
      const userIds = users.map((user) => user.id)
      if (userIds.length === 0) return 0
      const templateContext = {
        ...(operator?.name && !('OPERATOR' in (input.templateContext ?? {}))
          ? { OPERATOR: operator.name }
          : {}),
        ...(input.templateContext ?? {}),
      }
      const rendered = this.templates
        ? await this.templates.render(
            input.tenantId,
            input.event,
            templateContext,
            input.language ?? operator?.language ?? 'zh-CN',
          )
        : null
      const title = input.title ?? rendered?.title
      const content = input.content ?? rendered?.content
      if (!title) throw new Error(`消息事件 ${input.event} 缺少标题模板`)
      await this.notifications.notifyMany(input.tenantId, userIds, {
        event: input.event,
        type: input.type,
        title,
        content,
        link: input.link,
      })
      if (input.event && this.deliveries) {
        await this.deliveries
          .enqueue({
            tenantId: input.tenantId,
            event: input.event,
            recipientIds: userIds,
            title,
            content,
            link: input.link,
          })
          .catch((error) =>
            this.logger.warn(
              `企业微信消息入队失败 event=${input.event}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          )
      }
      return userIds.length
    } catch (error) {
      this.logger.warn(
        `业务消息发送失败 event=${input.event}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return 0
    }
  }

  async sendConfigured(input: ConfiguredBusinessNotificationInput): Promise<number> {
    try {
      const recipientIds = await this.messageSettings.resolveRecipients(
        input.tenantId,
        input.event,
        { ownerId: input.ownerId, createUserId: input.createUserId },
      )
      return this.send({ ...input, recipientIds })
    } catch (error) {
      this.logger.warn(
        `配置消息发送失败 event=${input.event}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return 0
    }
  }
}
