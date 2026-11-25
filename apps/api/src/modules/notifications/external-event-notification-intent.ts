import type { BusinessNotificationInput } from './business-notifications.service'

export type ExternalNotificationEvent = 'CLUE_ADD' | 'CUSTOMER_ADD' | 'CLUE_CONVERT_CUSTOMER'
export interface ExternalEventNotificationIntent {
  inboxId: string
  tenantId: string
  operatorId: string
  recipientId: string
  event: ExternalNotificationEvent
  resourceName: string
  link: string
}

export function externalEventNotificationIntent(
  context: Pick<ExternalEventNotificationIntent, 'inboxId' | 'tenantId' | 'operatorId'>,
  event: ExternalNotificationEvent,
  recipientId: string | null | undefined,
  resourceName: string,
  resourceId: string,
): ExternalEventNotificationIntent[] {
  if (!recipientId || recipientId === context.operatorId) return []
  return [
    {
      ...context,
      event,
      recipientId,
      resourceName,
      link: event === 'CLUE_ADD' ? `/leads?id=${resourceId}` : `/customers?id=${resourceId}`,
    },
  ]
}

export function externalEventNotificationInput(
  job: Omit<ExternalEventNotificationIntent, 'event'> & { event: string },
): BusinessNotificationInput {
  const event = job.event
  if (event !== 'CLUE_ADD' && event !== 'CUSTOMER_ADD' && event !== 'CLUE_CONVERT_CUSTOMER') {
    throw new Error('Unsupported external event notification')
  }
  return {
    tenantId: job.tenantId,
    operatorId: job.operatorId,
    recipientIds: [job.recipientId],
    excludeSelf: true,
    event,
    type: event === 'CLUE_ADD' ? 'assign' : 'system',
    templateContext: { name: job.resourceName },
    link: job.link,
  }
}
