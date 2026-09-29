import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { db } from './prisma/db.js'

/** NestJS DI wrapper around the Prisma ORM 8 process-level singleton. */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client = db

  async onModuleInit() {
    await this.client.connect()
    await this.verifyConnection()
  }

  async onModuleDestroy() {
    await this.client.close()
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
