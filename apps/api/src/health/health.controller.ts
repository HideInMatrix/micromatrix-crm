import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { AsyncJobsService } from '../async-jobs/async-jobs.service'
import { Public } from '../common/decorators/public.decorator'
import { DistributedCoordinatorService } from '../common/services/distributed-coordinator.service'
import { TenantDerivedCacheService } from '../common/services/tenant-derived-cache.service'
import { NotificationsService } from '../modules/notifications/notifications.service'
import { RedisService } from '../redis/redis.service'

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(
    private readonly redis: RedisService,
    private readonly cache: TenantDerivedCacheService,
    private readonly notifications: NotificationsService,
    private readonly coordinator: DistributedCoordinatorService,
    private readonly asyncJobs: AsyncJobsService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '服务健康检查' })
  async check() {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      redis: {
        enabled: this.redis.enabled,
        ready: this.redis.ready,
        pubsub: this.redis.pubSubSnapshot(),
      },
      cache: this.cache.snapshot(),
      coordination: this.coordinator.snapshot(),
      asyncJobs: await this.asyncJobs.snapshot(),
      notificationRealtime: this.notifications.realtimeSnapshot(),
    }
  }
}
