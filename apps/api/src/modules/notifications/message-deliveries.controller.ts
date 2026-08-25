import { Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { QueryMessageDeliveriesDto } from './dto/message-delivery.dto'
import { MessageDeliveryService } from './message-delivery.service'

@ApiTags('消息投递审计')
@ApiBearerAuth()
@Controller('message-deliveries')
export class MessageDeliveriesController {
  constructor(private readonly deliveries: MessageDeliveryService) {}

  @Get()
  @RequirePermissions('system:message')
  @ApiOperation({ summary: '分页查询企业微信消息投递记录' })
  list(@CurrentUser() user: AuthUser, @Query() query: QueryMessageDeliveriesDto) {
    return this.deliveries.list(user.tenantId, query)
  }

  @Post(':id/retry')
  @RequirePermissions('system:message:update')
  @LogOperation('messageDelivery', 'retry')
  @ApiOperation({ summary: '手工重试失败的企业微信消息投递' })
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deliveries.retry(user.tenantId, id)
  }
}
