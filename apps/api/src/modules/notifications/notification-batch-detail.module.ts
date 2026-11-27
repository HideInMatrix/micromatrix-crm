import { Controller, Get, Header, Module, Param, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CustomersModule } from '../../customers/customers.module'
import { FollowUpPlansModule } from '../follow-up-plans/follow-up-plans.module'
import { FollowUpsModule } from '../follow-ups/follow-ups.module'
import { PrismaModule } from '../../prisma.module'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthUser } from '../../common/auth-user'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { NotificationBatchDetailService } from './notification-batch-detail.service'

@ApiTags('消息通知')
@ApiBearerAuth()
@Controller('notifications/batches')
export class NotificationBatchDetailController {
  constructor(private readonly detail: NotificationBatchDetailService) {}
  @Get(':id/items')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '本人聚合通知明细（实时业务权限校验）' })
  list(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.detail.list(user, id, query.page ?? 1, query.pageSize ?? 20)
  }
}

// API-only module: do not pull customer/follow-up controllers into Worker.
@Module({
  imports: [PrismaModule, CustomersModule, FollowUpPlansModule, FollowUpsModule],
  controllers: [NotificationBatchDetailController],
  providers: [NotificationBatchDetailService],
})
export class NotificationBatchDetailModule {}
