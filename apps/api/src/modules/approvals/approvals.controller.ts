import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ApprovalModule } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { ApprovalFlowConfigService } from './approval-flow-config.service'
import { ApprovalsService } from './approvals.service'
import {
  ApprovalFlowPageQueryDto,
  CreateApprovalFlowDto,
  HandleTaskDto,
  SubmitApprovalDto,
  UpdateApprovalFlowDto,
  UpdateApprovalFlowEnabledDto,
} from './dto/approval.dto'

@ApiTags('审批')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly flowConfigService: ApprovalFlowConfigService,
  ) {}

  // ===== 流程配置 =====

  @Get('flows')
  @RequirePermissions('system:process')
  @ApiOperation({ summary: '审批流配置列表' })
  listFlows(@CurrentUser() user: AuthUser, @Query() query: ApprovalFlowPageQueryDto) {
    return this.flowConfigService.list(user, query)
  }

  @Get('flows/:id')
  @RequirePermissions('system:process')
  @ApiOperation({ summary: '审批流详情' })
  flowDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.flowConfigService.detail(user, id)
  }

  @Post('flows')
  @RequirePermissions('system:process:add')
  @LogOperation('approvalFlow', 'add')
  @ApiOperation({ summary: '新建审批流' })
  createFlow(@CurrentUser() user: AuthUser, @Body() dto: CreateApprovalFlowDto) {
    return this.flowConfigService.create(user, dto)
  }

  @Put('flows/:id')
  @RequirePermissions('system:process:update')
  @LogOperation('approvalFlow', 'update')
  @ApiOperation({ summary: '更新审批流' })
  updateFlow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateApprovalFlowDto,
  ) {
    return this.flowConfigService.update(user, id, dto)
  }

  @Patch('flows/:id/enabled')
  @RequirePermissions('system:process:update')
  @LogOperation('approvalFlow', 'enable')
  @ApiOperation({ summary: '启用或停用审批流' })
  updateFlowEnabled(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateApprovalFlowEnabledDto,
  ) {
    return this.flowConfigService.updateEnabled(user, id, dto.enabled)
  }

  @Delete('flows/:id')
  @RequirePermissions('system:process:delete')
  @LogOperation('approvalFlow', 'delete')
  @ApiOperation({ summary: '删除审批流' })
  removeFlow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.flowConfigService.remove(user, id)
  }

  // ===== 提交 / 处理 =====

  @Post('submit')
  @RequirePermissions('menu:approval')
  @LogOperation('approval', 'submit')
  @ApiOperation({ summary: '提交审批' })
  submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitApprovalDto) {
    return this.approvalsService.submit(user, dto.module as ApprovalModule, dto.targetId)
  }

  @Post('tasks/:id/approve')
  @RequirePermissions('menu:approval')
  @LogOperation('approval', 'approve')
  @ApiOperation({ summary: '同意' })
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: HandleTaskDto) {
    return this.approvalsService.approveTask(user, id, dto.comment)
  }

  @Post('tasks/:id/reject')
  @RequirePermissions('menu:approval')
  @LogOperation('approval', 'reject')
  @ApiOperation({ summary: '驳回' })
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: HandleTaskDto) {
    return this.approvalsService.rejectTask(user, id, dto.comment)
  }

  @Post(':id/cancel')
  @RequirePermissions('menu:approval')
  @LogOperation('approval', 'cancel')
  @ApiOperation({ summary: '撤回（仅发起人）' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.approvalsService.cancel(user, id)
  }

  // ===== 查询 =====

  @Get('my-pending')
  @ApiOperation({ summary: '我的待办' })
  myPending(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.approvalsService.myPending(user, query.page ?? 1, query.pageSize ?? 10)
  }

  @Get('my-handled')
  @ApiOperation({ summary: '我的已办' })
  myHandled(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.approvalsService.myHandled(user, query.page ?? 1, query.pageSize ?? 10)
  }

  @Get('my-applications')
  @ApiOperation({ summary: '我发起的' })
  myApplications(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.approvalsService.myApplications(user, query.page ?? 1, query.pageSize ?? 10)
  }

  @Get('my-copied')
  @ApiOperation({ summary: '抄送我的' })
  myCopied(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.approvalsService.myCopied(user, query.page ?? 1, query.pageSize ?? 10)
  }

  @Get('instance')
  @ApiOperation({ summary: '业务对象的最新审批实例' })
  instanceForTarget(
    @CurrentUser() user: AuthUser,
    @Query('module') module: string,
    @Query('targetId') targetId: string,
  ) {
    return this.approvalsService.instanceForTarget(user, module, targetId)
  }
}
