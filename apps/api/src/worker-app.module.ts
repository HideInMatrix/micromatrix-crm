import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './auth/auth.module'
import { CommonModule } from './common/common.module'
import { ApprovalsModule } from './modules/approvals/approvals.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { Prisma8Module } from './prisma/prisma8.module.js'
import { RedisModule } from './redis/redis.module'
import { ExportWorkerModule } from './workers/export-worker.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    Prisma8Module,
    RedisModule,
    CommonModule,
    ApprovalsModule,
    NotificationsModule,
    ExportWorkerModule,
  ],
})
export class WorkerAppModule {}
