import { Injectable, Logger } from '@nestjs/common'
import { type MessageTaskEvent, type NotificationBizType } from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import { NotificationsService } from './notifications.service'

export interface BusinessNotificationInput {
  tenantId: string
  event: MessageTaskEvent
  operatorId?: string
  recipientIds: Array<string | null | undefined>
  excludeSelf?: boolean
  type: NotificationBizType
  title: string
  content?: string
  link?: string
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
      const users = await this.prisma.user.findMany({
        where: {
          tenantId: input.tenantId,
          status: 'ACTIVE',
          id: { in: candidateIds },
        },
        select: { id: true },
      })
      const userIds = users.map((user) => user.id)
      if (userIds.length === 0) return 0
      await this.notifications.notifyMany(input.tenantId, userIds, {
        event: input.event,
        type: input.type,
        title: input.title,
        content: input.content,
        link: input.link,
      })
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
