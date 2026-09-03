import { randomUUID } from 'node:crypto'
import {
  Injectable,
  Logger,
  Optional,
  type MessageEvent,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { type MessageTaskEvent, NotificationBizType, NotificationVO } from '@micromatrix/shared'
import { finalize, interval, map, merge, Observable, Subject } from 'rxjs'
import { Notification } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import {
  NOTIFICATION_REALTIME_CHANNEL,
  NOTIFICATION_REALTIME_VERSION,
  parseNotificationRealtimeEvent,
  type NotificationRealtimeEvent,
} from './notification-realtime'

export interface NotifyInput {
  type: NotificationBizType
  title: string
  content?: string
  link?: string
  event?: MessageTaskEvent
}

const NOTIFICATION_CACHE_TTL_SECONDS = 30
const NOTIFICATION_VERSION_TTL_SECONDS = 5 * 60
const SSE_HEARTBEAT_MS = 15_000
const RECENT_EVENT_TTL_MS = 60_000
const RECENT_EVENT_LIMIT = 2_000
const REALTIME_WARN_INTERVAL_MS = 30_000

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name)
  private readonly instanceId = randomUUID()
  /** 每个在线用户一组 SSE 流（同一用户可能开多个页签） */
  private readonly streams = new Map<string, Set<Subject<MessageEvent>>>()
  private readonly recentEvents = new Map<string, number>()
  private unsubscribeRealtime: (() => Promise<void>) | null = null
  private lastRealtimeWarningAt = 0
  private readonly realtimeMetrics = {
    published: 0,
    publishFailures: 0,
    received: 0,
    localCreated: 0,
    localRefresh: 0,
    sourceIgnored: 0,
    duplicateDropped: 0,
    invalidDropped: 0,
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageSettings: MessageSettingsService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.redis) return
    this.unsubscribeRealtime = await this.redis.subscribe(NOTIFICATION_REALTIME_CHANNEL, (message) =>
      this.consumeRealtimeMessage(message),
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribeRealtime?.()
    this.unsubscribeRealtime = null
  }

  realtimeSnapshot() {
    return {
      localUsers: this.streams.size,
      localConnections: [...this.streams.values()].reduce((sum, subjects) => sum + subjects.size, 0),
      ...this.realtimeMetrics,
    }
  }

  subscribe(userId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>()
    const set = this.streams.get(userId) ?? new Set()
    set.add(subject)
    this.streams.set(userId, set)

    const heartbeat = interval(SSE_HEARTBEAT_MS).pipe(
      map(
        (): MessageEvent => ({
          type: 'heartbeat',
          data: { time: new Date().toISOString() },
        }),
      ),
    )
    return merge(subject.asObservable(), heartbeat).pipe(
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
    const event: NotificationRealtimeEvent = {
      version: NOTIFICATION_REALTIME_VERSION,
      eventId: notification.id,
      sourceInstanceId: this.instanceId,
      type: 'CREATED',
      tenantId,
      userId,
      occurredAt: new Date().toISOString(),
      notification: this.toVO(notification),
    }
    this.deliverRealtimeEvent(event)
    await this.publishRealtimeEvent(event)
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
    const result = await this.prisma.notification.updateMany({
      where: { id, tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    })
    if (result.count > 0) {
      await this.bumpCacheVersion(tenantId, userId)
      const event = this.stateChangedEvent(tenantId, userId)
      this.deliverRealtimeEvent(event)
      await this.publishRealtimeEvent(event)
    }
    return { id }
  }

  async markAllRead(tenantId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    })
    if (result.count > 0) {
      await this.bumpCacheVersion(tenantId, userId)
      const event = this.stateChangedEvent(tenantId, userId)
      this.deliverRealtimeEvent(event)
      await this.publishRealtimeEvent(event)
    }
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

  private stateChangedEvent(tenantId: string, userId: string): NotificationRealtimeEvent {
    return {
      version: NOTIFICATION_REALTIME_VERSION,
      eventId: randomUUID(),
      sourceInstanceId: this.instanceId,
      type: 'STATE_CHANGED',
      tenantId,
      userId,
      occurredAt: new Date().toISOString(),
    }
  }

  private async publishRealtimeEvent(event: NotificationRealtimeEvent): Promise<void> {
    const delivered = await this.redis?.publish(NOTIFICATION_REALTIME_CHANNEL, JSON.stringify(event))
    if (delivered === null || delivered === undefined || delivered === 0) {
      this.realtimeMetrics.publishFailures += 1
      return
    }
    this.realtimeMetrics.published += 1
  }

  private consumeRealtimeMessage(message: string): void {
    const event = parseNotificationRealtimeEvent(message)
    if (!event) {
      this.realtimeMetrics.invalidDropped += 1
      this.warnRealtime('收到无法识别的 Redis 通知实时事件，已丢弃')
      return
    }
    this.realtimeMetrics.received += 1
    if (event.sourceInstanceId === this.instanceId) {
      this.realtimeMetrics.sourceIgnored += 1
      return
    }
    this.deliverRealtimeEvent(event)
  }

  private deliverRealtimeEvent(event: NotificationRealtimeEvent): void {
    if (this.isDuplicateRealtimeEvent(event.eventId)) {
      this.realtimeMetrics.duplicateDropped += 1
      return
    }
    if (event.type === 'CREATED') {
      this.pushCreatedLocal(event.userId, event.notification)
      return
    }
    this.pushRefreshLocal(event.userId)
  }

  private isDuplicateRealtimeEvent(eventId: string): boolean {
    const now = Date.now()
    const previous = this.recentEvents.get(eventId)
    if (previous !== undefined && now - previous <= RECENT_EVENT_TTL_MS) return true
    this.recentEvents.set(eventId, now)
    if (this.recentEvents.size > RECENT_EVENT_LIMIT) {
      for (const [id, timestamp] of this.recentEvents) {
        if (now - timestamp > RECENT_EVENT_TTL_MS || this.recentEvents.size > RECENT_EVENT_LIMIT) {
          this.recentEvents.delete(id)
        }
      }
    }
    return false
  }

  private pushCreatedLocal(userId: string, notification: NotificationVO): void {
    const subjects = this.streams.get(userId)
    if (!subjects) return
    this.realtimeMetrics.localCreated += 1
    const event: MessageEvent = { data: notification }
    for (const subject of subjects) subject.next(event)
  }

  private pushRefreshLocal(userId: string): void {
    const subjects = this.streams.get(userId)
    if (!subjects) return
    this.realtimeMetrics.localRefresh += 1
    const event: MessageEvent = {
      type: 'refresh',
      data: { reason: 'notifications-changed' },
    }
    for (const subject of subjects) subject.next(event)
  }

  private warnRealtime(message: string): void {
    const now = Date.now()
    if (now - this.lastRealtimeWarningAt < REALTIME_WARN_INTERVAL_MS) return
    this.lastRealtimeWarningAt = now
    this.logger.warn(message)
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
