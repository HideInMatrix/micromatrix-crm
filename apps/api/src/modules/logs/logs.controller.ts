import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { QueryLoginLogsDto, QueryOperationLogsDto } from './dto/query-logs.dto'
import { QueryLogCategoryDto, QueryClearLogCategoryDto } from './dto/query-log-category.dto'
import { UpdateOperationLogSettingDto } from './dto/update-operation-log-setting.dto'
import { OperationLogCleanupService } from './operation-log-cleanup.service'
import { OperationLogSettingsService } from './operation-log-settings.service'
import { LogsService } from './logs.service'

@ApiTags('系统日志')
@ApiBearerAuth()
@RequirePermissions('system:log')
@Controller('logs')
export class LogsController {
  constructor(
    private readonly logsService: LogsService,
    private readonly logSettings: OperationLogSettingsService,
    private readonly logCleanup: OperationLogCleanupService,
  ) {}

  @Get('operations')
  @ApiOperation({ summary: '操作日志' })
  operations(@CurrentUser() user: AuthUser, @Query() query: QueryOperationLogsDto) {
    return this.logsService.operationLogs(user.tenantId, query)
  }

  @Get('operations/:id')
  @ApiOperation({ summary: '操作日志详情' })
  operationDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.logsService.operationLogDetail(user.tenantId, id)
  }

  @Get('settings')
  @ApiOperation({ summary: '按日志分类查询独立保留策略' })
  settings(@CurrentUser() user: AuthUser, @Query() query: QueryLogCategoryDto) {
    return this.logSettings.get(user.tenantId, query.category)
  }

  @Put('settings')
  @RequirePermissions('system:log:update')
  @LogOperation('systemLog', 'updateRetention')
  @ApiOperation({ summary: '更新操作日志保留策略' })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateOperationLogSettingDto,
    @Query() query: QueryLogCategoryDto,
  ) {
    return this.logSettings.update(user.tenantId, body.retentionDays, query.category)
  }

  @Post('cleanup')
  @RequirePermissions('system:log:update')
  @LogOperation('systemLog', 'cleanup')
  @ApiOperation({ summary: '按日志分类清理当前租户过期记录' })
  cleanup(@CurrentUser() user: AuthUser, @Query() query: QueryLogCategoryDto) {
    return this.logCleanup.cleanupTenant(user.tenantId, new Date(), 'MANUAL', query.category)
  }

  @Post('clear-all')
  @RequirePermissions('system:log:update')
  @ApiOperation({ summary: '清空当前租户全部操作日志' })
  clearAll(@CurrentUser() user: AuthUser, @Query() query: QueryClearLogCategoryDto) {
    return this.logCleanup.clearTenant(user.tenantId, query.category)
  }

  @Get('logins')
  @ApiOperation({ summary: '登录日志' })
  logins(@CurrentUser() user: AuthUser, @Query() query: QueryLoginLogsDto) {
    return this.logsService.loginLogs(user.tenantId, query)
  }
}
