import { Injectable, type MessageEvent } from '@nestjs/common'
import { type MessageTaskEvent, NotificationBizType, NotificationVO } from '@micromatrix/shared'
import { finalize, Observable, Subject } from 'rxjs'
import { Notification } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { MessageSettingsService } from '../message-settings/message-settings.service'

export interface NotifyInput {
  type: NotificationBizType
  title: string
  content?: string
  link?: string
  event?: MessageTaskEvent
}

@Injectable()
export class NotificationsService {
  /** 每个在线用户一组 SSE 流（同一用户可能开多个页签） */
  private readonly streams = new Map<string, Set<Subject<MessageEvent>>>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageSettings: MessageSettingsService,
  ) {}

  subscribe(userId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>()
    const set = this.streams.get(userId) ?? new Set()
    set.add(subject)
    this.streams.set(userId, set)

    return subject.asObservable().pipe(
      finalize(() => {
        set.delete(subject)
        if (set.size === 0) this.streams.delete(userId)
      }),
    )
  }

  /** 发送单人通知（落库 + 在线推送） */
  async notify(tenantId: string, userId: string, input: NotifyInput): Promise<void> {
    if (input.event && !(await this.messageSettings.isSystemEnabled(tenantId, input.event))) return
    await this.notifyUnchecked(tenantId, userId, input)
  }

  private async notifyUnchecked(
    tenantId: string,
    userId: string,
    input: NotifyInput,
  ): Promise<void> {
    const { event: _event, ...data } = input
    const notification = await this.prisma.notification.create({
      data: { tenantId, userId, ...data },
    })
    this.push(userId, notification)
  }

  /** 批量通知多个用户 */
  async notifyMany(tenantId: string, userIds: string[], input: NotifyInput): Promise<void> {
    if (input.event && !(await this.messageSettings.isSystemEnabled(tenantId, input.event))) return
    const unique = [...new Set(userIds)]
    await Promise.all(unique.map((userId) => this.notifyUnchecked(tenantId, userId, input)))
  }

  async list(
    tenantId: string,
    userId: string,
    page: number,
    pageSize: number,
    unreadOnly: boolean,
  ) {
    const where = {
      tenantId,
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ])
    return { items: items.map((n) => this.toVO(n)), total, page, pageSize }
  }

  async unreadCount(tenantId: string, userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { tenantId, userId, readAt: null },
    })
    return { count }
  }

  async markRead(tenantId: string, userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    })
    return { id }
  }

  async markAllRead(tenantId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    })
    return { count: result.count }
  }

  private push(userId: string, notification: Notification): void {
    const subjects = this.streams.get(userId)
    if (!subjects) return
    const event: MessageEvent = { data: this.toVO(notification) }
    for (const subject of subjects) subject.next(event)
  }

  private toVO(n: Notification): NotificationVO {
    return {
      id: n.id,
      type: n.type as NotificationBizType,
      title: n.title,
      content: n.content,
      link: n.link,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }
  }
}
