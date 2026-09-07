import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AnnouncementsService } from './announcements.service'
import { QueryAnnouncementsDto, SaveAnnouncementDto } from './dto/announcement.dto'

@ApiTags('公告')
@ApiBearerAuth()
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequirePermissions('system:message')
  @ApiOperation({ summary: '分页查询当前租户公告' })
  list(@CurrentUser() user: AuthUser, @Query() query: QueryAnnouncementsDto) {
    return this.announcements.list(user.tenantId, query)
  }

  @Get(':id')
  @RequirePermissions('system:message')
  @ApiOperation({ summary: '公告详情' })
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.announcements.detail(user.tenantId, id)
  }

  @Post()
  @RequirePermissions('system:message:update')
  @LogOperation('announcement', 'create')
  @ApiOperation({ summary: '新建公告' })
  create(@CurrentUser() user: AuthUser, @Body() dto: SaveAnnouncementDto) {
    return this.announcements.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('system:message:update')
  @LogOperation('announcement', 'update')
  @ApiOperation({ summary: '编辑公告并重建已生成通知' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SaveAnnouncementDto) {
    return this.announcements.update(user, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('system:message:update')
  @LogOperation('announcement', 'delete')
  @ApiOperation({ summary: '删除公告及其通知' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.announcements.remove(user.tenantId, id)
  }
}
