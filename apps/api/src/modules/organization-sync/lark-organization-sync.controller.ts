import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  CreateOrganizationSyncPreviewDto,
  QueryOrganizationSyncBatchesDto,
  QueryOrganizationSyncItemsDto,
  ResolveOrganizationSyncDto,
} from './dto/organization-sync.dto'
import { OrganizationSyncApplyService } from './organization-sync-apply.service'
import { OrganizationSyncService } from './organization-sync.service'

@ApiTags('飞书组织同步')
@ApiBearerAuth()
@Controller('organization-sync/lark')
@RequirePermissions('system:member')
export class LarkOrganizationSyncController {
  constructor(
    private readonly sync: OrganizationSyncService,
    private readonly applyService: OrganizationSyncApplyService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: '获取飞书组织同步门槛与最近状态' })
  status(@CurrentUser() user: AuthUser) {
    return this.sync.gate(user.tenantId, 'LARK')
  }

  @Post('previews')
  @RequirePermissions('system:member:update')
  @LogOperation('organizationSync', 'previewLark')
  @ApiOperation({ summary: '生成飞书组织同步预览' })
  preview(@CurrentUser() user: AuthUser, @Body() dto: CreateOrganizationSyncPreviewDto) {
    return this.sync.createPreview(user, dto, 'LARK')
  }

  @Get('batches')
  @ApiOperation({ summary: '分页读取飞书组织同步批次' })
  batches(@CurrentUser() user: AuthUser, @Query() query: QueryOrganizationSyncBatchesDto) {
    return this.sync.batches(user.tenantId, query, 'LARK')
  }

  @Get('batches/:id')
  @ApiOperation({ summary: '读取飞书组织同步批次详情' })
  batch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.batch(user.tenantId, id, 'LARK')
  }

  @Get('batches/:id/items')
  @ApiOperation({ summary: '分页读取飞书组织同步差异项' })
  items(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: QueryOrganizationSyncItemsDto,
  ) {
    return this.sync.items(user.tenantId, id, query, 'LARK')
  }

  @Put('batches/:id/resolutions')
  @RequirePermissions('system:member:update')
  @LogOperation('organizationSync', 'resolveLark')
  @ApiOperation({ summary: '处理飞书组织同步冲突' })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveOrganizationSyncDto,
  ) {
    return this.sync.resolve(user, id, dto, 'LARK')
  }

  @Post('batches/:id/apply')
  @RequirePermissions('system:member:update')
  @LogOperation('organizationSync', 'applyLark')
  @ApiOperation({ summary: '原子应用飞书组织同步预览' })
  async apply(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.applyService.apply(user, id, 'LARK')
    return this.sync.batch(user.tenantId, id, 'LARK')
  }
}
