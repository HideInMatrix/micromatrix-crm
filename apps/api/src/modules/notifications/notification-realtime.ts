import type { NotificationVO } from '@micromatrix/shared'

export const NOTIFICATION_REALTIME_CHANNEL = 'notifications'
export const NOTIFICATION_REALTIME_VERSION = 1 as const

interface NotificationRealtimeBase {
  version: typeof NOTIFICATION_REALTIME_VERSION
  eventId: string
  sourceInstanceId: string
  tenantId: string
  userId: string
  occurredAt: string
}

export type NotificationRealtimeEvent =
  | (NotificationRealtimeBase & {
      type: 'CREATED'
      notification: NotificationVO
    })
  | (NotificationRealtimeBase & {
      type: 'STATE_CHANGED'
    })

export function parseNotificationRealtimeEvent(raw: string): NotificationRealtimeEvent | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  if (value['version'] !== NOTIFICATION_REALTIME_VERSION) return null
  if (!isNonEmptyString(value['eventId'])) return null
  if (!isNonEmptyString(value['sourceInstanceId'])) return null
  if (!isNonEmptyString(value['tenantId'])) return null
  if (!isNonEmptyString(value['userId'])) return null
  if (!isNonEmptyString(value['occurredAt'])) return null

  if (value['type'] === 'STATE_CHANGED') {
    return {
      version: NOTIFICATION_REALTIME_VERSION,
      eventId: value['eventId'],
      sourceInstanceId: value['sourceInstanceId'],
      type: 'STATE_CHANGED',
      tenantId: value['tenantId'],
      userId: value['userId'],
      occurredAt: value['occurredAt'],
    }
  }
  if (value['type'] !== 'CREATED' || !isNotification(value['notification'])) return null
  return {
    version: NOTIFICATION_REALTIME_VERSION,
    eventId: value['eventId'],
    sourceInstanceId: value['sourceInstanceId'],
    type: 'CREATED',
    tenantId: value['tenantId'],
    userId: value['userId'],
    occurredAt: value['occurredAt'],
    notification: value['notification'],
  }
}

function isNotification(value: unknown): value is NotificationVO {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value['id']) &&
    isNonEmptyString(value['type']) &&
    isNonEmptyString(value['title']) &&
    nullableString(value['content']) &&
    nullableString(value['link']) &&
    nullableString(value['readAt']) &&
    isNonEmptyString(value['createdAt'])
  )
}

function nullableString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === 'string'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
