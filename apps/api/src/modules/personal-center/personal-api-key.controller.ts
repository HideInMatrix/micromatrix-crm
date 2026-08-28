import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { UpdatePersonalApiKeyDto } from './dto/personal-api-key.dto'
import { PersonalApiKeyService } from './personal-api-key.service'

@ApiTags('个人中心 - API Key')
@ApiBearerAuth()
@Controller('user/api/key')
export class PersonalApiKeyController {
  constructor(private readonly service: PersonalApiKeyService) {}

  @Get('add')
  @RequirePermissions('PERSONAL_API_KEY:ADD')
  @ApiOperation({ summary: '个人中心 API Key 新增（Cordys 契约）' })
  add(@CurrentUser() user: AuthUser) {
    return this.service.add(user)
  }

  @Get('list')
  @RequirePermissions('PERSONAL_API_KEY:READ')
  @ApiOperation({ summary: '个人中心 API Key 列表（Cordys 契约）' })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user)
  }

  @Post('update')
  @RequirePermissions('PERSONAL_API_KEY:UPDATE')
  @ApiOperation({ summary: '个人中心 API Key 更新（Cordys 契约）' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdatePersonalApiKeyDto) {
    return this.service.update(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('PERSONAL_API_KEY:DELETE')
  @ApiOperation({ summary: '个人中心 API Key 删除（Cordys 契约）' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Get('enable/:id')
  @RequirePermissions('PERSONAL_API_KEY:UPDATE')
  @ApiOperation({ summary: '个人中心 API Key 启用（Cordys 契约）' })
  enable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.setEnabled(user, id, true)
  }

  @Get('disable/:id')
  @RequirePermissions('PERSONAL_API_KEY:UPDATE')
  @ApiOperation({ summary: '个人中心 API Key 禁用（Cordys 契约）' })
  disable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.setEnabled(user, id, false)
  }
}
