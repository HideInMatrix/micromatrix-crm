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
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { LogOperation } from '../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { ResourceBatchEditDto } from '../common/dto/resource-batch.dto'
import type { ImportType } from '../modules/import-export/dto/import-export.dto'
import { CustomersService } from './customers.service'
import {
  AccountExportSelectDto,
  PoolAccountAssignDto,
  PoolAccountBatchAssignDto,
  PoolAccountBatchDto,
  PoolAccountBatchPickDto,
  PoolAccountChartDto,
  PoolAccountExportDto,
  PoolAccountPageDto,
  PoolAccountPickDto,
} from './dto/account.dto'

type UploadedBufferFile = { buffer: Buffer }

@ApiTags('客户公海')
@ApiBearerAuth()
@Controller('pool/account')
export class PoolAccountController {
  constructor(private readonly service: CustomersService) {}

  @Get('options')
  @RequirePermissions('customerPool:read')
  options(@CurrentUser() user: AuthUser) {
    return this.service.poolOptions(user)
  }

  @Post('page')
  @RequirePermissions('customerPool:read')
  page(@CurrentUser() user: AuthUser, @Body() dto: PoolAccountPageDto) {
    return this.service.poolPage(user, dto.poolId, dto)
  }

  @Get('get/:id')
  @RequirePermissions('customerPool:read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findPoolOne(user, id)
  }

  @Post('pick')
  @RequirePermissions('customerPool:pick')
  @LogOperation('customerPool', 'pick')
  pick(@CurrentUser() user: AuthUser, @Body() dto: PoolAccountPickDto) {
    return this.service.claimFromSea(user, dto.customerId, dto.poolId)
  }

  @Post('assign')
  @RequirePermissions('customerPool:assign')
  @LogOperation('customerPool', 'assign')
  assign(@CurrentUser() user: AuthUser, @Body() dto: PoolAccountAssignDto) {
    return this.service.poolAssignOwner(user, dto.customerId, dto.assignUserId)
  }

  @Get('delete/:id')
  @RequirePermissions('customerPool:delete')
  @LogOperation('customerPool', 'delete')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const customer = await this.service.findPoolOne(user, id)
    if (!customer.poolId) throw new BadRequestException('客户不属于公海')
    return this.service.poolBatchDelete(user, customer.poolId, [id])
  }

  @Post('batch-pick')
  @RequirePermissions('customerPool:pick')
  @LogOperation('customerPool', 'batchPick')
  batchPick(@CurrentUser() user: AuthUser, @Body() dto: PoolAccountBatchPickDto) {
    return this.service.batchClaimFromSea(user, dto.batchIds, dto.poolId)
  }

  @Post('batch-assign')
  @RequirePermissions('customerPool:assign')
  @LogOperation('customerPool', 'batchAssign')
  batchAssign(@CurrentUser() user: AuthUser, @Body() dto: PoolAccountBatchAssignDto) {
    return this.service.poolBatchAssignOwner(user, dto.batchIds, dto.assignUserId)
  }

  @Post('batch-update')
  @RequirePermissions('customerPool:update')
  @LogOperation('customerPool', 'batchUpdate')
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.service.poolBatchUpdateExact(user, dto)
  }

  @Post('batch-delete')
  @RequirePermissions('customerPool:delete')
  @LogOperation('customerPool', 'batchDelete')
  batchDelete(@CurrentUser() user: AuthUser, @Body() dto: PoolAccountBatchDto) {
    return this.service.poolBatchDeleteExact(user, dto.batchIds)
  }

  @Post('export-all')
  @RequirePermissions('customerPool:export')
  @LogOperation('customerPool', 'exportAll')
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: PoolAccountExportDto) {
    return this.service.exportXlsx(
      user,
      {
        page: dto.current,
        pageSize: dto.pageSize,
        keyword: dto.keyword,
        viewId: dto.viewId,
        filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
        scope: 'sea',
        poolId: dto.poolId,
      },
      { fileName: dto.fileName, headList: dto.headList, poolId: dto.poolId },
    )
  }

  @Post('export-select')
  @RequirePermissions('customerPool:export')
  @LogOperation('customerPool', 'exportSelected')
  async exportSelect(@CurrentUser() user: AuthUser, @Body() dto: AccountExportSelectDto) {
    const poolId = await this.service.resolvePoolSelection(user, dto.ids)
    return this.service.exportXlsx(
      user,
      { scope: 'sea' },
      { fileName: dto.fileName, headList: dto.headList, ids: dto.ids, poolId },
    )
  }

  @Post('chart')
  @RequirePermissions('customerPool:read')
  chart(@CurrentUser() user: AuthUser, @Body() dto: PoolAccountChartDto) {
    return this.service.chart(user, dto, dto.poolId)
  }

  @Get('template/download')
  @RequirePermissions('customerPool:import')
  async template(
    @CurrentUser() user: AuthUser,
    @Query('importType') importType: ImportType = 'ADD',
  ) {
    const result = await this.service.poolImportTemplate(user, importType)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('import/pre-check')
  @RequirePermissions('customerPool:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  precheck(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('poolId') poolId: string,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    if (!poolId) throw new BadRequestException('请选择客户公海')
    return this.service.precheckImportXlsx(user, file.buffer, importType, poolId)
  }

  @Post('import')
  @RequirePermissions('customerPool:import')
  @LogOperation('customerPool', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('poolId') poolId: string,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    if (!poolId) throw new BadRequestException('请选择客户公海')
    return this.service.importXlsx(user, file.buffer, importType, poolId)
  }
}
