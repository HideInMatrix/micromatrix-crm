import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { BiddingService } from './bidding.service'
import { AddKeywordDto, ImportBiddingDto, QueryBiddingDto, SaveSourceDto } from './dto/bidding.dto'

@ApiTags('标讯')
@ApiBearerAuth()
@RequirePermissions('menu:bidding')
@Controller('bidding')
export class BiddingController {
  constructor(private readonly biddingService: BiddingService) {}

  @Get()
  @ApiOperation({ summary: '标讯列表' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryBiddingDto) {
    return this.biddingService.findAll(user, query)
  }

  @Post(':id/convert')
  @RequirePermissions('bidding:convert')
  @LogOperation('bidding', 'convert')
  @ApiOperation({ summary: '标讯转线索' })
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.biddingService.convertToLead(user, id)
  }

  @Post('import')
  @RequirePermissions('bidding:manage')
  @LogOperation('bidding', 'import')
  @ApiOperation({ summary: '手动录入标讯' })
  manualImport(@CurrentUser() user: AuthUser, @Body() dto: ImportBiddingDto) {
    return this.biddingService.manualImport(user, dto)
  }

  @Post('fetch-now')
  @RequirePermissions('bidding:manage')
  @LogOperation('bidding', 'fetchNow')
  @ApiOperation({ summary: '立即抓取一次' })
  fetchNow(@CurrentUser() user: AuthUser) {
    return this.biddingService.fetchTenant(user.tenantId)
  }

  // ===== 数据源 =====

  @Get('sources')
  @ApiOperation({ summary: '数据源列表' })
  listSources(@CurrentUser() user: AuthUser) {
    return this.biddingService.listSources(user.tenantId)
  }

  @Put('sources')
  @RequirePermissions('bidding:manage')
  @LogOperation('bidding', 'saveSource')
  @ApiOperation({ summary: '配置数据源（启停/凭证）' })
  saveSource(@CurrentUser() user: AuthUser, @Body() dto: SaveSourceDto) {
    return this.biddingService.saveSource(user, dto.provider, dto.enabled, dto.credentials)
  }

  // ===== 关键词订阅 =====

  @Get('keywords')
  @ApiOperation({ summary: '关键词订阅列表' })
  listKeywords(@CurrentUser() user: AuthUser) {
    return this.biddingService.listKeywords(user.tenantId)
  }

  @Post('keywords')
  @RequirePermissions('bidding:manage')
  @LogOperation('bidding', 'addKeyword')
  @ApiOperation({ summary: '订阅关键词' })
  addKeyword(@CurrentUser() user: AuthUser, @Body() dto: AddKeywordDto) {
    return this.biddingService.addKeyword(user, dto.keyword)
  }

  @Post('keywords/:id/toggle')
  @RequirePermissions('bidding:manage')
  @ApiOperation({ summary: '启停关键词' })
  toggleKeyword(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.biddingService.toggleKeyword(user, id)
  }

  @Delete('keywords/:id')
  @RequirePermissions('bidding:manage')
  @LogOperation('bidding', 'removeKeyword')
  @ApiOperation({ summary: '删除关键词订阅' })
  removeKeyword(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.biddingService.removeKeyword(user, id)
  }
}
