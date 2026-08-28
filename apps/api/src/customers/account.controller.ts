import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { LogOperation } from '../common/decorators/log-operation.decorator'
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../common/decorators/require-permissions.decorator'
import { ResourceBatchEditDto } from '../common/dto/resource-batch.dto'
import type { ImportType } from '../modules/import-export/dto/import-export.dto'
import { CustomersService } from './customers.service'
import {
  AccountAddDto,
  AccountBatchToPoolDto,
  AccountBatchTransferDto,
  AccountChartDto,
  AccountExportDto,
  AccountExportSelectDto,
  AccountOptionPageDto,
  AccountPageDto,
  AccountResourcePageDto,
  AccountToPoolDto,
  AccountUpdateDto,
} from './dto/account.dto'
import { CustomerMergeDto } from './dto/customer-merge.dto'
import { CheckDuplicateQueryDto } from './dto/query-customers.dto'

type UploadedBufferFile = { buffer: Buffer }

@ApiTags('客户')
@ApiBearerAuth()
@Controller('account')
export class AccountController {
  constructor(private readonly service: CustomersService) {}

  @Get('module/form')
  @RequireAnyPermissions('customer:read', 'customerPool:read')
  @ApiOperation({ summary: '获取客户表单配置' })
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.getModuleForm(user)
  }

  @Post('page')
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: '客户列表' })
  page(@CurrentUser() user: AuthUser, @Body() dto: AccountPageDto) {
    return this.service.page(user, dto)
  }

  @Get('get/:id')
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: '客户详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user, id)
  }

  @Post('add')
  @RequirePermissions('customer:create')
  @LogOperation('customer', 'create')
  add(@CurrentUser() user: AuthUser, @Body() dto: AccountAddDto) {
    return this.service.addAccount(user, dto)
  }

  @Post('update')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'update')
  update(@CurrentUser() user: AuthUser, @Body() dto: AccountUpdateDto) {
    return this.service.updateAccount(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('customer:delete')
  @LogOperation('customer', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('batch/transfer')
  @RequirePermissions('customer:transfer')
  @LogOperation('customer', 'batchTransfer')
  batchTransfer(@CurrentUser() user: AuthUser, @Body() dto: AccountBatchTransferDto) {
    return this.service.batchTransfer(user, dto.ids, dto.owner)
  }

  @Post('batch/update')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'batchUpdate')
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.service.batchUpdate(user, dto)
  }

  @Post('batch/delete')
  @RequirePermissions('customer:delete')
  @LogOperation('customer', 'batchDelete')
  batchDelete(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    if (!Array.isArray(ids) || !ids.length) throw new BadRequestException('请选择客户')
    return this.service.batchDelete(user, ids)
  }

  @Post('batch/to-pool')
  @RequirePermissions('customer:recycle')
  @LogOperation('customer', 'batchToPool')
  batchToPool(@CurrentUser() user: AuthUser, @Body() dto: AccountBatchToPoolDto) {
    return this.service.batchMoveToSea(user, dto.ids, dto.poolId, dto.reasonId)
  }

  @Post('to-pool')
  @RequirePermissions('customer:recycle')
  @LogOperation('customer', 'toPool')
  toPool(@CurrentUser() user: AuthUser, @Body() dto: AccountToPoolDto) {
    return this.service.moveToSea(user, dto.id, dto.poolId, dto.reasonId)
  }

  @Post('option')
  @RequirePermissions('customer:read')
  option(@CurrentUser() user: AuthUser, @Body() dto: AccountOptionPageDto) {
    return this.service.optionPage(user, dto.current, dto.pageSize, dto.keyword)
  }

  @Get('tab')
  @RequirePermissions('customer:read')
  tab(@CurrentUser() user: AuthUser) {
    return this.service.tab(user)
  }

  @Get('check-duplicate')
  @RequirePermissions('customer:read')
  checkDuplicate(@CurrentUser() user: AuthUser, @Query() query: CheckDuplicateQueryDto) {
    return this.service.checkDuplicate(user, query)
  }

  @Post('merge/page')
  @RequirePermissions('customer:read')
  mergePage(@CurrentUser() user: AuthUser, @Body() dto: AccountPageDto) {
    return this.service.page(user, dto)
  }

  @Post('merge/preview')
  @RequirePermissions('customer:merge')
  mergePreview(@CurrentUser() user: AuthUser, @Body() dto: CustomerMergeDto) {
    return this.service.mergePreview(user, dto)
  }

  @Post('merge')
  @RequirePermissions('customer:merge')
  @LogOperation('customer', 'merge')
  merge(@CurrentUser() user: AuthUser, @Body() dto: CustomerMergeDto) {
    return this.service.merge(user, dto)
  }

  @Post('chart')
  @RequirePermissions('customer:read')
  chart(@CurrentUser() user: AuthUser, @Body() dto: AccountChartDto) {
    return this.service.chart(user, dto)
  }

  @Post('opportunity/page')
  @RequirePermissions('customer:read')
  opportunities(@CurrentUser() user: AuthUser, @Body() dto: AccountResourcePageDto) {
    return this.resource(user, dto, 'opportunities')
  }

  @Post('contract/page')
  @RequirePermissions('customer:read')
  contracts(@CurrentUser() user: AuthUser, @Body() dto: AccountResourcePageDto) {
    return this.resource(user, dto, 'contracts')
  }

  @Post('contract/payment-plan/page')
  @RequirePermissions('customer:read')
  plans(@CurrentUser() user: AuthUser, @Body() dto: AccountResourcePageDto) {
    return this.resource(user, dto, 'receivablePlans')
  }

  @Post('contract/payment-record/page')
  @RequirePermissions('customer:read')
  records(@CurrentUser() user: AuthUser, @Body() dto: AccountResourcePageDto) {
    return this.resource(user, dto, 'receivableRecords')
  }

  @Post('invoice/page')
  @RequirePermissions('customer:read')
  invoices(@CurrentUser() user: AuthUser, @Body() dto: AccountResourcePageDto) {
    return this.resource(user, dto, 'invoices')
  }

  @Post('order/page')
  @RequirePermissions('customer:read')
  orders(@CurrentUser() user: AuthUser, @Body() dto: AccountResourcePageDto) {
    return this.resource(user, dto, 'orders')
  }

  @Get('contract/statistic/:accountId')
  @RequirePermissions('customer:read')
  contractStatistic(@CurrentUser() user: AuthUser, @Param('accountId') accountId: string) {
    return this.service.resourceStatistic(user, accountId, 'contracts')
  }

  @Get('contract/payment-plan/statistic/:accountId')
  @RequirePermissions('customer:read')
  planStatistic(@CurrentUser() user: AuthUser, @Param('accountId') accountId: string) {
    return this.service.resourceStatistic(user, accountId, 'receivablePlans')
  }

  @Get('contract/payment-record/statistic/:accountId')
  @RequirePermissions('customer:read')
  recordStatistic(@CurrentUser() user: AuthUser, @Param('accountId') accountId: string) {
    return this.service.resourceStatistic(user, accountId, 'receivableRecords')
  }

  @Get('invoice/statistic/:accountId')
  @RequirePermissions('customer:read')
  invoiceStatistic(@CurrentUser() user: AuthUser, @Param('accountId') accountId: string) {
    return this.service.resourceStatistic(user, accountId, 'invoices')
  }

  @Post('export-all')
  @RequirePermissions('customer:export')
  @LogOperation('customer', 'exportAll')
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: AccountExportDto) {
    return this.service.exportXlsx(
      user,
      {
        page: dto.current,
        pageSize: dto.pageSize,
        keyword: dto.keyword,
        viewId: dto.viewId,
        view: dto.view,
        filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
      },
      { fileName: dto.fileName, headList: dto.headList },
    )
  }

  @Post('export-select')
  @RequirePermissions('customer:export')
  @LogOperation('customer', 'exportSelected')
  exportSelect(@CurrentUser() user: AuthUser, @Body() dto: AccountExportSelectDto) {
    return this.service.exportXlsx(
      user,
      {},
      { fileName: dto.fileName, headList: dto.headList, ids: dto.ids },
    )
  }

  @Get('template/download')
  @RequirePermissions('customer:import')
  async template(
    @CurrentUser() user: AuthUser,
    @Query('importType') importType: ImportType = 'ADD',
  ) {
    const result = await this.service.importTemplate(user, importType)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('import/pre-check')
  @RequirePermissions('customer:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  precheck(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.precheckImportXlsx(user, file.buffer, importType)
  }

  @Post('import')
  @RequirePermissions('customer:import')
  @LogOperation('customer', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.importXlsx(user, file.buffer, importType)
  }

  private async resource(
    user: AuthUser,
    dto: AccountResourcePageDto,
    resource:
      | 'opportunities'
      | 'contracts'
      | 'receivablePlans'
      | 'receivableRecords'
      | 'invoices'
      | 'orders',
  ) {
    const result = await this.service.relatedResource(
      user,
      dto.accountId,
      resource,
      dto.current,
      dto.pageSize,
    )
    return {
      list: result.items,
      total: result.total,
      current: result.page,
      pageSize: result.pageSize,
      optionMap: {},
    }
  }
}
