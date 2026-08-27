import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { DictionariesService } from './dictionaries.service'
import {
  DICTIONARY_MODULES,
  DictionaryAddDto,
  type DictionaryModule,
  DictionarySortDto,
  DictionarySwitchDto,
  DictionaryUpdateDto,
} from './dto/dictionary.dto'

@ApiTags('模块配置-字典管理')
@ApiBearerAuth()
@Controller('dict')
export class DictionariesController {
  constructor(private readonly service: DictionariesService) {}

  @Get('get/:module')
  @RequirePermissions('system:module')
  @ApiOperation({ summary: '获取模块字典列表' })
  list(@CurrentUser() user: AuthUser, @Param('module') module: string) {
    return this.service.list(user.tenantId, this.module(module))
  }

  @Post('add')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'addReason')
  add(@CurrentUser() user: AuthUser, @Body() dto: DictionaryAddDto) {
    return this.service.add(user, dto)
  }

  @Post('update')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'updateReason')
  update(@CurrentUser() user: AuthUser, @Body() dto: DictionaryUpdateDto) {
    return this.service.update(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'deleteReason')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('switch')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'switchReason')
  switch(@CurrentUser() user: AuthUser, @Body() dto: DictionarySwitchDto) {
    return this.service.switch(user, dto.module, dto.enable)
  }

  @Post('sort')
  @RequirePermissions('system:module:update')
  @LogOperation('module', 'sortReason')
  sort(@CurrentUser() user: AuthUser, @Body() dto: DictionarySortDto) {
    return this.service.sort(user, dto)
  }

  @Get('config/:module')
  @ApiOperation({ summary: '获取模块字典配置' })
  config(@CurrentUser() user: AuthUser, @Param('module') module: string) {
    return this.service.config(user.tenantId, this.module(module))
  }

  private module(value: string): DictionaryModule {
    const module = value as DictionaryModule
    if (!DICTIONARY_MODULES.includes(module)) throw new BadRequestException('不支持的字典模块')
    return module
  }
}
