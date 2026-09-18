import type { PrismaClient } from '../../prisma/prisma-client.js'

type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

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

export async function acquirePoolTransactionLocksPrisma(
  client: PrismaClient,
  tx: PrismaTransaction,
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
