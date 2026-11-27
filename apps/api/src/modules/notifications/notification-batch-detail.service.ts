import { Injectable, NotFoundException } from '@nestjs/common'
import {
  type MessageLanguage,
  type NotificationBatchDetailVO,
  type NotificationBatchItemVO,
  type NotificationCategory,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma.service'
import { instantToISOString } from '../../prisma/temporal'
import { MESSAGE_TEMPLATE_RESOURCES } from './message-template.resources'

const CATEGORIES: Record<string, [string, string]> = {
  LEAD_ACTIVITY: ['线索动态', 'Lead activity'],
  CUSTOMER_ACTIVITY: ['客户动态', 'Customer activity'],
  BUSINESS_TODO: ['业务待办', 'Business tasks'],
  INTERACTION: ['互动消息', 'Interactions'],
}

@Injectable()
export class NotificationBatchDetailService {
  constructor(private readonly prisma: PrismaService) {}

  // Authentication may be cached. A notification snapshot is readable only
  // by its active recipient in an active tenant, regardless of current
  // business-resource roles. The target business API still enforces access.
  private async assertActiveRecipient(auth: AuthUser): Promise<void> {
    const orm = this.prisma.client.orm.public
    const user = await orm.Users.where({ id: auth.id, tenantId: auth.tenantId, status: 'ACTIVE' })
      .select('id')
      .first()
    if (!user) throw new NotFoundException('通知批次不存在')
    const tenant = await orm.Tenants.where({ id: auth.tenantId, status: 'ACTIVE' })
      .select('id')
      .first()
    if (!tenant) throw new NotFoundException('通知批次不存在')
  }

  async list(
    auth: AuthUser,
    id: string,
    page = 1,
    pageSize = 20,
  ): Promise<NotificationBatchDetailVO> {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize)
    )
      throw new NotFoundException('通知批次不存在')
    const orm = this.prisma.client.orm.public
    const batch = await orm.NotificationBatch.where({
      id,
      tenantId: auth.tenantId,
      recipientId: auth.id,
    })
      .where((row) => row.sealedAt.isNotNull())
      .first()
    if (!batch || !batch.outputId || (batch.channel !== 'SYSTEM' && batch.channel !== 'WECOM'))
      throw new NotFoundException('通知批次不存在')
    await this.assertActiveRecipient(auth)
    // Channel-specific batch can be opened by its recipient even without a
    // corresponding SYSTEM notification. Reject missing/deleted outputs.
    const output =
      batch.channel === 'SYSTEM'
        ? await orm.Notifications.where({
            id: batch.outputId,
            tenantId: auth.tenantId,
            userId: auth.id,
          })
            .select('id')
            .first()
        : await orm.MessageDeliveries.where({
            id: batch.outputId,
            tenantId: auth.tenantId,
            userId: auth.id,
            channel: 'WECOM',
          })
            .select('id')
            .first()
    if (!output) throw new NotFoundException('通知批次不存在')
    const visible = () =>
      orm.NotificationItem.where({ batchId: batch.id }).where((row) => row.suppressedAt.isNull())
    const [rows, count] = await Promise.all([
      visible()
        .orderBy((row) => row.createdAt.asc())
        .orderBy((row) => row.id.asc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      visible().aggregate((agg) => ({ total: agg.count() })),
    ])
    // Archive may commit between the first batch read and the page read.
    // Re-read the marker; never expose a partial page for an archived batch.
    const current = await orm.NotificationBatch.where({
      id: batch.id,
      tenantId: auth.tenantId,
      recipientId: auth.id,
    })
      .select('detailsArchivedAt')
      .first()
    if (!current) throw new NotFoundException('通知批次不存在')
    const archivedAt = current.detailsArchivedAt
    const language: MessageLanguage = batch.language === 'en-US' ? 'en-US' : 'zh-CN'
    const resources = MESSAGE_TEMPLATE_RESOURCES[language] as Record<string, { eventName: string }>
    const items: NotificationBatchItemVO[] = []
    // Return the original recipient-scoped notification snapshot, not live
    // resource data. Navigation is sanitized separately from authorization.
    for (const row of archivedAt ? [] : rows) {
      const link = row.link ? this.safeLink(row.event, row.link) : null
      const eventName = Object.prototype.hasOwnProperty.call(resources, row.event)
        ? resources[row.event]!.eventName
        : language === 'en-US'
          ? 'Business notification'
          : '业务通知'
      items.push({
        id: row.id,
        event: row.event,
        eventName,
        occurredAt: instantToISOString(row.occurredAt),
        accessible: true, // compatibility: the notification itself is readable
        title: row.title,
        content: row.content,
        link,
        linkLabel: link
          ? row.linkLabel || (language === 'en-US' ? 'View resource' : '查看业务记录')
          : null,
      })
    }
    const title = Object.prototype.hasOwnProperty.call(CATEGORIES, batch.category)
      ? CATEGORIES[batch.category]![language === 'en-US' ? 1 : 0]
      : language === 'en-US'
        ? 'Business activity'
        : '业务动态'
    return {
      id: batch.id,
      category: batch.category as NotificationCategory,
      channel: batch.channel,
      title,
      windowStart: instantToISOString(batch.windowStart),
      windowEnd: instantToISOString(batch.windowEnd),
      detailsArchivedAt: archivedAt ? instantToISOString(archivedAt) : null,
      total: archivedAt ? 0 : count.total,
      page,
      pageSize,
      items,
    }
  }

  private safeLink(event: string, raw: string): string | null {
    // Only known internal, read-oriented routes; never expose arbitrary URLs.
    // Do not query the destination resource or pre-authorize its data scope.
    if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x20\x7f]/.test(raw)) return null
    let url: URL
    try {
      url = new URL(raw, 'https://notification.invalid')
    } catch {
      return null
    }
    if (url.origin !== 'https://notification.invalid' || url.hash) return null
    const path = url.pathname
    if (path !== '/leads' && path !== '/customers' && path !== '/follow-plans') return null
    const plan = event.includes('FOLLOW_UP_PLAN')
    const comment = event.includes('FOLLOW_UP_RECORD_COMMENT')
    if ((path === '/follow-plans') !== plan) return null
    const validId = (value: string | null): value is string =>
      !!value && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
    const keys = [...url.searchParams.keys()]
    // Existing notifications may link to the business list rather than a record.
    if (!keys.length) return comment ? null : path
    const allowed = comment ? ['id', 'followUpId', 'commentId'] : ['id']
    if (keys.some((key) => !allowed.includes(key)) || keys.length !== allowed.length) return null
    if (
      allowed.some(
        (key) => url.searchParams.getAll(key).length !== 1 || !validId(url.searchParams.get(key)),
      )
    )
      return null
    const params = new URLSearchParams()
    for (const key of allowed) params.set(key, url.searchParams.get(key)!)
    return path + '?' + params
  }
}
