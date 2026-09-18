import type { EnterpriseIntegrationProvider } from '@micromatrix/shared'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'

type Row = Record<string, any>

function matches(row: Row, where: Row) {
  return Object.entries(where).every(([key, value]) => row[key] === value)
}

function selected(row: Row, fields: string[]) {
  return fields.length ? Object.fromEntries(fields.map((field) => [field, row[field]])) : row
}

export function createIntegrationPrismaHarness(activeProvider: EnterpriseIntegrationProvider) {
  const rows: Row[] = []
  const syncBatches: Row[] = []
  const tenant: Row = {
    id: 'tenant-a',
    enterpriseSyncResource: activeProvider,
    enterpriseSynced: false,
    updatedAt: nowInstant(),
  }

  const integrations = (
    where: Row = {},
    fields: string[] = [],
    predicates: Array<(row: Row) => boolean> = [],
  ): any => ({
    where(next: Row | ((model: any) => (row: Row) => boolean)) {
      if (typeof next === 'function') {
        const predicate = next({
          provider: { neq: (value: string) => (row: Row) => row.provider !== value },
        })
        return integrations(where, fields, [...predicates, predicate])
      }
      return integrations({ ...where, ...next }, fields, predicates)
    },
    select: (...next: string[]) => integrations(where, next, predicates),
    async first() {
      const row = rows.find((item) => matches(item, where) && predicates.every((fn) => fn(item)))
      return row ? selected(row, fields) : null
    },
    async create(data: Row) {
      const now = nowInstant()
      const row: Row = {
        id: `integration-${rows.length + 1}`,
        clientId: null,
        redirectUrl: null,
        syncDefaultRoleId: null,
        lastTestSucceeded: null,
        lastTestMessage: null,
        lastTestedAt: null,
        lastSyncStatus: null,
        lastSyncMessage: null,
        lastSyncedAt: null,
        createdAt: now,
        ...data,
        updatedAt: data.updatedAt ?? now,
      }
      rows.push(row)
      return row
    },
    async update(data: Row) {
      const row = rows.find((item) => matches(item, where) && predicates.every((fn) => fn(item)))
      if (!row) return null
      Object.assign(row, data)
      return row
    },
    async updateAll(data: Row) {
      let count = 0
      for (const row of rows) {
        if (!matches(row, where) || !predicates.every((fn) => fn(row))) continue
        Object.assign(row, data)
        count += 1
      }
      return count
    },
  })

  const tenants = (where: Row = {}, fields: string[] = []): any => ({
    where: (next: Row) => tenants({ ...where, ...next }, fields),
    select: (...next: string[]) => tenants(where, next),
    async first() {
      return matches(tenant, where) ? selected(tenant, fields) : null
    },
    async update(data: Row) {
      if (!matches(tenant, where)) return null
      Object.assign(tenant, data)
      return tenant
    },
    async updateAll(data: Row) {
      if (!matches(tenant, where)) return 0
      Object.assign(tenant, data)
      return 1
    },
  })

  const roles = (where: Row = {}, fields: string[] = []): any => ({
    where: (next: Row) => roles({ ...where, ...next }, fields),
    select: (...next: string[]) => roles(where, next),
    async first() {
      const row = where.id === 'role-a' && where.tenantId === tenant.id ? { id: 'role-a' } : null
      return row ? selected(row, fields) : null
    },
  })

  const batches = (where: Row = {}): any => ({
    where: (next: Row) => batches({ ...where, ...next }),
    async updateAll(data: Row) {
      let count = 0
      for (const row of syncBatches) {
        if (!matches(row, where)) continue
        Object.assign(row, data)
        count += 1
      }
      return count
    },
  })

  const publicOrm = {
    EnterpriseIntegrations: integrations(),
    Tenants: tenants(),
    Roles: roles(),
    OrganizationSyncBatches: batches(),
  }
  const emptyQuery = {
    async *[Symbol.asyncIterator]() {
      yield { locked: 'ok' }
    },
  }
  const raw = {
    sql: (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
      returnsRow: (_codec: unknown) => ({ build: () => ({}) }),
    }),
  }
  const client = {
    orm: { public: publicOrm },
    raw,
    transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback({ orm: { public: publicOrm }, query: () => emptyQuery }),
  }

  return {
    prisma: { client } as unknown as PrismaService,
    rows,
    tenant,
    syncBatches,
  }
}
