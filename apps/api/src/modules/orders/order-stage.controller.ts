import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  OrderStageAddDto,
  OrderStageAdvancedConfigDto,
  OrderStageRollbackDto,
  OrderStageUpdateDto,
} from './dto/order-stage.dto'
import { OrderStageService } from './order-stage.service'

@ApiTags('订单状态流设置')
@ApiBearerAuth()
@Controller('order/stage')
export class OrderStageController {
  constructor(private readonly service: OrderStageService) {}

  @Get('get')
  @ApiOperation({ summary: '订单状态配置列表' })
  get(@CurrentUser() user: AuthUser) {
    return this.service.get(user)
  }

  @Post('add')
  @RequirePermissions('system:module')
  @LogOperation('orderStage', 'create')
  @ApiOperation({ summary: '添加订单状态流' })
  add(@CurrentUser() user: AuthUser, @Body() dto: OrderStageAddDto) {
    return this.service.add(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('system:module')
  @LogOperation('orderStage', 'delete')
  @ApiOperation({ summary: '删除订单状态流' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('update-rollback')
  @RequirePermissions('system:module')
  @LogOperation('orderStage', 'updateRollback')
  @ApiOperation({ summary: '订单状态流回退设置' })
  updateRollback(@CurrentUser() user: AuthUser, @Body() dto: OrderStageRollbackDto) {
    return this.service.updateRollback(user, dto)
  }

  @Post('update')
  @RequirePermissions('system:module')
  @LogOperation('orderStage', 'update')
  @ApiOperation({ summary: '更新订单阶段配置' })
  update(@CurrentUser() user: AuthUser, @Body() dto: OrderStageUpdateDto) {
    return this.service.update(user, dto)
  }

  @Post('sort')
  @RequirePermissions('system:module')
  @LogOperation('orderStage', 'sort')
  @ApiOperation({ summary: '订单阶段排序' })
  sort(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    return this.service.sort(user, ids)
  }

  @Get('circulation-type/:type')
  @RequirePermissions('system:module')
  @LogOperation('orderStage', 'circulationType')
  @ApiOperation({ summary: '基础/高级流转切换' })
  circulationType(@CurrentUser() user: AuthUser, @Param('type') type: string) {
    return this.service.switchCirculationType(user, type)
  }

  @Post('advanced/config')
  @RequirePermissions('system:module')
  @LogOperation('orderStage', 'advancedConfig')
  @ApiOperation({ summary: '订单高级流转配置保存' })
  advancedConfig(@CurrentUser() user: AuthUser, @Body() dto: OrderStageAdvancedConfigDto) {
    return this.service.saveAdvancedConfig(user, dto)
  }
}
