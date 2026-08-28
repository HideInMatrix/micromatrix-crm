import { Controller, Get, Param } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { RequireAnyPermissions } from '../common/decorators/require-permissions.decorator'
import { CustomersService } from './customers.service'

@ApiTags('客户负责人历史')
@ApiBearerAuth()
@Controller('account/owner/history')
export class AccountOwnerHistoryController {
  constructor(private readonly service: CustomersService) {}

  @Get('list/:customerId')
  @RequireAnyPermissions('customer:read', 'customerPool:read')
  @ApiOperation({ summary: '客户负责人历史列表' })
  list(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.service.ownerHistory(user, customerId)
  }
}
