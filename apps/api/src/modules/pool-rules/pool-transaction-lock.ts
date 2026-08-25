import { Prisma } from '../../generated/prisma/client'

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

export async function acquirePoolTransactionLocks(
  tx: Prisma.TransactionClient,
  keys: string[],
): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`,
    )
  }
}
