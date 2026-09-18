import { Temporal } from '@js-temporal/polyfill'
import type { PostgresClient } from '@prisma/orm-postgres/runtime'
import contractJson from './generated/contract.json'
import type { Contract } from './generated/contract.js'

export type Prisma8Client = PostgresClient<Contract>

type TemporalGlobal = typeof globalThis & {
  Temporal?: typeof Temporal
}

/**
 * Prisma 8 PostgreSQL temporal codecs use the Temporal API. Node 25 currently
 * does not expose Temporal globally, so register the standards-compatible
 * polyfill before creating the Prisma 8 runtime.
 */
export function ensurePrisma8Temporal() {
  const runtimeGlobal = globalThis as TemporalGlobal
  runtimeGlobal.Temporal ??= Temporal
}

export async function createPrisma8Client(connectionString: string): Promise<Prisma8Client> {
  ensurePrisma8Temporal()
  // The existing Nest API is compiled as CommonJS while Prisma 8 runtime is ESM-only.
  // Keep the application module format unchanged and cross the boundary with native import().
  const { default: postgres } = await import('@prisma/orm-postgres/runtime')
  return postgres<Contract>({
    contractJson,
    url: connectionString,
  })
}
