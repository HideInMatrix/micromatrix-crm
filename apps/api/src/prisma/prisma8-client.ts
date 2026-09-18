import { Temporal } from '@js-temporal/polyfill'
import postgres, { type PostgresClient } from '@prisma/orm-postgres/runtime'
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
  return postgres<Contract>({
    contractJson,
    url: connectionString,
  })
}
