import { Temporal } from '@js-temporal/polyfill'
import postgres, { type PostgresClient } from '@prisma/orm-postgres/runtime'
import contractJson from './generated/contract.json'
import type { Contract } from './generated/contract.js'

export type PrismaClient = PostgresClient<Contract>

type TemporalGlobal = typeof globalThis & {
  Temporal?: typeof Temporal
}

/**
 * Prisma PostgreSQL temporal codecs use the Temporal API. Node 25 currently
 * does not expose Temporal globally, so register the standards-compatible
 * polyfill before creating the Prisma runtime.
 */
export function ensureTemporalRuntime() {
  const runtimeGlobal = globalThis as TemporalGlobal
  runtimeGlobal.Temporal ??= Temporal
}

export async function createPrismaClient(connectionString: string): Promise<PrismaClient> {
  ensureTemporalRuntime()
  return postgres<Contract>({
    contractJson,
    url: connectionString,
  })
}
