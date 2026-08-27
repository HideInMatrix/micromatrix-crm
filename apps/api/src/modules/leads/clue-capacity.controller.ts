import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { CluePoolConfigService } from './clue-pool-config.service'
import { ClueCapacityAddDto, ClueCapacityUpdateDto } from './dto/clue-pool-config.dto'

@ApiTags('线索库容设置')
@ApiBearerAuth()
@Controller('lead-capacity')
export class ClueCapacityController {
  constructor(private readonly service: CluePoolConfigService) {}

  @Get('get')
  @RequirePermissions('system:module:update')
  @ApiOperation({ summary: '获取线索库容设置' })
  get(@CurrentUser() user: AuthUser) {
    return this.service.capacities(user)
  }

  @Post('add')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'addClueCapacity')
  @ApiOperation({ summary: '添加线索库容设置' })
  async add(@CurrentUser() user: AuthUser, @Body() dto: ClueCapacityAddDto) {
    await this.service.addCapacity(user, dto)
  }

  @Post('update')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'updateClueCapacity')
  @ApiOperation({ summary: '修改线索库容设置' })
  async update(@CurrentUser() user: AuthUser, @Body() dto: ClueCapacityUpdateDto) {
    await this.service.updateCapacity(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'deleteClueCapacity')
  @ApiOperation({ summary: '删除线索库容设置' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.deleteCapacity(user, id)
  }
}
