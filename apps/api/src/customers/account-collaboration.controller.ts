import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { LogOperation } from '../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CustomersService } from './customers.service'
import {
  AccountCollaborationAddDto,
  AccountCollaborationUpdateDto,
} from './dto/account.dto'

@ApiTags('客户协作人')
@ApiBearerAuth()
@Controller('account/collaboration')
export class AccountCollaborationController {
  constructor(private readonly service: CustomersService) {}

  @Get('list/:customerId')
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: '客户协作人列表' })
  list(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.service.teamList(user, customerId)
  }

  @Post('add')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'collaborationAdd')
  add(@CurrentUser() user: AuthUser, @Body() dto: AccountCollaborationAddDto) {
    return this.service.teamAdd(
      user,
      dto.customerId,
      dto.userId,
      undefined,
      dto.collaborationType,
    )
  }

  @Post('update')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'collaborationUpdate')
  update(@CurrentUser() user: AuthUser, @Body() dto: AccountCollaborationUpdateDto) {
    return this.service.collaborationUpdate(user, dto.id, dto.collaborationType)
  }

  @Get('delete/:id')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'collaborationDelete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.collaborationRemove(user, id)
  }

  @Post('batch/delete')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'collaborationBatchDelete')
  batchRemove(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    if (!Array.isArray(ids) || !ids.length) throw new BadRequestException('请选择协作成员')
    return this.service.collaborationBatchRemove(user, ids)
  }
}
