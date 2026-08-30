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
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator'
import type { ImportType } from '../import-export/dto/import-export.dto'
import {
  ContractPaymentPlanService,
  ContractPaymentRecordService,
} from './contract-payment.service'
import {
  ContractPaymentBatchUpdateDto,
  ContractPaymentExportDto,
  ContractPaymentExportSelectDto,
  ContractPaymentPageDto,
  ContractPaymentPlanAddDto,
  ContractPaymentPlanUpdateDto,
  ContractPaymentRecordAddDto,
  ContractPaymentRecordUpdateDto,
} from './dto/contract-payment.dto'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('合同回款计划')
@ApiBearerAuth()
@Controller('contract/payment-plan')
export class ContractPaymentPlanController {
  constructor(private readonly service: ContractPaymentPlanService) {}

  @Get('module/form')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:READ')
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.form(user)
  }

  @Post('page')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:READ')
  page(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentPageDto) {
    return this.service.page(user, dto)
  }

  @Get('get/:id')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:READ')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @Post('add')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:ADD')
  @LogOperation('contractPaymentPlan', 'create')
  add(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentPlanAddDto) {
    return this.service.add(user, dto)
  }

  @Post('update')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:UPDATE')
  @LogOperation('contractPaymentPlan', 'update')
  update(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentPlanUpdateDto) {
    return this.service.update(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:DELETE')
  @LogOperation('contractPaymentPlan', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Get('tab')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:READ')
  tab(@CurrentUser() user: AuthUser) {
    return this.service.tab(user)
  }

  @Post('batch/update')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:UPDATE')
  @LogOperation('contractPaymentPlan', 'batchUpdate')
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentBatchUpdateDto) {
    return this.service.batchUpdate(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:IMPORT')
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
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:IMPORT')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.precheckImportXlsx(user, file.buffer, importType)
  }

  @Post('import')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:IMPORT')
  @LogOperation('contractPaymentPlan', 'import')
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

  @Post('export-all')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:EXPORT')
  @LogOperation('contractPaymentPlan', 'exportAll')
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentExportDto) {
    return this.service.exportAll(user, dto)
  }

  @Post('export-select')
  @RequirePermissions('CONTRACT_PAYMENT_PLAN:EXPORT')
  @LogOperation('contractPaymentPlan', 'exportSelected')
  exportSelected(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentExportSelectDto) {
    return this.service.exportSelected(user, dto)
  }

}

@ApiTags('合同回款记录')
@ApiBearerAuth()
@Controller('contract/payment-record')
export class ContractPaymentRecordController {
  constructor(private readonly service: ContractPaymentRecordService) {}

  @Get('module/form')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:READ')
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.form(user)
  }

  @Post('page')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:READ')
  page(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentPageDto) {
    return this.service.page(user, dto)
  }

  @Post('add')
  @RequireAnyPermissions('CONTRACT_PAYMENT_RECORD:ADD', 'CONTRACT:PAYMENT')
  @LogOperation('contractPaymentRecord', 'create')
  add(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentRecordAddDto) {
    return this.service.add(user, dto)
  }

  @Post('update')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:UPDATE')
  @LogOperation('contractPaymentRecord', 'update')
  update(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentRecordUpdateDto) {
    return this.service.update(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:DELETE')
  @LogOperation('contractPaymentRecord', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Get('get/:id')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:READ')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @Get('tab')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:READ')
  tab(@CurrentUser() user: AuthUser) {
    return this.service.tab(user)
  }

  @Post('statistic')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:READ')
  statistic(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentPageDto) {
    return this.service.statistic(user, dto)
  }

  @Post('batch/update')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:UPDATE')
  @LogOperation('contractPaymentRecord', 'batchUpdate')
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentBatchUpdateDto) {
    return this.service.batchUpdate(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:IMPORT')
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
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:IMPORT')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.precheckImportXlsx(user, file.buffer, importType)
  }

  @Post('import')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:IMPORT')
  @LogOperation('contractPaymentRecord', 'import')
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

  @Post('export-all')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:EXPORT')
  @LogOperation('contractPaymentRecord', 'exportAll')
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentExportDto) {
    return this.service.exportAll(user, dto)
  }

  @Post('export-select')
  @RequirePermissions('CONTRACT_PAYMENT_RECORD:EXPORT')
  @LogOperation('contractPaymentRecord', 'exportSelected')
  exportSelected(@CurrentUser() user: AuthUser, @Body() dto: ContractPaymentExportSelectDto) {
    return this.service.exportSelected(user, dto)
  }
}
