import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { ContractStageService } from './contract-stage.service'
import {
  ContractStageAddDto,
  ContractStageAdvancedConfigDto,
  ContractStageRollbackDto,
  ContractStageUpdateDto,
} from './dto/contract-stage.dto'

@ApiTags('合同状态流设置')
@ApiBearerAuth()
@Controller('contract/stage')
export class ContractStageController {
  constructor(private readonly service: ContractStageService) {}

  @Get('get')
  @ApiOperation({ summary: '合同状态配置列表' })
  get(@CurrentUser() user: AuthUser) {
    return this.service.get(user)
  }

  @Post('add')
  @RequirePermissions('system:module')
  @LogOperation('contractStage', 'create')
  @ApiOperation({ summary: '添加合同状态流' })
  add(@CurrentUser() user: AuthUser, @Body() dto: ContractStageAddDto) {
    return this.service.add(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('system:module')
  @LogOperation('contractStage', 'delete')
  @ApiOperation({ summary: '删除合同状态流' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('update-rollback')
  @RequirePermissions('system:module')
  @LogOperation('contractStage', 'updateRollback')
  @ApiOperation({ summary: '合同状态流回退设置' })
  updateRollback(@CurrentUser() user: AuthUser, @Body() dto: ContractStageRollbackDto) {
    return this.service.updateRollback(user, dto)
  }

  @Post('update')
  @RequirePermissions('system:module')
  @LogOperation('contractStage', 'update')
  @ApiOperation({ summary: '更新合同阶段配置' })
  update(@CurrentUser() user: AuthUser, @Body() dto: ContractStageUpdateDto) {
    return this.service.update(user, dto)
  }

  @Post('sort')
  @RequirePermissions('system:module')
  @LogOperation('contractStage', 'sort')
  @ApiOperation({ summary: '合同阶段排序' })
  sort(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    return this.service.sort(user, ids)
  }

  @Get('circulation-type/:type')
  @RequirePermissions('system:module')
  @LogOperation('contractStage', 'circulationType')
  @ApiOperation({ summary: '基础/高级流转切换' })
  circulationType(@CurrentUser() user: AuthUser, @Param('type') type: string) {
    return this.service.switchCirculationType(user, type)
  }

  @Post('advanced/config')
  @RequirePermissions('system:module')
  @LogOperation('contractStage', 'advancedConfig')
  @ApiOperation({ summary: '合同流转配置保存' })
  advancedConfig(@CurrentUser() user: AuthUser, @Body() dto: ContractStageAdvancedConfigDto) {
    return this.service.saveAdvancedConfig(user, dto)
  }
}
