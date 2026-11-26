import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuthUser } from '../auth-user'
import type { PrismaService } from '../../prisma.service'

type ActiveOwner = { id: string; deptId: string | null } | null
type OwnerFilter = { owner?: string | { in: string[] } }
type Reads = {
  owners: Map<string, Promise<ActiveOwner>>
  memberIds: Map<string, Promise<string[]>>
  scopes: WeakMap<AuthUser, Map<string, Promise<OwnerFilter>>>
}
const storage = new AsyncLocalStorage<Reads>()

/** A single pre-transaction operation. Invoke run only around read preparation,
 * never around a transaction, authorization middleware, or configuration mutation. */
export function createBusinessPreparationReads() {
  const reads: Reads = { owners: new Map(), memberIds: new Map(), scopes: new WeakMap() }
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return storage.run(reads, task)
    },
  }
}

function memo<K, V>(map: Map<K, Promise<V>>, key: K, load: () => Promise<V>) {
  const existing = map.get(key)
  if (existing) return existing
  const pending = Promise.resolve().then(load)
  map.set(key, pending)
  void pending.catch(() => {
    if (map.get(key) === pending) map.delete(key)
  })
  return pending
}

export function readActiveBusinessOwner(prisma: PrismaService, tenantId: string, ownerId: string) {
  const load = async () =>
    prisma.client.orm.public.Users.where({ id: ownerId, tenantId, status: 'ACTIVE' })
      .select('id', 'deptId')
      .first()
  const reads = storage.getStore()
  return reads ? memo(reads.owners, JSON.stringify([tenantId, ownerId]), load) : load()
}

export function memoPreparationOwnerFilter(
  user: AuthUser,
  permission: string,
  load: () => Promise<OwnerFilter>,
): Promise<OwnerFilter> {
  const reads = storage.getStore()
  if (!reads) return load()
  let filters = reads.scopes.get(user)
  if (!filters) {
    filters = new Map()
    reads.scopes.set(user, filters)
  }
  return memo(filters, permission, load)
}

export function memoPreparationMemberIds(
  tenantId: string,
  provider: string,
  externalId: string,
  load: () => Promise<string[]>,
): Promise<string[]> {
  const reads = storage.getStore()
  return reads
    ? memo(reads.memberIds, JSON.stringify([tenantId, provider, externalId]), load)
    : load()
}
