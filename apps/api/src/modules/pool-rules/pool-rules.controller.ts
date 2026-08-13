import { Body, Controller, Get, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { UpdatePoolRuleDto } from './dto/pool-rule.dto'
import { PoolRecycleService } from './pool-recycle.service'
import { PoolRulesService } from './pool-rules.service'

@ApiTags('公海/线索池规则')
@ApiBearerAuth()
@Controller('pool-rules')
export class PoolRulesController {
  constructor(
    private readonly poolRulesService: PoolRulesService,
    private readonly poolRecycleService: PoolRecycleService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取回收规则' })
  list(@CurrentUser() user: AuthUser) {
    return this.poolRulesService.list(user.tenantId)
  }

  @Put()
  @RequirePermissions('system:module')
  @LogOperation('poolRule', 'update')
  @ApiOperation({ summary: '更新回收规则' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePoolRuleDto) {
    return this.poolRulesService.update(user.tenantId, dto)
  }

  @Post('run-now')
  @RequirePermissions('system:module')
  @LogOperation('poolRule', 'runNow')
  @ApiOperation({ summary: '立即执行一次回收（用于验证规则）' })
  runNow(@CurrentUser() user: AuthUser) {
    return this.poolRecycleService.recycleTenant(user.tenantId)
  }
}
