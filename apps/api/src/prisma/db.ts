import 'dotenv/config'
import postgres, { type PostgresClient } from '@prisma/orm-postgres/runtime'
import contractJson from './contract.json'
import type { Contract } from './contract.js'
import { ensureTemporalRuntime } from './temporal.js'

export type PrismaClient = PostgresClient<Contract>

/**
 * Prisma ORM 8 application singleton.
 *
 * `postgres(...)` returns a plain client object. Keep exactly one instance per
 * Node.js process so each API/worker process owns exactly one connection pool
 * for its lifetime. Isolated tests may still use `createPrismaClient()` directly.
 */
const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) throw new Error('DATABASE_URL 未配置')

ensureTemporalRuntime()

export const db: PrismaClient = postgres<Contract>({
  contractJson,
  url: databaseUrl,
})
