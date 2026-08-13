import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { QueryLoginLogsDto, QueryOperationLogsDto } from './dto/query-logs.dto'
import { LogsService } from './logs.service'

@ApiTags('系统日志')
@ApiBearerAuth()
@RequirePermissions('system:log')
@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get('operations')
  @ApiOperation({ summary: '操作日志' })
  operations(@CurrentUser() user: AuthUser, @Query() query: QueryOperationLogsDto) {
    return this.logsService.operationLogs(user.tenantId, query)
  }

  @Get('logins')
  @ApiOperation({ summary: '登录日志' })
  logins(@CurrentUser() user: AuthUser, @Query() query: QueryLoginLogsDto) {
    return this.logsService.loginLogs(user.tenantId, query)
  }
}
