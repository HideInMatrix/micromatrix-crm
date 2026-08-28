import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { LogOperation } from '../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CustomerPoolConfigService } from './customer-pool-config.service'
import {
  AccountPoolAddDto,
  AccountPoolPageDto,
  AccountPoolUpdateDto,
} from './dto/account-pool-config.dto'

@ApiTags('客户公海设置')
@ApiBearerAuth()
@Controller('account-pool')
export class AccountPoolController {
  constructor(private readonly service: CustomerPoolConfigService) {}

  @Post('page')
  @RequirePermissions('system:module:update')
  @ApiOperation({ summary: '分页获取客户公海设置' })
  page(@CurrentUser() user: AuthUser, @Body() dto: AccountPoolPageDto) {
    return this.service.page(user, dto)
  }

  @Post('add')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'addCustomerPool')
  @ApiOperation({ summary: '新增客户公海' })
  async add(@CurrentUser() user: AuthUser, @Body() dto: AccountPoolAddDto) {
    await this.service.add(user, dto)
  }

  @Post('update')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'updateCustomerPool')
  @ApiOperation({ summary: '编辑客户公海' })
  async update(@CurrentUser() user: AuthUser, @Body() dto: AccountPoolUpdateDto) {
    await this.service.update(user, dto)
  }

  @Post('quick-update')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'quickUpdateCustomerPool')
  @ApiOperation({ summary: '快捷保存客户公海' })
  async quickUpdate(@CurrentUser() user: AuthUser, @Body() dto: AccountPoolUpdateDto) {
    await this.service.update(user, dto)
  }

  @Get('no-pick/:id')
  @RequirePermissions('system:module:update')
  @ApiOperation({ summary: '客户公海是否仍有未领取客户' })
  noPick(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.noPick(user, id)
  }

  @Get('delete/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'deleteCustomerPool')
  @ApiOperation({ summary: '删除客户公海' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.remove(user, id)
  }

  @Get('switch/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'switchCustomerPool')
  @ApiOperation({ summary: '启用或禁用客户公海' })
  async switchStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.switchStatus(user, id)
  }
}
