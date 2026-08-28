import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { LogOperation } from '../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CustomersService } from './customers.service'
import {
  SaveCustomerRelationDto,
  UpdateCustomerRelationDto,
} from './dto/customer-relation.dto'

@ApiTags('客户关系')
@ApiBearerAuth()
@Controller('account/relation')
export class AccountRelationController {
  constructor(private readonly service: CustomersService) {}

  @Get('list/:customerId')
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: '客户关系列表' })
  list(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.service.relationList(user, customerId)
  }

  @Post('add/:customerId')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'relationAdd')
  add(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Body() dto: SaveCustomerRelationDto,
  ) {
    return this.service.relationAdd(user, customerId, dto.customerId, dto.relationType)
  }

  @Post('update/:customerId')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'relationUpdate')
  update(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Body() dto: UpdateCustomerRelationDto,
  ) {
    return this.service.relationUpdate(
      user,
      customerId,
      dto.id,
      dto.customerId,
      dto.relationType,
    )
  }

  @Get('delete/:id')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'relationDelete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.relationRemoveById(user, id)
  }

  @Post('save/:customerId')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'relationSave')
  save(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Body() relations: SaveCustomerRelationDto[],
  ) {
    return this.service.relationReplace(user, customerId, relations)
  }
}
