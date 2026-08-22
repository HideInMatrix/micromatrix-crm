import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  ReorderModuleConfigsDto,
  ReorderTopNavigationConfigsDto,
  UpdateModuleConfigDto,
} from './dto/module-config.dto'
import { ModuleConfigsService } from './module-configs.service'

@ApiTags('模块配置')
@ApiBearerAuth()
@Controller('module-configs')
export class ModuleConfigsController {
  constructor(private readonly moduleConfigsService: ModuleConfigsService) {}

  @Get()
  @ApiOperation({ summary: '当前租户模块开关与主导航顺序（登录即可读）' })
  list(@CurrentUser() user: AuthUser) {
    return this.moduleConfigsService.list(user.tenantId)
  }

  @Get('top-navigation')
  @ApiOperation({ summary: '当前租户顶部导航顺序（登录即可读）' })
  listTopNavigation(@CurrentUser() user: AuthUser) {
    return this.moduleConfigsService.listTopNavigation(user.tenantId)
  }

  @Post('top-navigation/reorder')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'sortTopNavigation')
  @ApiOperation({ summary: '保存顶部导航顺序' })
  reorderTopNavigation(@CurrentUser() user: AuthUser, @Body() dto: ReorderTopNavigationConfigsDto) {
    return this.moduleConfigsService.reorderTopNavigation(user.tenantId, dto.navigationKeys)
  }

  @Patch(':moduleKey')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'switch')
  @ApiOperation({ summary: '开启或关闭模块' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('moduleKey') moduleKey: string,
    @Body() dto: UpdateModuleConfigDto,
  ) {
    return this.moduleConfigsService.update(user.tenantId, moduleKey, dto.enabled)
  }

  @Post('reorder')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'sort')
  @ApiOperation({ summary: '保存主导航顺序' })
  reorder(@CurrentUser() user: AuthUser, @Body() dto: ReorderModuleConfigsDto) {
    return this.moduleConfigsService.reorder(user.tenantId, dto.moduleKeys)
  }
}
