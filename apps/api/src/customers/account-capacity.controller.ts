import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { LogOperation } from '../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CustomerPoolConfigService } from './customer-pool-config.service'
import {
  AccountCapacityAddDto,
  AccountCapacityUpdateDto,
} from './dto/account-pool-config.dto'

@ApiTags('客户库容设置')
@ApiBearerAuth()
@Controller('account-capacity')
export class AccountCapacityController {
  constructor(private readonly service: CustomerPoolConfigService) {}

  @Get('get')
  @RequirePermissions('system:module:update')
  @ApiOperation({ summary: '获取客户库容设置' })
  get(@CurrentUser() user: AuthUser) {
    return this.service.capacities(user)
  }

  @Post('add')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'addCustomerCapacity')
  @ApiOperation({ summary: '添加客户库容设置' })
  async add(@CurrentUser() user: AuthUser, @Body() dto: AccountCapacityAddDto) {
    await this.service.addCapacity(user, dto)
  }

  @Post('update')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'updateCustomerCapacity')
  @ApiOperation({ summary: '修改客户库容设置' })
  async update(@CurrentUser() user: AuthUser, @Body() dto: AccountCapacityUpdateDto) {
    await this.service.updateCapacity(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'deleteCustomerCapacity')
  @ApiOperation({ summary: '删除客户库容设置' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.deleteCapacity(user, id)
  }
}
