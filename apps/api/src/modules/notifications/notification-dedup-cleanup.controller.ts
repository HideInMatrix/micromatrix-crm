import { Body, Controller, Get, Header, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsBoolean, IsInt, Matches, Min, Max } from 'class-validator'
import { Transform } from 'class-transformer'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { NotificationDedupCleanupService } from './notification-dedup-cleanup.service'

class ConfirmNotificationDedupCleanupDto {
  // Global ValidationPipe enables implicit conversion: Boolean("false") is true.
  // Preserve the original JSON value so only a literal boolean can confirm.
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  confirm!: boolean
  @IsInt()
  @Min(1)
  @Max(5000)
  count!: number
  @Matches(/^[a-f0-9]{64}$/)
  fingerprint!: string
}

@ApiTags('聚合去重凭据维护')
@ApiBearerAuth()
@Controller('notification-dedup')
@RequirePermissions('system:message', 'system:message:update')
export class NotificationDedupCleanupController {
  constructor(private readonly cleanupService: NotificationDedupCleanupService) {}
  @Get('cleanup-preview')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '预览当前租户可清理去重凭据' })
  preview(@CurrentUser() user: AuthUser) {
    return this.cleanupService.preview(user)
  }
  @Post('cleanup')
  @ApiOperation({ summary: '明确确认后清理预览范围内的去重凭据' })
  cleanup(@CurrentUser() user: AuthUser, @Body() dto: ConfirmNotificationDedupCleanupDto) {
    return this.cleanupService.cleanup(user, dto)
  }
}
