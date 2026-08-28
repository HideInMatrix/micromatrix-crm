import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  OpportunityStageAddDto,
  OpportunityStageEditDto,
  OpportunityStageRollbackDto,
} from './dto/opportunity.dto'
import { OpportunitiesService } from './opportunities.service'

@ApiTags('商机阶段设置')
@ApiBearerAuth()
@Controller('opportunity/stage')
export class OpportunityStageController {
  constructor(private readonly service: OpportunitiesService) {}

  @Get('get')
  @ApiOperation({ summary: '商机阶段配置列表' })
  get(@CurrentUser() user: AuthUser) {
    return this.service.getStageConfig(user)
  }

  @Post('add')
  @RequirePermissions('system:module')
  @LogOperation('opportunityStage', 'create')
  @ApiOperation({ summary: '添加商机阶段' })
  add(@CurrentUser() user: AuthUser, @Body() dto: OpportunityStageAddDto) {
    return this.service.addStageConfig(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('system:module')
  @LogOperation('opportunityStage', 'delete')
  @ApiOperation({ summary: '删除商机阶段' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeStage(user, id)
  }

  @Post('update-rollback')
  @RequirePermissions('system:module')
  @LogOperation('opportunityStage', 'updateRollback')
  @ApiOperation({ summary: '商机阶段回退设置' })
  updateRollback(@CurrentUser() user: AuthUser, @Body() dto: OpportunityStageRollbackDto) {
    return this.service.updateStageRollback(user, dto)
  }

  @Post('update')
  @RequirePermissions('system:module')
  @LogOperation('opportunityStage', 'update')
  @ApiOperation({ summary: '更新商机阶段配置' })
  update(@CurrentUser() user: AuthUser, @Body() dto: OpportunityStageEditDto) {
    return this.service.updateStageConfig(user, dto)
  }

  @Post('sort')
  @RequirePermissions('system:module')
  @LogOperation('opportunityStage', 'sort')
  @ApiOperation({ summary: '商机阶段排序' })
  sort(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    return this.service.sortStageIds(user, ids)
  }
}
