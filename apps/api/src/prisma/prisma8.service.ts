import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createPrisma8Client, type Prisma8Client } from './prisma8-client.js'

/**
 * Prisma 8 side-by-side runtime.
 *
 * P2/P3 migration stages intentionally keep this service outside AppModule.
 * Feature modules opt in only when their Prisma 8 migration task is ready.
 */
@Injectable()
export class Prisma8Service implements OnModuleInit, OnModuleDestroy {
  private runtimeClient?: Prisma8Client
  private readonly connectionString: string

  constructor(config: ConfigService) {
    this.connectionString = config.getOrThrow<string>('DATABASE_URL')
  }

  get client(): Prisma8Client {
    if (!this.runtimeClient) {
      throw new Error('Prisma 8 client is not initialized yet')
    }
    return this.runtimeClient
  }

  async onModuleInit() {
    this.runtimeClient = await createPrisma8Client(this.connectionString)
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
    throw new Error('Prisma 8 database startup probe returned no rows')
  }
}
