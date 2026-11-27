import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from './auth/auth.module'
import { CommonModule } from './common/common.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { PrismaModule } from './prisma.module.js'
import { RedisModule } from './redis/redis.module'
import { ExportWorkerModule } from './workers/export-worker.module'
import { NotificationLifecycleWorkerService } from './workers/notification-lifecycle-worker.service'
import { NotificationLifecycleService } from './modules/notifications/notification-lifecycle.service'
import { NotificationAggregationWorkerService } from './workers/notification-aggregation-worker.service'
import { ExternalEventNotificationWorkerService } from './workers/external-event-notification-worker.service'
import { PoolRecycleWorkerModule } from './workers/pool-recycle-worker.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    PrismaModule,
    RedisModule,
    CommonModule,
    NotificationsModule,
    ExportWorkerModule,
    PoolRecycleWorkerModule,
  ],
  providers: [
    ExternalEventNotificationWorkerService,
    NotificationAggregationWorkerService,
    NotificationLifecycleService,
    NotificationLifecycleWorkerService,
  ],
})
export class WorkerAppModule {}
