import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  QuotationAddDto,
  QuotationApproveDto,
  QuotationBatchApproveDto,
  QuotationBatchDto,
  QuotationBatchUpdateDto,
  QuotationPageDto,
  QuotationUpdateDto,
} from './dto/quotation.dto'
import { QuotesService } from './quotes.service'

@ApiTags('商机报价单')
@ApiBearerAuth()
@RequirePermissions('menu:quote')
@Controller('opportunity/quotation')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get('module/form')
  @ApiOperation({ summary: '获取报价表单配置' })
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.quotesService.form(user)
  }

  @Post('page')
  @ApiOperation({ summary: '报价单列表' })
  page(@CurrentUser() user: AuthUser, @Body() dto: QuotationPageDto) {
    return this.quotesService.list(user, dto)
  }

  @Post('add')
  @RequirePermissions('quote:create')
  @LogOperation('quote', 'create')
  @ApiOperation({ summary: '新增报价单' })
  add(@CurrentUser() user: AuthUser, @Body() dto: QuotationAddDto) {
    return this.quotesService.create(user, dto)
  }

  @Post('update')
  @RequirePermissions('quote:update')
  @LogOperation('quote', 'update')
  @ApiOperation({ summary: '更新报价单' })
  update(@CurrentUser() user: AuthUser, @Body() dto: QuotationUpdateDto) {
    return this.quotesService.update(user, dto)
  }

  @Get('get/snapshot/:id')
  @ApiOperation({ summary: '获取报价单快照详情' })
  getSnapshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.getSnapshot(user, id)
  }

  @Get('get/:id')
  @ApiOperation({ summary: '获取报价单详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.get(user, id)
  }

  @Get('module/form/snapshot/:id')
  @ApiOperation({ summary: '获取报价表单快照配置' })
  getSnapshotForm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.getSnapshotForm(user, id)
  }

  @Get('revoke/:id')
  @RequirePermissions('quote:submit')
  @LogOperation('quote', 'revoke')
  @ApiOperation({ summary: '撤销报价单审批' })
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.revoke(user, id)
  }

  @Get('voided/:id')
  @RequirePermissions('quote:update')
  @LogOperation('quote', 'void')
  @ApiOperation({ summary: '作废报价单' })
  voided(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.setInvalid(user, id, true)
  }

  @Post('batch/voided')
  @RequirePermissions('quote:update')
  @LogOperation('quote', 'batch-void')
  @ApiOperation({ summary: '批量作废报价单' })
  batchVoided(@CurrentUser() user: AuthUser, @Body() dto: QuotationBatchDto) {
    return this.quotesService.batchVoid(user, dto.ids)
  }

  @Post('approve')
  @RequirePermissions('quote:submit')
  @LogOperation('quote', 'approve')
  @ApiOperation({ summary: '审批报价单' })
  approve(@CurrentUser() user: AuthUser, @Body() dto: QuotationApproveDto) {
    return this.quotesService.approve(user, dto)
  }

  @Post('batch/approve')
  @RequirePermissions('quote:submit')
  @LogOperation('quote', 'batch-approve')
  @ApiOperation({ summary: '批量审批报价单' })
  batchApprove(@CurrentUser() user: AuthUser, @Body() dto: QuotationBatchApproveDto) {
    return this.quotesService.batchApprove(user, dto)
  }

  @Post('batch/update')
  @RequirePermissions('quote:update')
  @LogOperation('quote', 'batch-update')
  @ApiOperation({ summary: '批量更新报价单' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: QuotationBatchUpdateDto) {
    return this.quotesService.batchUpdate(user, dto)
  }

  @Get('tab')
  @ApiOperation({ summary: '报价单全部/部门 Tab 是否显示' })
  tab(@CurrentUser() user: AuthUser) {
    return this.quotesService.tab(user)
  }

  @Get('download/:id')
  @LogOperation('quote', 'download')
  @ApiOperation({ summary: '记录报价单下载日志' })
  download(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.download(user, id)
  }

  @Get('delete/:id')
  @RequirePermissions('quote:delete')
  @LogOperation('quote', 'delete')
  @ApiOperation({ summary: '删除报价单' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotesService.remove(user, id)
  }
}
