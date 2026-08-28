import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { DashboardModuleService } from './dashboard-module.service'
import {
  DashboardModuleAddDto,
  DashboardModuleMoveDto,
  DashboardModuleRenameDto,
} from './dto/dashboard.dto'

@ApiTags('仪表板模块')
@ApiBearerAuth()
@Controller('dashboard/module')
export class DashboardModuleController {
  constructor(private readonly service: DashboardModuleService) {}

  @Post('add')
  @RequirePermissions('dashboard:create')
  @LogOperation('dashboard', 'moduleCreate')
  @ApiOperation({ summary: '添加仪表板文件夹' })
  add(@CurrentUser() user: AuthUser, @Body() dto: DashboardModuleAddDto) {
    return this.service.add(user, dto)
  }

  @Post('rename')
  @RequirePermissions('dashboard:update')
  @LogOperation('dashboard', 'moduleRename')
  @ApiOperation({ summary: '重命名仪表板文件夹' })
  rename(@CurrentUser() user: AuthUser, @Body() dto: DashboardModuleRenameDto) {
    return this.service.rename(user, dto)
  }

  @Post('delete')
  @RequirePermissions('dashboard:delete')
  @LogOperation('dashboard', 'moduleDelete')
  @ApiOperation({ summary: '删除仪表板文件夹' })
  remove(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestException('请选择仪表板文件夹')
    return this.service.remove(user, ids)
  }

  @Get('tree')
  @RequirePermissions('dashboard:read')
  @ApiOperation({ summary: '仪表板文件树' })
  tree(@CurrentUser() user: AuthUser) {
    return this.service.tree(user)
  }

  @Get('count')
  @RequirePermissions('dashboard:read')
  @ApiOperation({ summary: '仪表板目录数量' })
  count(@CurrentUser() user: AuthUser) {
    return this.service.count(user)
  }

  @Post('move')
  @RequirePermissions('dashboard:update')
  @LogOperation('dashboard', 'moduleMove')
  @ApiOperation({ summary: '移动仪表板文件夹' })
  move(@CurrentUser() user: AuthUser, @Body() dto: DashboardModuleMoveDto) {
    return this.service.move(user, dto)
  }
}
