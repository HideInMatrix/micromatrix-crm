import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from '../common/decorators/public.decorator'
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
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '服务健康检查' })
  check() {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      redis: {
        enabled: this.redis.enabled,
        ready: this.redis.ready,
        pubsub: this.redis.pubSubSnapshot(),
      },
      cache: this.cache.snapshot(),
      notificationRealtime: this.notifications.realtimeSnapshot(),
    }
  }
}
