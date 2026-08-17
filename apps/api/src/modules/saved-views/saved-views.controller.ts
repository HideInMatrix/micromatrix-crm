import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { CreateSavedViewDto, ReorderSavedViewsDto, UpdateSavedViewDto } from './dto/saved-view.dto'
import { SavedViewsService } from './saved-views.service'

@ApiTags('保存的列表视图')
@ApiBearerAuth()
@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly service: SavedViewsService) {}

  @Get(':module')
  @ApiOperation({ summary: '当前用户指定模块的视图列表' })
  list(@CurrentUser() user: AuthUser, @Param('module') module: string) {
    return this.service.list(user, module)
  }

  @Get('detail/:id')
  @ApiOperation({ summary: '视图详情' })
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.detail(user, id)
  }

  @Post(':module')
  @LogOperation('savedView', 'create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('module') module: string,
    @Body() dto: CreateSavedViewDto,
  ) {
    return this.service.create(user, module, dto)
  }

  @Patch('detail/:id')
  @LogOperation('savedView', 'update')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateSavedViewDto) {
    return this.service.update(user, id, dto)
  }

  @Delete('detail/:id')
  @LogOperation('savedView', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('detail/:id/fixed')
  toggleFixed(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.toggleFixed(user, id)
  }

  @Post('detail/:id/enabled')
  toggleEnabled(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.toggleEnabled(user, id)
  }

  @Post(':module/reorder')
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('module') module: string,
    @Body() dto: ReorderSavedViewsDto,
  ) {
    return this.service.reorder(user, module, dto)
  }
}
