import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { db } from './prisma/db.js'

/** NestJS DI wrapper around the Prisma ORM 8 process-level singleton. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client = db

  async onModuleDestroy() {
    await this.client.close()
  }
}
