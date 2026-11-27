import { MESSAGE_TASK_DEFINITIONS } from '@micromatrix/shared'
import type { PrismaClient } from '../../prisma/db'
import { nowInstant } from '../../prisma/temporal'
import { isAggregateEvent } from './notification-aggregation-runtime'

type Tx = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
type BatchScope = { id: string; tenantId: string; recipientId: string; channel: string }
type Item = {
  id: string
  event: string
  _type: string
  suppressedAt: ReturnType<typeof nowInstant> | null
}
type Reason =
  | 'CHANNEL_EVENT_DISABLED'
  | 'RECIPIENT_UNAVAILABLE'
  | 'CHANNEL_IDENTITY_CHANGED'
  | 'UNSUPPORTED_EVENT'

/** Source rows are immutable except for the one-way suppression marker. */
export async function projectAggregationItems<T extends Item>(
  tx: Tx,
  batch: BatchScope,
  items: readonly T[],
  forcedReason?: Reason,
): Promise<T[]> {
  const orm = tx.orm.public
  const active = items.filter((row) => !row.suppressedAt)
  if (!active.length) return []
  let reason = forcedReason
  if (!reason) {
    const [tenant, recipient] = await Promise.all([
      orm.Tenants.where({ id: batch.tenantId, status: 'ACTIVE' }).select('id').first(),
      orm.Users.where({ id: batch.recipientId, tenantId: batch.tenantId, status: 'ACTIVE' })
        .select('id')
        .first(),
    ])
    if (!tenant || !recipient) reason = 'RECIPIENT_UNAVAILABLE'
  }
  const settings = reason
    ? []
    : await orm.MessageTaskSettings.where({ tenantId: batch.tenantId })
        .where((row) => row.event.in([...new Set(active.map((item) => item.event))]))
        .select('event', 'module', 'systemEnabled', 'weComEnabled')
        .all()
  const enabled: T[] = []
  const excluded = new Map<Reason, string[]>()
  for (const item of active) {
    let exclude = reason
    if (!exclude) {
      const definition = MESSAGE_TASK_DEFINITIONS.find((row) => row.event === item.event)
      if (!definition || !isAggregateEvent(item.event, item._type)) exclude = 'UNSUPPORTED_EVENT'
      else {
        const setting = settings.find(
          (row) => row.event === item.event && row.module === definition.module,
        )
        const allowed =
          batch.channel === 'SYSTEM'
            ? (setting?.systemEnabled ?? definition.defaultSystemEnabled)
            : batch.channel === 'WECOM'
              ? (setting?.weComEnabled ?? false)
              : false
        if (!allowed) exclude = 'CHANNEL_EVENT_DISABLED'
      }
    }
    if (exclude) {
      const ids = excluded.get(exclude) ?? []
      ids.push(item.id)
      excluded.set(exclude, ids)
    } else enabled.push(item)
  }
  const now = nowInstant()
  for (const [suppressionReason, ids] of excluded) {
    const count = await orm.NotificationItem.where({ batchId: batch.id })
      .where((row) => row.id.in(ids))
      .where((row) => row.suppressedAt.isNull())
      .updateAndCount({ suppressedAt: now, suppressionReason })
    if (count !== ids.length) throw Error('Notification suppression conflict')
  }
  return enabled
}
