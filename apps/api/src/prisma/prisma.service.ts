import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createPrismaClient, type PrismaClient } from './prisma-client.js'

/** Canonical PostgreSQL ORM runtime for the API application. */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private runtimeClient?: PrismaClient
  private readonly connectionString: string

  constructor(config: ConfigService) {
    this.connectionString = config.getOrThrow<string>('DATABASE_URL')
  }

  get client(): PrismaClient {
    if (!this.runtimeClient) {
      throw new Error('Prisma client is not initialized yet')
    }
    return this.runtimeClient
  }

  async onModuleInit() {
    this.runtimeClient = await createPrismaClient(this.connectionString)
    await this.runtimeClient.connect()
    await this.verifyConnection()
  }

  async onModuleDestroy() {
    await this.runtimeClient?.close()
    this.runtimeClient = undefined
  }

  private async verifyConnection(): Promise<void> {
    const client = this.client
    const query = client.raw.sql`SELECT '1'::text AS ok`.returnsRow({ ok: 'pg/text@1' })
    for await (const row of client.runtime().query(query.build())) {
      if (row.ok === '1') return
    }
    throw new Error('Prisma database startup probe returned no rows')
  }
}
