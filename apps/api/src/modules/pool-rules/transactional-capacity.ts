import { BadRequestException } from '@nestjs/common'
import { or } from '@prisma/orm-postgres/orm-client'
import type { PrismaClient } from '../../prisma/db'
import type { ExternalEventPerformance } from '../../common/external-event-performance'
import { loadUserScopeTokensPrisma, scopeMatches } from './pool-repository.helpers'
import {
  acquirePoolTransactionLocksPrisma,
  acquirePoolCapacityConfigReadLock,
  poolOwnerLockKey,
  type PoolDomain,
} from './pool-transaction-lock'

type Transaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

/** All active, unconverted leads, including historical NULL/empty transition markers. */
export function activeOwnedLeadQuery(
  tx: Transaction | PrismaClient,
  organizationId: string,
  ownerId: string,
) {
  return tx.orm.public.Clue.where({ organizationId, owner: ownerId, inSharedPool: false })
    .where((row) => or(row.transitionId.isNull(), row.transitionId.eq('')))
    .where((row) => or(row.transitionType.isNull(), row.transitionType.neq('CUSTOMER')))
}

export async function readOwnedCapacity(
  tx: Transaction | PrismaClient,
  domain: PoolDomain,
  organizationId: string,
  ownerId: string,
) {
  const query =
    domain === 'clue'
      ? await activeOwnedLeadQuery(tx, organizationId, ownerId).aggregate((agg) => ({
          count: agg.count(),
        }))
      : await tx.orm.public.Customer.where({
          organizationId,
          owner: ownerId,
          inSharedPool: false,
        }).aggregate((agg) => ({ count: agg.count() }))
  return query.count
}

/**
 * For direct creation, including conversion into a new customer.
 * A shared configuration lock stabilizes the rule set until commit.
 * With any finite rule in the tenant, use the same owner lock as pool ownership writes.
 * Do not bypass that lock merely because the owner's current scope does not match.
 * With no finite rules, different resources can proceed concurrently.
 */
export async function assertCreateCapacityInTransaction(
  client: PrismaClient,
  tx: Transaction,
  domain: PoolDomain,
  organizationId: string,
  ownerId: string,
  perf?: ExternalEventPerformance,
): Promise<void> {
  const measure = <T>(stage: string, task: () => Promise<T>) =>
    perf ? perf.measure(stage, task) : task()
  await measure('capacity_config_lock', () =>
    acquirePoolCapacityConfigReadLock(client, tx, domain, organizationId),
  )
  const rules = await measure('capacity_rule_read', async () =>
    domain === 'clue'
      ? tx.orm.public.ClueCapacity.where({ organizationId })
          .orderBy((row) => row.createTime.desc())
          .select('scopeId', 'capacity')
          .all()
      : tx.orm.public.CustomerCapacity.where({ organizationId })
          .orderBy((row) => row.createTime.desc())
          .select('scopeId', 'capacity')
          .all(),
  )
  if (!rules.some((rule) => rule.capacity !== null)) return
  await measure('capacity_owner_lock', () =>
    acquirePoolTransactionLocksPrisma(client, tx, [
      poolOwnerLockKey(domain, organizationId, ownerId),
    ]),
  )
  await measure('capacity_recheck', async () => {
    const tokens = await loadUserScopeTokensPrisma(tx, organizationId, ownerId)
    if (!tokens.size) throw new BadRequestException('负责人不存在或已禁用')
    const capacity = rules.find((rule) => scopeMatches(rule.scopeId, tokens))?.capacity
    if (capacity == null) return
    const owned = await readOwnedCapacity(tx, domain, organizationId, ownerId)
    if (owned + 1 > capacity) throw new BadRequestException('负责人持有数量将超过库容上限')
  })
}
