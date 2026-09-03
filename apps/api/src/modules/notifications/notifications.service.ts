import { Injectable, Optional, type MessageEvent } from '@nestjs/common'
import { type MessageTaskEvent, NotificationBizType, NotificationVO } from '@micromatrix/shared'
import { finalize, Observable, Subject } from 'rxjs'
import { Notification } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { MessageSettingsService } from '../message-settings/message-settings.service'

export interface NotifyInput {
  type: NotificationBizType
  title: string
  content?: string
  link?: string
  event?: MessageTaskEvent
}

const NOTIFICATION_CACHE_TTL_SECONDS = 30
const NOTIFICATION_VERSION_TTL_SECONDS = 5 * 60

@Injectable()
export class NotificationsService {
  /** 每个在线用户一组 SSE 流（同一用户可能开多个页签） */
  private readonly streams = new Map<string, Set<Subject<MessageEvent>>>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageSettings: MessageSettingsService,
    @Optional() private readonly redis?: RedisService,
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
    await this.bumpCacheVersion(tenantId, userId)
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
    const version = await this.cacheVersion(tenantId, userId)
    const cacheKey = this.listCacheKey(tenantId, userId, version, page, pageSize, unreadOnly)
    const cached = await this.redis?.getJson<{
      items: NotificationVO[]
      total: number
      page: number
      pageSize: number
    }>(cacheKey)
    if (cached) return cached

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
    const result = { items: items.map((n) => this.toVO(n)), total, page, pageSize }
    await this.redis?.setJson(cacheKey, result, NOTIFICATION_CACHE_TTL_SECONDS)
    return result
  }

  async unreadCount(tenantId: string, userId: string): Promise<{ count: number }> {
    const version = await this.cacheVersion(tenantId, userId)
    const cacheKey = this.unreadCacheKey(tenantId, userId, version)
    const cached = await this.redis?.getJson<{ count: number }>(cacheKey)
    if (cached) return cached

    const count = await this.prisma.notification.count({
      where: { tenantId, userId, readAt: null },
    })
    const result = { count }
    await this.redis?.setJson(cacheKey, result, NOTIFICATION_CACHE_TTL_SECONDS)
    return result
  }

  async markRead(tenantId: string, userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    })
    await this.bumpCacheVersion(tenantId, userId)
    return { id }
  }

  async markAllRead(tenantId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    })
    await this.bumpCacheVersion(tenantId, userId)
    return { count: result.count }
  }

  private async cacheVersion(tenantId: string, userId: string): Promise<string> {
    return (await this.redis?.get(this.versionKey(tenantId, userId))) ?? '0'
  }

  private async bumpCacheVersion(tenantId: string, userId: string): Promise<void> {
    await this.redis?.increment(this.versionKey(tenantId, userId), NOTIFICATION_VERSION_TTL_SECONDS)
  }

  private versionKey(tenantId: string, userId: string): string {
    return `notifications:version:${tenantId}:${userId}`
  }

  private unreadCacheKey(tenantId: string, userId: string, version: string): string {
    return `notifications:unread:${tenantId}:${userId}:v${version}`
  }

  private listCacheKey(
    tenantId: string,
    userId: string,
    version: string,
    page: number,
    pageSize: number,
    unreadOnly: boolean,
  ): string {
    return `notifications:list:${tenantId}:${userId}:v${version}:${page}:${pageSize}:${unreadOnly ? 1 : 0}`
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
