import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { CluePoolConfigService } from './clue-pool-config.service'
import {
  CluePoolAddDto,
  CluePoolPageRequestDto,
  CluePoolUpdateDto,
} from './dto/clue-pool-config.dto'

@ApiTags('线索池设置')
@ApiBearerAuth()
@Controller('lead-pool')
export class CluePoolConfigController {
  constructor(private readonly service: CluePoolConfigService) {}

  @Post('page')
  @RequirePermissions('system:module:update')
  @ApiOperation({ summary: '分页获取线索池设置' })
  page(@CurrentUser() user: AuthUser, @Body() dto: CluePoolPageRequestDto) {
    return this.service.page(user, dto)
  }

  @Post('add')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'addCluePool')
  @ApiOperation({ summary: '新增线索池' })
  async add(@CurrentUser() user: AuthUser, @Body() dto: CluePoolAddDto) {
    await this.service.add(user, dto)
  }

  @Post('update')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'updateCluePool')
  @ApiOperation({ summary: '编辑线索池' })
  async update(@CurrentUser() user: AuthUser, @Body() dto: CluePoolUpdateDto) {
    await this.service.update(user, dto)
  }

  @Post('quick-update')
  @LogOperation('module', 'quickUpdateCluePool')
  @ApiOperation({ summary: '线索池管理员快捷保存线索池' })
  async quickUpdate(@CurrentUser() user: AuthUser, @Body() dto: CluePoolUpdateDto) {
    await this.service.quickUpdate(user, dto)
  }

  @Get('no-pick/:id')
  @RequirePermissions('system:module:update')
  @ApiOperation({ summary: '线索池是否仍有未领取线索' })
  noPick(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.noPick(user, id)
  }

  @Get('delete/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'deleteCluePool')
  @ApiOperation({ summary: '删除线索池' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.remove(user, id)
  }

  @Get('switch/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'switchCluePool')
  @ApiOperation({ summary: '启用或禁用线索池' })
  async switchStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.switchStatus(user, id)
  }
}
