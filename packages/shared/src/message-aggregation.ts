import type { MessageLanguage, MessageTaskEvent } from './message-settings'

export type NotificationAggregationMode = 'NONE' | 'SAME_EVENT' | 'SAME_CATEGORY'
export type NotificationCategory =
  | 'LEAD_ACTIVITY'
  | 'CUSTOMER_ACTIVITY'
  | 'BUSINESS_TODO'
  | 'INTERACTION'
  | 'SYSTEM_SECURITY'
  | 'IMPORTANT'
  | 'UNKNOWN'

export interface NotificationAggregationPolicy {
  readonly category: NotificationCategory
  readonly aggregationGroup: string
  readonly priority: 'NORMAL' | 'HIGH'
  readonly aggregationMode: NotificationAggregationMode
  readonly aggregationWindowMs: number
  readonly maxItems: number
}

export const DEFAULT_NOTIFICATION_AGGREGATION_MODE = 'SAME_CATEGORY' as const
export const DEFAULT_NOTIFICATION_AGGREGATION_WINDOW_MS = 5_000
export const DEFAULT_NOTIFICATION_AGGREGATION_MAX_ITEMS = 500

type EventClassification = {
  category: NotificationCategory
  mode?: NotificationAggregationMode
  priority?: NotificationAggregationPolicy['priority']
}

/** Every registered event must be deliberately classified; no prefix/title inference. */
const EVENT_CLASSIFICATIONS = {
  CLUE_ADD: { category: 'LEAD_ACTIVITY' },
  EXTERNAL_EVENT_LEAD_UPDATED: { category: 'LEAD_ACTIVITY' },
  CLUE_MOVED_POOL: { category: 'LEAD_ACTIVITY' },
  CLUE_CONVERT_CUSTOMER: { category: 'LEAD_ACTIVITY' },
  TRANSFER_CLUE: { category: 'LEAD_ACTIVITY' },
  CLUE_DELETED: { category: 'LEAD_ACTIVITY' },
  CLUE_DISTRIBUTED: { category: 'LEAD_ACTIVITY' },

  CUSTOMER_ADD: { category: 'CUSTOMER_ACTIVITY' },
  EXTERNAL_EVENT_CUSTOMER_UPDATED: { category: 'CUSTOMER_ACTIVITY' },
  CUSTOMER_TRANSFERRED_CUSTOMER: { category: 'CUSTOMER_ACTIVITY' },
  CUSTOMER_MOVED_HIGH_SEAS: { category: 'CUSTOMER_ACTIVITY' },
  CUSTOMER_DELETED: { category: 'CUSTOMER_ACTIVITY' },
  HIGH_SEAS_CUSTOMER_DISTRIBUTED: { category: 'CUSTOMER_ACTIVITY' },

  CLUE_FOLLOW_UP_OVERDUE: { category: 'BUSINESS_TODO' },
  CLUE_AUTOMATIC_MOVE_POOL: { category: 'BUSINESS_TODO' },
  CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS: { category: 'BUSINESS_TODO' },
  CLUE_FOLLOW_UP_PLAN_DUE: { category: 'BUSINESS_TODO' },
  CUSTOMER_FOLLOW_UP_PLAN_DUE: { category: 'BUSINESS_TODO' },

  CUSTOMER_COLLABORATION_ADD: { category: 'INTERACTION' },
  CLUE_FOLLOW_UP_PLAN_COMMENT_ADDED: { category: 'INTERACTION' },
  CUSTOMER_FOLLOW_UP_PLAN_COMMENT_ADDED: { category: 'INTERACTION' },
  CLUE_FOLLOW_UP_RECORD_COMMENT_ADDED: { category: 'INTERACTION' },
  CUSTOMER_FOLLOW_UP_RECORD_COMMENT_ADDED: { category: 'INTERACTION' },
  CLUE_FOLLOW_UP_PLAN_COMMENT_MENTIONED: { category: 'INTERACTION', mode: 'NONE' },
  CUSTOMER_FOLLOW_UP_PLAN_COMMENT_MENTIONED: { category: 'INTERACTION', mode: 'NONE' },
  CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED: { category: 'INTERACTION', mode: 'NONE' },
  CUSTOMER_FOLLOW_UP_RECORD_COMMENT_MENTIONED: { category: 'INTERACTION', mode: 'NONE' },
} satisfies Record<MessageTaskEvent, EventClassification>

const CATEGORY_MODES: Readonly<Record<NotificationCategory, NotificationAggregationMode>> = {
  LEAD_ACTIVITY: DEFAULT_NOTIFICATION_AGGREGATION_MODE,
  CUSTOMER_ACTIVITY: DEFAULT_NOTIFICATION_AGGREGATION_MODE,
  BUSINESS_TODO: DEFAULT_NOTIFICATION_AGGREGATION_MODE,
  INTERACTION: DEFAULT_NOTIFICATION_AGGREGATION_MODE,
  SYSTEM_SECURITY: 'NONE',
  IMPORTANT: 'NONE',
  UNKNOWN: 'NONE',
}

function resolvePolicy(classification: EventClassification): NotificationAggregationPolicy {
  const aggregationMode = classification.mode ?? CATEGORY_MODES[classification.category]
  return {
    category: classification.category,
    aggregationGroup: classification.category,
    priority: classification.priority ?? (aggregationMode === 'NONE' ? 'HIGH' : 'NORMAL'),
    aggregationMode,
    aggregationWindowMs:
      aggregationMode === 'NONE' ? 0 : DEFAULT_NOTIFICATION_AGGREGATION_WINDOW_MS,
    maxItems: aggregationMode === 'NONE' ? 1 : DEFAULT_NOTIFICATION_AGGREGATION_MAX_ITEMS,
  }
}

/**
 * Explicit event wins over legacy presentation type (e.g. conversion uses system).
 * Announcements always bypass aggregation. Unclassified events fail closed.
 */
export function resolveNotificationAggregationPolicy(input: {
  event?: string | null
  type?: string | null
}): NotificationAggregationPolicy {
  if (input.type === 'announcement') return resolvePolicy({ category: 'IMPORTANT' })
  if (input.event && Object.prototype.hasOwnProperty.call(EVENT_CLASSIFICATIONS, input.event)) {
    return resolvePolicy(EVENT_CLASSIFICATIONS[input.event as MessageTaskEvent])
  }
  return resolvePolicy({
    category: !input.event && input.type === 'system' ? 'SYSTEM_SECURITY' : 'UNKNOWN',
  })
}

type AggregationChannelScope =
  | { channel: 'SYSTEM' }
  | {
      channel: 'WECOM'
      integrationId: string
      credentialVersion: number
      externalSubject: string
    }
  | { channel: 'DINGTALK' | 'LARK' }

export type NotificationAggregationScope = AggregationChannelScope & {
  tenantId: string
  recipientId: string
  language: MessageLanguage
  event: string
  /** Use a database-derived receive timestamp in the persistence layer. */
  receivedAtMs: number
}

/**
 * Deterministic logical scope for the persistence layer, not a claim or lock.
 * The database must still enforce uniqueness, shard limits and sealing.
 * Do not log the returned identity (it can contain recipient identifiers).
 */
export function notificationAggregationIdentity(
  scope: NotificationAggregationScope,
  policy: NotificationAggregationPolicy,
): { key: string; windowStartMs: number; windowEndMs: number } | null {
  if (policy.aggregationMode === 'NONE' || policy.priority !== 'NORMAL') return null
  if (scope.channel !== 'SYSTEM' && scope.channel !== 'WECOM') return null
  if (
    !scope.tenantId ||
    !scope.recipientId ||
    !scope.event ||
    !['zh-CN', 'en-US'].includes(scope.language) ||
    !Number.isSafeInteger(scope.receivedAtMs) ||
    scope.receivedAtMs < 0 ||
    !Number.isSafeInteger(policy.aggregationWindowMs) ||
    policy.aggregationWindowMs <= 0
  ) {
    return null
  }
  const channelIdentity: Array<string | number> = [scope.channel]
  if (scope.channel === 'WECOM') {
    if (
      !scope.integrationId ||
      !scope.externalSubject ||
      !Number.isSafeInteger(scope.credentialVersion) ||
      scope.credentialVersion < 0
    )
      return null
    channelIdentity.push(scope.integrationId, scope.credentialVersion, scope.externalSubject)
  }
  const windowStartMs =
    Math.floor(scope.receivedAtMs / policy.aggregationWindowMs) * policy.aggregationWindowMs
  return {
    key: JSON.stringify([
      scope.tenantId,
      scope.recipientId,
      ...channelIdentity,
      policy.category,
      policy.aggregationGroup,
      policy.priority,
      policy.aggregationMode,
      scope.language,
      policy.aggregationMode === 'SAME_EVENT' ? scope.event : '',
      policy.aggregationWindowMs,
      windowStartMs,
    ]),
    windowStartMs,
    windowEndMs: windowStartMs + policy.aggregationWindowMs,
  }
}

// Recipient-scoped, freshly authorized projection. Never expose raw items directly.
export interface NotificationBatchItemVO {
  id: string
  event: string
  eventName: string
  occurredAt: string
  accessible: boolean
  title: string | null
  content: string | null
  link: string | null
  linkLabel: string | null
}

export interface NotificationBatchDetailVO {
  id: string
  category: NotificationCategory
  channel: 'SYSTEM' | 'WECOM'
  title: string
  windowStart: string
  windowEnd: string
  total: number
  page: number
  pageSize: number
  items: NotificationBatchItemVO[]
}
