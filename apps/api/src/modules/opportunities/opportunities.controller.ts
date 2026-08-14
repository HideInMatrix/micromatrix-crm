import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  ChangeStageDto,
  CreateOpportunityDto,
  QueryOpportunitiesDto,
  ReorderStagesDto,
  StageDto,
  UpdateOpportunityDto,
  UpdateStageDto,
} from './dto/opportunity.dto'
import { OpportunitiesService } from './opportunities.service'

@ApiTags('商机')
@ApiBearerAuth()
@RequirePermissions('menu:opportunity')
@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  // ===== 阶段配置 =====

  @Get('stages')
  @ApiOperation({ summary: '商机阶段列表（首次访问初始化默认阶段）' })
  listStages(@CurrentUser() user: AuthUser) {
    return this.opportunitiesService.listStages(user.tenantId)
  }

  @Post('stages')
  @RequirePermissions('system:module')
  @LogOperation('opportunityStage', 'create')
  @ApiOperation({ summary: '新建阶段' })
  createStage(@CurrentUser() user: AuthUser, @Body() dto: StageDto) {
    return this.opportunitiesService.createStage(user, dto)
  }

  @Patch('stages/:id')
  @RequirePermissions('system:module')
  @LogOperation('opportunityStage', 'update')
  @ApiOperation({ summary: '更新阶段' })
  updateStage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateStageDto) {
    return this.opportunitiesService.updateStage(user, id, dto)
  }

  @Delete('stages/:id')
  @RequirePermissions('system:module')
  @LogOperation('opportunityStage', 'delete')
  @ApiOperation({ summary: '删除阶段' })
  removeStage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.opportunitiesService.removeStage(user, id)
  }

  @Post('stages/reorder')
  @RequirePermissions('system:module')
  @ApiOperation({ summary: '阶段排序' })
  reorderStages(@CurrentUser() user: AuthUser, @Body() dto: ReorderStagesDto) {
    return this.opportunitiesService.reorderStages(user, dto)
  }

  // ===== 商机 =====

  @Get('kanban')
  @ApiOperation({ summary: '看板视图（按阶段分组）' })
  kanban(@CurrentUser() user: AuthUser) {
    return this.opportunitiesService.kanban(user)
  }

  @Get()
  @ApiOperation({ summary: '商机列表' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryOpportunitiesDto) {
    return this.opportunitiesService.findAll(user, query)
  }

  @Get(':id/stage-logs')
  @ApiOperation({ summary: '阶段变更记录' })
  stageLogs(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.opportunitiesService.stageLogs(user, id)
  }

  @Get(':id')
  @ApiOperation({ summary: '商机详情（含产品明细）' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.opportunitiesService.findOne(user, id)
  }

  @Post()
  @RequirePermissions('opportunity:create')
  @LogOperation('opportunity', 'create')
  @ApiOperation({ summary: '新建商机' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOpportunityDto) {
    return this.opportunitiesService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('opportunity:update')
  @LogOperation('opportunity', 'update')
  @ApiOperation({ summary: '更新商机' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateOpportunityDto) {
    return this.opportunitiesService.update(user, id, dto)
  }

  @Post(':id/stage')
  @RequirePermissions('opportunity:stage')
  @LogOperation('opportunity', 'changeStage')
  @ApiOperation({ summary: '推进/变更阶段（赢单/输单）' })
  changeStage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ChangeStageDto) {
    return this.opportunitiesService.changeStage(user, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('opportunity:delete')
  @LogOperation('opportunity', 'delete')
  @ApiOperation({ summary: '删除商机' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.opportunitiesService.remove(user, id)
  }
}
