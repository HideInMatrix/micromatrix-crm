import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  SaveEnterpriseTermCategoryDto,
  SaveEnterpriseTermDto,
  UpdateEnterpriseTermStatusDto,
} from './dto/term-setting.dto'
import { EnterpriseTermsService } from './enterprise-terms.service'

@ApiTags('企业设置 - 术语')
@ApiBearerAuth()
@Controller('enterprise-settings')
export class EnterpriseTermsController {
  constructor(private readonly termsService: EnterpriseTermsService) {}

  @Get('term-categories')
  @RequirePermissions('system:setting')
  categories(@CurrentUser() user: AuthUser) {
    return this.termsService.categories(user.tenantId)
  }

  @Post('term-categories')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-term-category', 'create')
  createCategory(@CurrentUser() user: AuthUser, @Body() input: SaveEnterpriseTermCategoryDto) {
    return this.termsService.createCategory(user.tenantId, input)
  }

  @Put('term-categories/:id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-term-category', 'update')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: SaveEnterpriseTermCategoryDto,
  ) {
    return this.termsService.updateCategory(user.tenantId, id, input)
  }

  @Delete('term-categories/:id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-term-category', 'delete')
  removeCategory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.termsService.removeCategory(user.tenantId, id)
  }

  @Get('terms')
  @RequirePermissions('system:setting')
  terms(
    @CurrentUser() user: AuthUser,
    @Query('categoryId') categoryId?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.termsService.terms(user.tenantId, categoryId, keyword)
  }

  @Post('terms')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-term', 'create')
  createTerm(@CurrentUser() user: AuthUser, @Body() input: SaveEnterpriseTermDto) {
    return this.termsService.createTerm(user, input)
  }

  @Put('terms/:id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-term', 'update')
  updateTerm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: SaveEnterpriseTermDto,
  ) {
    return this.termsService.updateTerm(user, id, input)
  }

  @Patch('terms/:id/status')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-term', 'update-status')
  status(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateEnterpriseTermStatusDto,
  ) {
    return this.termsService.setStatus(user.tenantId, id, input.enable)
  }

  @Delete('terms/:id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-term', 'delete')
  removeTerm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.termsService.removeTerm(user.tenantId, id)
  }

  @Get('term-discoveries')
  @RequirePermissions('system:setting')
  discoveries(@CurrentUser() user: AuthUser) {
    return this.termsService.discoveries(user.tenantId)
  }

  @Patch('term-discoveries/:id/ignore')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-term-discovery', 'ignore')
  ignoreDiscovery(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.termsService.ignoreDiscovery(user.tenantId, id)
  }

  @Post('term-discoveries/:id/adopt')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-term-discovery', 'adopt')
  adoptDiscovery(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: SaveEnterpriseTermDto,
  ) {
    return this.termsService.adoptDiscovery(user, id, input)
  }
}
