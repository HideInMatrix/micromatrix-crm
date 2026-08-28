import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { DashboardResourceService } from './dashboard-resource.service'
import {
  DashboardAddDto,
  DashboardEditPosDto,
  DashboardPageDto,
  DashboardRenameDto,
  DashboardUpdateDto,
} from './dto/dashboard.dto'

@ApiTags('仪表板')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardResourceController {
  constructor(private readonly service: DashboardResourceService) {}

  @Post('add')
  @RequirePermissions('dashboard:create')
  @LogOperation('dashboard', 'create')
  @ApiOperation({ summary: '添加仪表板' })
  add(@CurrentUser() user: AuthUser, @Body() dto: DashboardAddDto) {
    return this.service.add(user, dto)
  }

  @Get('detail/:id')
  @RequirePermissions('dashboard:read')
  @ApiOperation({ summary: '仪表板详情' })
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.detail(user, id)
  }

  @Post('update')
  @RequirePermissions('dashboard:update')
  @LogOperation('dashboard', 'update')
  @ApiOperation({ summary: '更新仪表板' })
  update(@CurrentUser() user: AuthUser, @Body() dto: DashboardUpdateDto) {
    return this.service.update(user, dto)
  }

  @Post('rename')
  @RequirePermissions('dashboard:update')
  @LogOperation('dashboard', 'rename')
  @ApiOperation({ summary: '重命名仪表板' })
  rename(@CurrentUser() user: AuthUser, @Body() dto: DashboardRenameDto) {
    return this.service.rename(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('dashboard:delete')
  @LogOperation('dashboard', 'delete')
  @ApiOperation({ summary: '删除仪表板' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('page')
  @RequirePermissions('dashboard:read')
  @ApiOperation({ summary: '仪表板分页列表' })
  page(@CurrentUser() user: AuthUser, @Body() dto: DashboardPageDto) {
    return this.service.page(user, dto)
  }

  @Post('edit/pos')
  @RequirePermissions('dashboard:update')
  @LogOperation('dashboard', 'move')
  @ApiOperation({ summary: '仪表板拖拽排序' })
  move(@CurrentUser() user: AuthUser, @Body() dto: DashboardEditPosDto) {
    return this.service.move(user, dto)
  }
}
