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
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  PoolBatchIdsDto,
  PoolResourceBatchEditDto,
} from '../../common/dto/resource-batch.dto'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { toResourcePoolOption } from '../pool-rules/pool-options.controller'
import { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import {
  ClueChartDto,
  ClueExportDto,
  ClueExportSelectDto,
  PoolClueAssignDto,
  PoolClueBatchAssignDto,
  PoolClueBatchDto,
  PoolCluePageDto,
  PoolCluePickDto,
} from './dto/clue.dto'
import { LeadsService } from './leads.service'

type UploadedBufferFile = { buffer: Buffer }

@ApiTags('线索池')
@ApiBearerAuth()
@Controller('pool/lead')
export class PoolClueController {
  constructor(
    private readonly service: LeadsService,
    private readonly pools: ResourcePoolsService,
  ) {}

  @Get('options')
  @RequirePermissions('leadPool:read')
  @ApiOperation({ summary: '当前用户可访问的线索池选项' })
  async options(@CurrentUser() user: AuthUser) {
    const pools = await this.pools.options(user, 'lead')
    return pools.map((pool) => toResourcePoolOption('lead', pool))
  }

  @Post('page')
  @RequirePermissions('leadPool:read')
  @ApiOperation({ summary: '线索池列表' })
  page(@CurrentUser() user: AuthUser, @Body() dto: PoolCluePageDto) {
    return this.service.poolPage(user, dto.poolId, dto)
  }

  @Post('pick')
  @RequirePermissions('leadPool:pick')
  @LogOperation('leadPool', 'pick')
  @ApiOperation({ summary: '领取线索' })
  async pick(@CurrentUser() user: AuthUser, @Body() dto: PoolCluePickDto) {
    const result = await this.service.batchClaim(user, [dto.clueId], dto.poolId)
    if (result.fail) throw new BadRequestException('线索领取失败')
    return { id: dto.clueId }
  }

  @Post('assign')
  @RequirePermissions('leadPool:assign')
  @LogOperation('leadPool', 'assign')
  @ApiOperation({ summary: '分配线索' })
  assign(@CurrentUser() user: AuthUser, @Body() dto: PoolClueAssignDto) {
    return this.service.assign(user, dto.clueId, { ownerId: dto.assignUserId })
  }

  @Get('delete/:id')
  @RequirePermissions('leadPool:delete')
  @LogOperation('leadPool', 'delete')
  @ApiOperation({ summary: '删除线索池线索' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const lead = await this.service.findPoolOne(user, id)
    return this.service.poolBatchDelete(user, lead.poolId as string, [id])
  }

  @Get('get/:id')
  @RequirePermissions('leadPool:read')
  @ApiOperation({ summary: '线索池详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findPoolOne(user, id)
  }

  @Post('batch-pick')
  @RequirePermissions('leadPool:pick')
  @LogOperation('leadPool', 'batchPick')
  @ApiOperation({ summary: '批量领取线索' })
  batchPick(@CurrentUser() user: AuthUser, @Body() dto: PoolClueBatchDto) {
    if (!dto.poolId) throw new BadRequestException('请选择线索池')
    return this.service.batchClaim(user, dto.batchIds, dto.poolId)
  }

  @Post('batch-assign')
  @RequirePermissions('leadPool:assign')
  @LogOperation('leadPool', 'batchAssign')
  @ApiOperation({ summary: '批量分配线索' })
  batchAssign(@CurrentUser() user: AuthUser, @Body() dto: PoolClueBatchAssignDto) {
    return this.service.batchAssign(user, dto.batchIds, dto.assignUserId)
  }

  @Post('batch-update')
  @RequirePermissions('leadPool:update')
  @LogOperation('leadPool', 'batchUpdate')
  @ApiOperation({ summary: '批量更新线索池线索' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: PoolResourceBatchEditDto) {
    return this.service.poolBatchUpdate(user, dto)
  }

  @Post('batch-delete')
  @RequirePermissions('leadPool:delete')
  @LogOperation('leadPool', 'batchDelete')
  @ApiOperation({ summary: '批量删除线索池线索' })
  batchDelete(@CurrentUser() user: AuthUser, @Body() dto: PoolBatchIdsDto) {
    return this.service.poolBatchDelete(user, dto.poolId, dto.ids)
  }

  @Post('export-all')
  @RequirePermissions('leadPool:export')
  @LogOperation('leadPool', 'exportAll')
  @ApiOperation({ summary: '导出全部线索池线索' })
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: ClueExportDto, @Query('poolId') poolId: string) {
    if (!poolId) throw new BadRequestException('请选择线索池')
    return this.service.exportXlsx(
      user,
      {
        page: dto.current,
        pageSize: dto.pageSize,
        keyword: dto.keyword,
        filters: dto.filters,
        viewId: dto.viewId,
        sort: dto.sort,
        scope: 'pool',
        poolId,
      },
      { fileName: dto.fileName, headList: dto.headList, poolId },
    )
  }

  @Post('export-select')
  @RequirePermissions('leadPool:export')
  @LogOperation('leadPool', 'exportSelected')
  @ApiOperation({ summary: '导出选中线索池线索' })
  exportSelected(
    @CurrentUser() user: AuthUser,
    @Body() dto: ClueExportSelectDto,
    @Query('poolId') poolId: string,
  ) {
    if (!poolId) throw new BadRequestException('请选择线索池')
    return this.service.exportXlsx(
      user,
      { scope: 'pool', poolId },
      { fileName: dto.fileName, headList: dto.headList, ids: dto.ids, poolId },
    )
  }

  @Post('chart')
  @RequirePermissions('leadPool:read')
  @ApiOperation({ summary: '线索池图表生成' })
  async chart(@CurrentUser() user: AuthUser, @Body() dto: ClueChartDto, @Query('poolId') poolId: string) {
    if (!poolId) throw new BadRequestException('请选择线索池')
    await this.pools.assertPoolMember(user, 'lead', poolId)
    return this.service.chart(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('leadPool:import')
  @ApiOperation({ summary: '下载线索池导入模板' })
  async template(
    @CurrentUser() user: AuthUser,
    @Query('poolId') poolId: string,
    @Query('importType') importType: ImportType = 'ADD',
  ) {
    if (!poolId) throw new BadRequestException('请选择线索池')
    const result = await this.service.importTemplate(user, importType, poolId)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('import/pre-check')
  @RequirePermissions('leadPool:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '线索池导入预校验' })
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('poolId') poolId: string,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    if (!poolId) throw new BadRequestException('请选择线索池')
    return this.service.precheckImportXlsx(user, file.buffer, importType, poolId)
  }

  @Post('import')
  @RequirePermissions('leadPool:import')
  @LogOperation('leadPool', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入线索池线索' })
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('poolId') poolId: string,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    if (!poolId) throw new BadRequestException('请选择线索池')
    return this.service.importXlsx(user, file.buffer, importType, poolId)
  }
}
