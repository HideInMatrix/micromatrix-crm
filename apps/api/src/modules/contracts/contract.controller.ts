import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { ContractsService } from './contracts.service'
import {
  ContractAddDto,
  ContractApprovalDto,
  ContractBatchApprovalDto,
  ContractBatchUpdateDto,
  ContractPageDto,
  ContractSortDto,
  ContractUpdateDirectDto,
  UpdateContractStageDto,
} from './dto/contract.dto'

@ApiTags('合同')
@ApiBearerAuth()
@RequirePermissions('menu:contract')
@Controller('contract')
export class ContractController {
  constructor(private readonly service: ContractsService) {}

  @Get('module/form')
  @ApiOperation({ summary: '获取合同表单配置' })
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.form(user)
  }

  @Post('page')
  @ApiOperation({ summary: '合同列表 / 阶段看板分页' })
  page(@CurrentUser() user: AuthUser, @Body() dto: ContractPageDto) {
    return this.service.page(user, dto)
  }

  @Post('add')
  @RequirePermissions('contract:create')
  @LogOperation('contract', 'create')
  @ApiOperation({ summary: '新增合同' })
  add(@CurrentUser() user: AuthUser, @Body() dto: ContractAddDto) {
    return this.service.addDirect(user, dto)
  }

  @Post('update')
  @RequirePermissions('contract:update')
  @LogOperation('contract', 'update')
  @ApiOperation({ summary: '更新合同' })
  update(@CurrentUser() user: AuthUser, @Body() dto: ContractUpdateDirectDto) {
    return this.service.updateDirect(user, dto)
  }

  @Get('get/snapshot/:id')
  @ApiOperation({ summary: '获取合同详情快照' })
  snapshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getSnapshot(user, id)
  }

  @Get('get/:id')
  @ApiOperation({ summary: '获取合同详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user, id)
  }

  @Get('module/form/snapshot/:id')
  @ApiOperation({ summary: '获取合同表单快照配置' })
  snapshotForm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getSnapshotForm(user, id)
  }

  @Post('update/stage')
  @RequirePermissions('contract:update')
  @LogOperation('contract', 'stage')
  @ApiOperation({ summary: '更新合同阶段' })
  updateStage(@CurrentUser() user: AuthUser, @Body() dto: UpdateContractStageDto) {
    return this.service.updateStage(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('contract:delete')
  @LogOperation('contract', 'delete')
  @ApiOperation({ summary: '删除合同' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('approval')
  @RequirePermissions('contract:submit')
  @LogOperation('contract', 'approval')
  @ApiOperation({ summary: '合同审批' })
  approval(@CurrentUser() user: AuthUser, @Body() dto: ContractApprovalDto) {
    return this.service.approval(user, dto)
  }

  @Post('batch/approval')
  @RequirePermissions('contract:submit')
  @LogOperation('contract', 'batchApproval')
  @ApiOperation({ summary: '批量合同审批' })
  batchApproval(@CurrentUser() user: AuthUser, @Body() dto: ContractBatchApprovalDto) {
    return this.service.batchApproval(user, dto)
  }

  @Post('batch/update')
  @RequirePermissions('contract:update')
  @LogOperation('contract', 'batchUpdate')
  @ApiOperation({ summary: '批量更新合同' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ContractBatchUpdateDto) {
    return this.service.batchUpdateDirect(user, dto)
  }

  @Get('revoke/:id')
  @RequirePermissions('contract:submit')
  @LogOperation('contract', 'revoke')
  @ApiOperation({ summary: '撤回合同审批' })
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revoke(user, id)
  }

  @Get('tab')
  @ApiOperation({ summary: '合同全部 / 部门 Tab 显隐' })
  tab(@CurrentUser() user: AuthUser) {
    return this.service.tab(user)
  }

  @Post('statistic')
  @ApiOperation({ summary: '合同统计' })
  statistic(@CurrentUser() user: AuthUser, @Body() dto: ContractPageDto) {
    return this.service.statistic(user, dto)
  }

  @Post('sort')
  @RequirePermissions('contract:update')
  @LogOperation('contract', 'sort')
  @ApiOperation({ summary: '合同阶段看板拖拽排序' })
  sort(@CurrentUser() user: AuthUser, @Body() dto: ContractSortDto) {
    return this.service.sort(user, dto)
  }
}
