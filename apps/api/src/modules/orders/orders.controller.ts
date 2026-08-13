import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { OrderStatus } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { ChangeOrderStatusDto, CreateOrderDto, QueryOrdersDto, UpdateOrderDto } from './dto/order.dto'
import { OrdersService } from './orders.service'

@ApiTags('订单')
@ApiBearerAuth()
@RequirePermissions('menu:order')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: '订单列表' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryOrdersDto) {
    return this.ordersService.findAll(user, query)
  }

  @Post()
  @RequirePermissions('order:create')
  @LogOperation('order', 'create')
  @ApiOperation({ summary: '新建订单（关联生效合同）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('order:update')
  @LogOperation('order', 'update')
  @ApiOperation({ summary: '更新订单' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.ordersService.update(user, id, dto)
  }

  @Post(':id/status')
  @RequirePermissions('order:update')
  @LogOperation('order', 'changeStatus')
  @ApiOperation({ summary: '订单状态流转' })
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ChangeOrderStatusDto,
  ) {
    return this.ordersService.changeStatus(user, id, dto.status as OrderStatus)
  }

  @Delete(':id')
  @RequirePermissions('order:delete')
  @LogOperation('order', 'delete')
  @ApiOperation({ summary: '删除订单' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ordersService.remove(user, id)
  }
}
