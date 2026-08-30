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
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { BusinessTitleService } from './business-title.service'
import { ContractInvoiceService } from './contract-invoice.service'
import {
  ApprovalResourceBaseDto,
  BusinessTitleAddDto,
  BusinessTitleApprovalDto,
  BusinessTitleExportDto,
  BusinessTitleExportSelectDto,
  BusinessTitlePageDto,
  BusinessTitleUpdateDto,
  ContractInvoiceAddDto,
  ContractInvoiceExportDto,
  ContractInvoiceExportSelectDto,
  ContractInvoicePageDto,
  ContractInvoiceUpdateDto,
} from './dto/contract-invoice.dto'

type UploadedBufferFile = { buffer: Buffer }

@ApiTags('合同发票')
@ApiBearerAuth()
@Controller('invoice')
export class ContractInvoiceController {
  constructor(private readonly service: ContractInvoiceService) {}

  @Get('module/form')
  @RequirePermissions('CONTRACT_INVOICE:READ')
  form(@CurrentUser() user: AuthUser) {
    return this.service.form(user)
  }

  @Post('page')
  @RequirePermissions('CONTRACT_INVOICE:READ')
  page(@CurrentUser() user: AuthUser, @Body() dto: ContractInvoicePageDto) {
    return this.service.page(user, dto)
  }

  @Get('get/snapshot/:id')
  @RequirePermissions('CONTRACT_INVOICE:READ')
  snapshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getSnapshot(user, id)
  }

  @Get('get/:id')
  @RequirePermissions('CONTRACT_INVOICE:READ')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @Post('add')
  @RequirePermissions('CONTRACT_INVOICE:ADD')
  @LogOperation('contractInvoice', 'create')
  add(@CurrentUser() user: AuthUser, @Body() dto: ContractInvoiceAddDto) {
    return this.service.add(user, dto)
  }

  @Post('update')
  @RequirePermissions('CONTRACT_INVOICE:UPDATE')
  @LogOperation('contractInvoice', 'update')
  update(@CurrentUser() user: AuthUser, @Body() dto: ContractInvoiceUpdateDto) {
    return this.service.update(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('CONTRACT_INVOICE:DELETE')
  @LogOperation('contractInvoice', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('batch/delete')
  @RequirePermissions('CONTRACT_INVOICE:DELETE')
  @LogOperation('contractInvoice', 'batchDelete')
  batchDelete(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    return this.service.batchDelete(user, ids)
  }

  @Get('module/form/snapshot/:id')
  @RequirePermissions('CONTRACT_INVOICE:READ')
  formSnapshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.formSnapshot(user, id)
  }

  @Get('tab')
  @RequirePermissions('CONTRACT_INVOICE:READ')
  tab(@CurrentUser() user: AuthUser) {
    return this.service.tab(user)
  }

  @Post('export-all')
  @RequirePermissions('CONTRACT_INVOICE:EXPORT')
  @LogOperation('contractInvoice', 'exportAll')
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: ContractInvoiceExportDto) {
    return this.service.exportAll(user, dto)
  }

  @Post('export-select')
  @RequirePermissions('CONTRACT_INVOICE:EXPORT')
  @LogOperation('contractInvoice', 'exportSelected')
  exportSelected(@CurrentUser() user: AuthUser, @Body() dto: ContractInvoiceExportSelectDto) {
    return this.service.exportSelected(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('CONTRACT_INVOICE:IMPORT')
  async template(@CurrentUser() user: AuthUser, @Query('importType') importType: ImportType = 'ADD') {
    const result = await this.service.importTemplate(user, importType)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('import/pre-check')
  @RequirePermissions('CONTRACT_INVOICE:IMPORT')
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
  @RequirePermissions('CONTRACT_INVOICE:IMPORT')
  @LogOperation('contractInvoice', 'import')
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
}

@ApiTags('工商抬头')
@ApiBearerAuth()
@Controller('contract/business-title')
export class BusinessTitleController {
  constructor(private readonly service: BusinessTitleService) {}

  @Get('module/form')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:READ')
  form(@CurrentUser() user: AuthUser) {
    return this.service.form(user)
  }

  @Post('page')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:READ')
  page(@CurrentUser() user: AuthUser, @Body() dto: BusinessTitlePageDto) {
    return this.service.page(user, dto)
  }

  @Get('get/:id')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:READ')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @Get('option')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:READ')
  options(@CurrentUser() user: AuthUser) {
    return this.service.options(user)
  }

  @Post('add')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:ADD')
  @LogOperation('businessTitle', 'create')
  add(@CurrentUser() user: AuthUser, @Body() dto: BusinessTitleAddDto) {
    return this.service.add(user, dto)
  }

  @Post('update')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:UPDATE')
  @LogOperation('businessTitle', 'update')
  update(@CurrentUser() user: AuthUser, @Body() dto: BusinessTitleUpdateDto) {
    return this.service.update(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:DELETE')
  @LogOperation('businessTitle', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Get('invoice/check/:id')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:DELETE')
  check(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.hasInvoice(user, id)
  }

  @Post('approval')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:APPROVAL')
  @LogOperation('businessTitle', 'approval')
  approval(@CurrentUser() user: AuthUser, @Body() dto: BusinessTitleApprovalDto) {
    return this.service.approval(user, dto)
  }

  @Get('revoke/:id')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:APPROVAL')
  @LogOperation('businessTitle', 'revoke')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revoke(user, id)
  }

  @Post('export-all')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:EXPORT')
  @LogOperation('businessTitle', 'exportAll')
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: BusinessTitleExportDto) {
    return this.service.exportAll(user, dto)
  }

  @Post('export-select')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:EXPORT')
  @LogOperation('businessTitle', 'exportSelected')
  exportSelected(@CurrentUser() user: AuthUser, @Body() dto: BusinessTitleExportSelectDto) {
    return this.service.exportSelected(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:IMPORT')
  async template(@CurrentUser() user: AuthUser, @Query('importType') importType: ImportType = 'ADD') {
    const result = await this.service.importTemplate(user, importType)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('import/pre-check')
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:IMPORT')
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
  @RequirePermissions('CONTRACT_BUSINESS_TITLE:IMPORT')
  @LogOperation('businessTitle', 'import')
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
}

@ApiTags('工商抬头配置')
@ApiBearerAuth()
@Controller('business-title/config')
export class BusinessTitleConfigController {
  constructor(private readonly service: BusinessTitleService) {}

  @Get('get')
  config(@CurrentUser() user: AuthUser) {
    return this.service.config(user)
  }

  @Get('switch/:id')
  @RequirePermissions('system:module:update')
  @LogOperation('businessTitleConfig', 'switchRequired')
  switchRequired(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.switchRequired(user, id)
  }
}

@ApiTags('合同详情发票')
@ApiBearerAuth()
@Controller('contract')
export class ContractInvoiceDetailController {
  constructor(private readonly service: ContractInvoiceService) {}

  @Post('invoice/page')
  @RequirePermissions('menu:contract', 'CONTRACT_INVOICE:READ')
  page(@CurrentUser() user: AuthUser, @Body() dto: ContractInvoicePageDto) {
    return this.service.page(user, { ...dto, viewId: 'ALL' })
  }

  @Get('invoice/statistic/:contractId')
  @RequirePermissions('menu:contract', 'CONTRACT_INVOICE:READ')
  statistic(@CurrentUser() user: AuthUser, @Param('contractId') contractId: string) {
    return this.service.contractStatistic(user, contractId)
  }
}

@ApiTags('审批资源')
@ApiBearerAuth()
@Controller('approval-resource')
export class InvoiceApprovalResourceController {
  constructor(private readonly service: ContractInvoiceService) {}

  @Post('push')
  @RequirePermissions('CONTRACT_INVOICE:UPDATE')
  @LogOperation('contractInvoice', 'approvalPush')
  push(@CurrentUser() user: AuthUser, @Body() dto: ApprovalResourceBaseDto) {
    return this.service.pushApproval(user, dto.resourceId)
  }

  @Post('revoke')
  @RequirePermissions('CONTRACT_INVOICE:UPDATE')
  @LogOperation('contractInvoice', 'approvalRevoke')
  revoke(@CurrentUser() user: AuthUser, @Body() dto: ApprovalResourceBaseDto) {
    return this.service.revokeApproval(user, dto.resourceId)
  }

  @Get('simple-detail/:resourceId')
  @RequirePermissions('CONTRACT_INVOICE:READ')
  simpleDetail(@CurrentUser() user: AuthUser, @Param('resourceId') resourceId: string) {
    return this.service.approvalSimpleDetail(user, resourceId)
  }

  @Get('detail/:resourceId')
  @RequirePermissions('CONTRACT_INVOICE:READ')
  detail(@CurrentUser() user: AuthUser, @Param('resourceId') resourceId: string) {
    return this.service.approvalDetail(user, resourceId)
  }
}
