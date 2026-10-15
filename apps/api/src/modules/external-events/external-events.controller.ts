import { Body, Controller, Post } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { ApiKeyOnly } from '../../common/decorators/api-key-only.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import {
  ApplyExternalCustomerEventDto,
  ExecuteConfiguredExternalEventDto,
} from './dto/external-event.dto'
import { ExternalEventsService } from './external-events.service'

@ApiTags('外部事件')
@ApiKeyOnly()
@ApiHeader({ name: 'X-Access-Key', required: true })
@ApiHeader({ name: 'X-Secret-Key', required: true })
@Controller('external-events')
export class ExternalEventsController {
  constructor(private readonly events: ExternalEventsService) {}

  @Post('execute')
  @ApiOperation({ summary: '按管理员启用的事件模板完成单次 CRM 业务操作' })
  execute(@CurrentUser() user: AuthUser, @Body() dto: ExecuteConfiguredExternalEventDto) {
    return this.events.executeConfigured(user, dto)
  }

  @Post('customer-sync')
  @ApiOperation({ summary: '按动态字段定位 Customer/Lead 并原子同步 Customer 动态字段' })
  customerSync(@CurrentUser() user: AuthUser, @Body() dto: ApplyExternalCustomerEventDto) {
    return this.events.applyCustomerEvent(user, dto)
  }
}
