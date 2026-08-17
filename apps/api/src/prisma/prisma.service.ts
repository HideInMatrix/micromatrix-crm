import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    // Prisma 7：通过驱动适配器直连 PostgreSQL
    super({
      adapter: new PrismaPg({ connectionString: config.getOrThrow<string>('DATABASE_URL') }),
    })
  }

  async onModuleInit() {
    await this.$connect()
    // Prisma 7 + driver adapter 的连接池可能是惰性建立的；执行一次轻量查询，
    // 让错误凭据/不可达数据库在 API 启动阶段直接暴露，而不是拖到首次业务请求才返回 500。
    await this.$queryRaw`SELECT 1`
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
