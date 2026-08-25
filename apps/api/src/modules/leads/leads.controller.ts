import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  BatchAssignOwnerDto,
  BatchClaimDto,
  BatchMoveToPoolDto,
  BatchIdsDto,
  PoolBatchIdsDto,
  PoolResourceBatchEditDto,
  ResourceBatchEditDto,
} from '../../common/dto/resource-batch.dto'
import { MoveToResourcePoolDto } from '../../common/dto/move-to-resource-pool.dto'
import {
  ExportCreateDto,
  ExportSelectDto,
  ImportUploadDto,
  type ImportType,
} from '../import-export/dto/import-export.dto'
import {
  AssignLeadDto,
  CreateLeadDto,
  QueryLeadsDto,
  RetransitionLeadCustomerDto,
  TransformLeadDto,
  TransitionCustomerQueryDto,
  TransitionLeadCustomerDto,
  UpdateLeadDto,
} from './dto/lead.dto'
import { LeadsService } from './leads.service'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('线索')
@ApiBearerAuth()
@RequirePermissions('menu:lead')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @ApiOperation({ summary: '线索列表（scope=pool 为线索池）' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryLeadsDto) {
    return this.leadsService.findAll(user, query)
  }

  @Get('export')
  @RequirePermissions('lead:import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: '导出线索 CSV' })
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryLeadsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.leadsService.exportCsv(user, query)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    return csv
  }

  @Post('import/rows')
  @RequirePermissions('lead:import')
  @LogOperation('lead', 'importRows')
  @ApiOperation({ summary: '兼容旧结构化行导入' })
  bulkImport(@CurrentUser() user: AuthUser, @Body() body: { rows: Record<string, unknown>[] }) {
    return this.leadsService.bulkImport(user, body.rows ?? [])
  }

  @Get('import/template')
  @RequirePermissions('lead:import')
  @ApiOperation({ summary: '下载线索 xlsx 导入模板' })
  async importTemplate(
    @CurrentUser() user: AuthUser,
    @Query('importType') importType: ImportType = 'ADD',
  ) {
    const result = await this.leadsService.importTemplate(user, importType)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('import/pre-check')
  @RequirePermissions('lead:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        importType: { enum: ['ADD', 'UPDATE'] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: '线索 xlsx 导入预校验' })
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body() dto: ImportUploadDto,
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.leadsService.precheckImportXlsx(user, file.buffer, dto.importType)
  }

  @Post('import')
  @RequirePermissions('lead:import')
  @LogOperation('lead', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '正式导入线索 xlsx（合法行成功、错误行返回原因）' })
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body() dto: ImportUploadDto,
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.leadsService.importXlsx(user, file.buffer, dto.importType)
  }

  @Get('pool/import/template')
  @RequirePermissions('leadPool:import')
  @ApiOperation({ summary: '下载线索池 xlsx 导入模板' })
  async poolImportTemplate(
    @CurrentUser() user: AuthUser,
    @Query('poolId') poolId: string,
    @Query('importType') importType: ImportType = 'ADD',
  ) {
    if (!poolId) throw new BadRequestException('请选择线索池')
    const result = await this.leadsService.importTemplate(user, importType, poolId)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('pool/import/pre-check')
  @RequirePermissions('leadPool:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '线索池 xlsx 导入预校验' })
  poolPrecheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body() dto: ImportUploadDto,
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    if (!dto.poolId) throw new BadRequestException('请选择线索池')
    return this.leadsService.precheckImportXlsx(user, file.buffer, dto.importType, dto.poolId)
  }

  @Post('pool/import')
  @RequirePermissions('leadPool:import')
  @LogOperation('leadPool', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '正式导入线索池 xlsx' })
  poolImportXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body() dto: ImportUploadDto,
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    if (!dto.poolId) throw new BadRequestException('请选择线索池')
    return this.leadsService.importXlsx(user, file.buffer, dto.importType, dto.poolId)
  }

  @Post('export/all')
  @RequirePermissions('lead:export')
  @LogOperation('lead', 'exportAll')
  @ApiOperation({ summary: '按当前筛选创建全部线索 xlsx 导出任务' })
  exportAll(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryLeadsDto,
    @Body() dto: ExportCreateDto,
  ) {
    return this.leadsService.exportXlsx(user, { ...query, scope: 'mine' }, dto)
  }

  @Post('export/select')
  @RequirePermissions('lead:export')
  @LogOperation('lead', 'exportSelected')
  @ApiOperation({ summary: '创建选中线索 xlsx 导出任务' })
  exportSelected(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryLeadsDto,
    @Body() dto: ExportSelectDto,
  ) {
    return this.leadsService.exportXlsx(user, { ...query, scope: 'mine' }, dto)
  }

  @Post('pool/export/all')
  @RequirePermissions('leadPool:export')
  @LogOperation('leadPool', 'exportAll')
  @ApiOperation({ summary: '按当前筛选创建线索池全部 xlsx 导出任务' })
  poolExportAll(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryLeadsDto,
    @Query('poolId') poolId: string,
    @Body() dto: ExportCreateDto,
  ) {
    if (!poolId) throw new BadRequestException('请选择线索池')
    return this.leadsService.exportXlsx(
      user,
      { ...query, scope: 'pool', poolId },
      { ...dto, poolId },
    )
  }

  @Post('pool/export/select')
  @RequirePermissions('leadPool:export')
  @LogOperation('leadPool', 'exportSelected')
  @ApiOperation({ summary: '创建线索池选中数据 xlsx 导出任务' })
  poolExportSelected(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryLeadsDto,
    @Query('poolId') poolId: string,
    @Body() dto: ExportSelectDto,
  ) {
    if (!poolId) throw new BadRequestException('请选择线索池')
    return this.leadsService.exportXlsx(
      user,
      { ...query, scope: 'pool', poolId },
      { ...dto, poolId },
    )
  }

  @Post('batch/claim')
  @LogOperation('lead', 'batchClaim')
  @ApiOperation({ summary: '批量领取线索' })
  batchClaim(@CurrentUser() user: AuthUser, @Body() dto: BatchClaimDto) {
    return this.leadsService.batchClaim(user, dto.ids, dto.poolId)
  }

  @Post('batch/assign')
  @RequirePermissions('lead:assign')
  @LogOperation('lead', 'batchAssign')
  @ApiOperation({ summary: '批量分配线索负责人' })
  batchAssign(@CurrentUser() user: AuthUser, @Body() dto: BatchAssignOwnerDto) {
    return this.leadsService.batchAssign(user, dto.ids, dto.ownerId)
  }

  @Post('batch/to-pool')
  @RequirePermissions('lead:assign')
  @LogOperation('lead', 'batchToPool')
  @ApiOperation({ summary: '批量退回线索池' })
  batchMoveToPool(@CurrentUser() user: AuthUser, @Body() dto: BatchMoveToPoolDto) {
    return this.leadsService.batchMoveToPool(user, dto.ids, dto.poolId, dto.reasonId)
  }

  @Post('batch/update')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'batchUpdate')
  @ApiOperation({ summary: '批量修改线索单个字段' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.leadsService.batchUpdate(user, dto)
  }

  @Post('batch/delete')
  @RequirePermissions('lead:delete')
  @LogOperation('lead', 'batchDelete')
  @ApiOperation({ summary: '批量删除线索' })
  batchDelete(@CurrentUser() user: AuthUser, @Body() dto: BatchIdsDto) {
    return this.leadsService.batchDelete(user, dto.ids)
  }

  @Post('pool/batch/update')
  @RequirePermissions('leadPool:update')
  @LogOperation('leadPool', 'batchUpdate')
  @ApiOperation({ summary: '线索池批量修改字段（独立池权限）' })
  poolBatchUpdate(@CurrentUser() user: AuthUser, @Body() dto: PoolResourceBatchEditDto) {
    return this.leadsService.poolBatchUpdate(user, dto)
  }

  @Post('pool/batch/delete')
  @RequirePermissions('leadPool:delete')
  @LogOperation('leadPool', 'batchDelete')
  @ApiOperation({ summary: '线索池批量删除（独立池权限）' })
  poolBatchDelete(@CurrentUser() user: AuthUser, @Body() dto: PoolBatchIdsDto) {
    return this.leadsService.poolBatchDelete(user, dto.poolId, dto.ids)
  }

  @Post()
  @RequirePermissions('lead:create')
  @LogOperation('lead', 'create')
  @ApiOperation({ summary: '新建线索' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'update')
  @ApiOperation({ summary: '更新线索' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(user, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('lead:delete')
  @LogOperation('lead', 'delete')
  @ApiOperation({ summary: '删除线索' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.remove(user, id)
  }

  @Post(':id/to-pool')
  @RequirePermissions('lead:assign')
  @LogOperation('lead', 'toPool')
  @ApiOperation({ summary: '退回线索池' })
  moveToPool(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveToResourcePoolDto,
  ) {
    return this.leadsService.moveToPool(user, id, dto?.poolId, dto?.reasonId)
  }

  @Post(':id/claim')
  @LogOperation('lead', 'claim')
  @ApiOperation({ summary: '从线索池领取' })
  claim(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.claim(user, id)
  }

  @Post(':id/assign')
  @RequirePermissions('lead:assign')
  @LogOperation('lead', 'assign')
  @ApiOperation({ summary: '分配负责人' })
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignLeadDto) {
    return this.leadsService.assign(user, id, dto)
  }

  @Get(':id/owner-history')
  @ApiOperation({ summary: '线索负责人历史' })
  ownerHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.ownerHistory(user, id)
  }

  @Post(':id/invalid')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'invalid')
  @ApiOperation({ summary: '标记无效' })
  markInvalid(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.markInvalid(user, id)
  }

  @Post('transform')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'transform')
  @ApiOperation({ summary: '自动转换线索：客户+联系人，商机可选' })
  transform(@CurrentUser() user: AuthUser, @Body() dto: TransformLeadDto) {
    return this.leadsService.transform(user, dto)
  }

  @Post('transition/account')
  @RequirePermissions('customer:create')
  @LogOperation('lead', 'transitionCustomer')
  @ApiOperation({ summary: '新建客户并关联线索' })
  transitionCustomer(@CurrentUser() user: AuthUser, @Body() dto: TransitionLeadCustomerDto) {
    return this.leadsService.transitionCustomer(user, dto)
  }

  @Post('re-transition/account')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'retransitionCustomer')
  @ApiOperation({ summary: '关联/重新关联已有客户' })
  retransitionCustomer(@CurrentUser() user: AuthUser, @Body() dto: RetransitionLeadCustomerDto) {
    return this.leadsService.retransitionCustomer(user, dto)
  }

  @Post('transition/account/page')
  @RequirePermissions('menu:lead', 'menu:customer')
  @ApiOperation({ summary: '可关联客户列表：数据范围+协作+可访问公海' })
  transitionCustomerList(@CurrentUser() user: AuthUser, @Body() query: TransitionCustomerQueryDto) {
    return this.leadsService.transitionCustomerList(user, query)
  }

  // 动态 :id GET 必须放在所有静态 GET 路由之后，避免抢占 /export、/import/template 等路径。
  @Get(':id')
  @ApiOperation({ summary: '线索详情' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.findOne(user, id)
  }
}
