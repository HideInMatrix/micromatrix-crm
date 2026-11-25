import type { PrismaClient } from '../../prisma/db.js'

type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

export type PoolDomain = 'clue' | 'customer'

export const poolOwnerLockKey = (domain: PoolDomain, organizationId: string, ownerId: string) =>
  `pool:${domain}:${organizationId}:owner:${ownerId}`
export const poolResourceLockKey = (
  domain: PoolDomain,
  organizationId: string,
  resourceId: string,
) => `pool:${domain}:${organizationId}:resource:${resourceId}`
export const poolCapacityConfigLockKey = (domain: PoolDomain, organizationId: string) =>
  `pool:${domain}:${organizationId}:capacity-config`

export function poolTransactionLockKeys(
  domain: PoolDomain,
  organizationId: string,
  resourceId: string,
  ownerId: string,
): string[] {
  return [
    poolResourceLockKey(domain, organizationId, resourceId),
    poolOwnerLockKey(domain, organizationId, ownerId),
  ].sort()
}

/** Ownership increases take shared config lock before owner/resource locks; rule edits take exclusive. */
export async function acquirePoolCapacityConfigReadLock(
  client: PrismaClient,
  tx: PrismaTransaction,
  domain: PoolDomain,
  organizationId: string,
): Promise<void> {
  const key = poolCapacityConfigLockKey(domain, organizationId)
  const query = client.raw.sql`
    SELECT 1::int4 AS locked FROM pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))
  `.returnsRow({ locked: 'pg/int4@1' })
  for await (const _row of tx.query(query.build())) break
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
