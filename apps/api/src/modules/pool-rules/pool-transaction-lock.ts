import type { Prisma8Client } from '../../prisma/prisma8-client.js'

type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]

export type PoolDomain = 'clue' | 'customer'

export function poolTransactionLockKeys(
  domain: PoolDomain,
  organizationId: string,
  resourceId: string,
  ownerId: string,
): string[] {
  return [
    `pool:${domain}:${organizationId}:resource:${resourceId}`,
    `pool:${domain}:${organizationId}:owner:${ownerId}`,
  ].sort()
}

export async function acquirePoolTransactionLocksPrisma8(
  client: Prisma8Client,
  tx: Prisma8Transaction,
  keys: string[],
): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    const query = client.raw.sql`
      SELECT 1::int4 AS locked
      FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))
    `.returnsRow({ locked: 'pg/int4@1' })
    for await (const _row of tx.query(query.build())) break
  }
}
