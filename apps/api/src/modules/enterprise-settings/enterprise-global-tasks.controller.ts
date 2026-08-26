import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  SaveEnterpriseGlobalTaskDto,
  UpdateEnterpriseGlobalTaskStatusDto,
} from './dto/global-task.dto'
import { EnterpriseGlobalTasksService } from './enterprise-global-tasks.service'

@ApiTags('企业设置 - 全局任务')
@ApiBearerAuth()
@Controller('enterprise-settings/global-tasks')
export class EnterpriseGlobalTasksController {
  constructor(private readonly tasks: EnterpriseGlobalTasksService) {}

  @Get()
  @RequirePermissions('system:setting')
  list(@CurrentUser() user: AuthUser, @Query('keyword') keyword?: string) {
    return this.tasks.list(user.tenantId, keyword)
  }

  @Get('executions')
  @RequirePermissions('system:setting')
  executions(@CurrentUser() user: AuthUser, @Query('taskId') taskId?: string) {
    return this.tasks.executions(user.tenantId, taskId)
  }

  @Patch('executions/:id/stop')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-global-task-execution', 'stop')
  stopExecution(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.stopExecution(user.tenantId, id)
  }

  @Delete('executions/:id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-global-task-execution', 'delete')
  removeExecution(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.removeExecution(user.tenantId, id)
  }

  @Get(':id')
  @RequirePermissions('system:setting')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.get(user.tenantId, id)
  }

  @Post()
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-global-task', 'create')
  create(@CurrentUser() user: AuthUser, @Body() input: SaveEnterpriseGlobalTaskDto) {
    return this.tasks.create(user, input)
  }

  @Put(':id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-global-task', 'update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: SaveEnterpriseGlobalTaskDto,
  ) {
    return this.tasks.update(user, id, input)
  }

  @Patch(':id/status')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-global-task', 'update-status')
  status(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateEnterpriseGlobalTaskStatusDto,
  ) {
    return this.tasks.setStatus(user.tenantId, id, input.enable)
  }

  @Delete(':id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-global-task', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.remove(user.tenantId, id)
  }
}
