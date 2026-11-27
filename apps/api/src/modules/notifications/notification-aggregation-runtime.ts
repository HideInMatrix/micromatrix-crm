import { resolveNotificationAggregationPolicy, type MessageLanguage } from '@micromatrix/shared'
import type { AggregationItemInput } from './notification-aggregation.store'
import { MESSAGE_TEMPLATE_RESOURCES } from './message-template.resources'

/** Transitional opt-in until authenticated PC/H5 detail and end-to-end acceptance. */
export function aggregationEnabled(): boolean {
  return process.env.CRM_NOTIFICATION_AGGREGATION === '1'
}

export function isAggregateEvent(event: string, type?: string): boolean {
  return resolveNotificationAggregationPolicy({ event, type }).aggregationMode !== 'NONE'
}

export function deliveryAggregationItem(
  row: {
    channel: string
    status: string
    tenantId: string
    userId: string | null
    integrationId: string | null
    externalSubject: string | null
    title: string
    content: string | null
    link: string | null
  },
  version: number | null,
  meta: Pick<
    AggregationItemInput,
    'intentId' | 'event' | 'type' | 'language' | 'occurredAt' | 'sourceType' | 'sourceId'
  >,
): AggregationItemInput | null {
  if (
    row.channel !== 'WECOM' ||
    row.status !== 'PENDING' ||
    !isAggregateEvent(meta.event, meta.type)
  )
    return null
  if (!row.userId || !row.integrationId || !row.externalSubject || version === null)
    throw new Error('Missing aggregation channel identity')
  return {
    ...meta,
    channel: 'WECOM',
    tenantId: row.tenantId,
    recipientId: row.userId,
    integrationId: row.integrationId,
    credentialVersion: version,
    externalSubject: row.externalSubject,
    title: row.title,
    content: row.content,
    link: row.link,
  }
}

export const AGGREGATED_SOURCE = 'NOTIFICATION_BATCH'

export function buildAggregationSummary(
  batch: { id: string; category: string; language: string },
  items: readonly {
    event: string
    _type: string
    title: string
    content: string | null
    link: string | null
    linkLabel: string | null
  }[],
) {
  if (!items.length) throw new Error('Empty notification batch')
  // Single-item batches are delayed too: no historical business payload
  // outside the authenticated detail endpoint.
  const language: MessageLanguage = batch.language === 'en-US' ? 'en-US' : 'zh-CN'
  const en = language === 'en-US'
  const titles: Record<string, [string, string]> = {
    LEAD_ACTIVITY: ['线索动态', 'Lead activity'],
    CUSTOMER_ACTIVITY: ['客户动态', 'Customer activity'],
    BUSINESS_TODO: ['业务待办', 'Business tasks'],
    INTERACTION: ['互动消息', 'Interactions'],
  }
  const name = Object.prototype.hasOwnProperty.call(titles, batch.category)
    ? titles[batch.category]![en ? 1 : 0]
    : en
      ? 'Business activity'
      : '业务动态'
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.event, (counts.get(item.event) ?? 0) + 1)
  const resources = MESSAGE_TEMPLATE_RESOURCES[language] as Record<string, { eventName: string }>
  const details = [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([event, count]) =>
        `${Object.prototype.hasOwnProperty.call(resources, event) ? resources[event]!.eventName : en ? 'Business notification' : '业务通知'}: ${count}`,
    )
  // Bounded UTF-8 payload including escaped HTML entities. Keep total even
  // when some per-event counts must be omitted from the card.
  let content = en ? `${items.length} notifications` : `共 ${items.length} 条通知`
  for (const detail of details) {
    const next = content + '\n' + detail
    if (
      Buffer.byteLength(
        next.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        'utf8',
      ) > 450
    ) {
      content += en ? '\nMore in details' : '\n其余请查看明细'
      break
    }
    content = next
  }
  return {
    event: 'AGGREGATED:' + batch.category,
    type: 'system',
    title: name,
    content,
    link: '/notifications/batches/' + encodeURIComponent(batch.id),
    linkLabel: en ? 'View details' : '查看明细',
  }
}
