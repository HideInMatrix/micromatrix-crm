import { createHash } from 'node:crypto'
import type { PrismaClient } from '../../prisma/db'

type Tx = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

export function notificationRecipientLock(tenantId: string, recipientId: string): string {
  return (
    'notification-recipient:' +
    createHash('sha256')
      .update(JSON.stringify([tenantId, recipientId]))
      .digest('hex')
  )
}

export async function lockNotificationRecipient(
  client: PrismaClient,
  tx: Tx,
  tenantId: string,
  recipientId: string,
): Promise<void> {
  const key = notificationRecipientLock(tenantId, recipientId)
  const query = client.raw
    .sql`SELECT 1::int4 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key},0))`.returnsRow(
    { locked: 'pg/int4@1' },
  )
  for await (const _row of tx.query(query.build())) break
}

export async function tryNotificationLock(
  client: PrismaClient,
  tx: Tx,
  key: string,
): Promise<boolean> {
  const query = client.raw
    .sql`SELECT CASE WHEN pg_try_advisory_xact_lock(hashtextextended(${key},0)) THEN 1 ELSE 0 END::int4 AS locked`.returnsRow(
    { locked: 'pg/int4@1' },
  )
  for await (const row of tx.query(query.build())) return row.locked === 1
  return false
}
