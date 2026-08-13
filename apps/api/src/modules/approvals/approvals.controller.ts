import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ApprovalModule } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { ApprovalsService } from './approvals.service'
import { HandleTaskDto, SaveFlowDto, SubmitApprovalDto } from './dto/approval.dto'

@ApiTags('审批')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  // ===== 流程配置 =====

  @Get('flows')
  @ApiOperation({ summary: '审批流配置列表' })
  listFlows(@CurrentUser() user: AuthUser) {
    return this.approvalsService.listFlows(user.tenantId)
  }

  @Put('flows')
  @RequirePermissions('approval:flowManage')
  @LogOperation('approvalFlow', 'save')
  @ApiOperation({ summary: '保存审批流（按模块 upsert）' })
  saveFlow(@CurrentUser() user: AuthUser, @Body() dto: SaveFlowDto) {
    return this.approvalsService.saveFlow(user, dto)
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
