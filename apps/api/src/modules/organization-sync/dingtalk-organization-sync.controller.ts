import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { OrganizationSyncApplyService } from './organization-sync-apply.service'
import {
  CreateOrganizationSyncPreviewDto,
  QueryOrganizationSyncBatchesDto,
  QueryOrganizationSyncItemsDto,
  ResolveOrganizationSyncDto,
} from './dto/organization-sync.dto'
import { OrganizationSyncService } from './organization-sync.service'

@ApiTags('钉钉组织同步')
@ApiBearerAuth()
@Controller('organization-sync/dingtalk')
@RequirePermissions('system:dept:sync')
export class DingTalkOrganizationSyncController {
  constructor(
    private readonly sync: OrganizationSyncService,
    private readonly applyService: OrganizationSyncApplyService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: '获取钉钉组织同步门槛与最近状态' })
  status(@CurrentUser() user: AuthUser) {
    return this.sync.gate(user.tenantId, 'DINGTALK')
  }

  @Post('previews')
  @LogOperation('organizationSync', 'previewDingTalk')
  @ApiOperation({ summary: '生成钉钉组织同步预览' })
  preview(@CurrentUser() user: AuthUser, @Body() dto: CreateOrganizationSyncPreviewDto) {
    return this.sync.createPreview(user, dto, 'DINGTALK')
  }

  @Get('batches')
  @ApiOperation({ summary: '分页读取钉钉组织同步批次' })
  batches(@CurrentUser() user: AuthUser, @Query() query: QueryOrganizationSyncBatchesDto) {
    return this.sync.batches(user.tenantId, query, 'DINGTALK')
  }

  @Get('batches/:id')
  @ApiOperation({ summary: '读取钉钉组织同步批次详情' })
  batch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.batch(user.tenantId, id, 'DINGTALK')
  }

  @Get('batches/:id/items')
  @ApiOperation({ summary: '分页读取钉钉组织同步差异项' })
  items(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: QueryOrganizationSyncItemsDto,
  ) {
    return this.sync.items(user.tenantId, id, query, 'DINGTALK')
  }

  @Put('batches/:id/resolutions')
  @LogOperation('organizationSync', 'resolveDingTalkConflicts')
  @ApiOperation({ summary: '提交钉钉组织同步冲突解决方案' })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveOrganizationSyncDto,
  ) {
    return this.sync.resolve(user, id, dto, 'DINGTALK')
  }

  @Post('batches/:id/apply')
  @LogOperation('organizationSync', 'applyDingTalk')
  @ApiOperation({ summary: '原子应用钉钉组织同步预览' })
  async apply(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.applyService.apply(user, id, 'DINGTALK')
    return this.sync.batch(user.tenantId, id, 'DINGTALK')
  }
}
