import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  OpportunityRuleAddDto,
  OpportunityRulePageDto,
  OpportunityRuleUpdateDto,
} from './dto/opportunity-rule.dto'
import { OpportunityRuleService } from './opportunity-rule.service'

@ApiTags('商机关闭规则')
@ApiBearerAuth()
@Controller('opportunity-rule')
export class OpportunityRuleController {
  constructor(private readonly service: OpportunityRuleService) {}

  @Post('page')
  @RequirePermissions('system:module:update')
  @ApiOperation({ summary: '分页获取商机规则' })
  page(@CurrentUser() user: AuthUser, @Body() dto: OpportunityRulePageDto) {
    return this.service.page(user.tenantId, dto)
  }

  @Post('add')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'addOpportunityRule')
  add(@CurrentUser() user: AuthUser, @Body() dto: OpportunityRuleAddDto) {
    return this.service.add(user.tenantId, user.id, dto)
  }

  @Post('update')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'updateOpportunityRule')
  update(@CurrentUser() user: AuthUser, @Body() dto: OpportunityRuleUpdateDto) {
    return this.service.update(user.tenantId, user.id, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'deleteOpportunityRule')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id)
  }

  @Get('switch/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'switchOpportunityRule')
  toggle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.toggle(user.tenantId, user.id, id)
  }
}

