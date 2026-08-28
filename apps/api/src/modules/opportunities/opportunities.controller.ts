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
import { ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import type { ImportType } from '../import-export/dto/import-export.dto'
import {
  OpportunityAddDto,
  OpportunityBoardSortDto,
  OpportunityChartDto,
  OpportunityExportDto,
  OpportunityExportSelectDto,
  OpportunityPageDto,
  OpportunityStageUpdateDto,
  OpportunityStatisticDto,
  OpportunityTransferDto,
  OpportunityUpdateDto,
} from './dto/opportunity.dto'
import { OpportunitiesService } from './opportunities.service'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('商机')
@ApiBearerAuth()
@Controller('opportunity')
export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  @Get('module/form')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '获取商机表单配置' })
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.getModuleForm(user)
  }

  @Post('page')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '商机列表' })
  page(@CurrentUser() user: AuthUser, @Body() dto: OpportunityPageDto) {
    return this.service.page(user, dto)
  }

  @Post('statistic')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '商机统计' })
  statistic(@CurrentUser() user: AuthUser, @Body() dto: OpportunityStatisticDto) {
    return this.service.statistic(user, dto)
  }

  @Post('add')
  @RequirePermissions('opportunity:create')
  @LogOperation('opportunity', 'create')
  @ApiOperation({ summary: '添加商机' })
  add(@CurrentUser() user: AuthUser, @Body() dto: OpportunityAddDto) {
    return this.service.addOpportunity(user, dto)
  }

  @Post('update')
  @RequirePermissions('opportunity:update')
  @LogOperation('opportunity', 'update')
  @ApiOperation({ summary: '更新商机' })
  update(@CurrentUser() user: AuthUser, @Body() dto: OpportunityUpdateDto) {
    return this.service.updateOpportunity(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('opportunity:delete')
  @LogOperation('opportunity', 'delete')
  @ApiOperation({ summary: '删除商机' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('batch/transfer')
  @RequirePermissions('opportunity:transfer')
  @LogOperation('opportunity', 'batchTransfer')
  @ApiOperation({ summary: '批量转移商机' })
  batchTransfer(@CurrentUser() user: AuthUser, @Body() dto: OpportunityTransferDto) {
    return this.service.batchTransfer(user, dto)
  }

  @Post('batch/delete')
  @RequirePermissions('opportunity:delete')
  @LogOperation('opportunity', 'batchDelete')
  @ApiOperation({ summary: '批量删除商机' })
  batchDelete(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestException('请选择商机')
    return this.service.batchDelete(user, ids)
  }

  @Get('get/:id')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '商机详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user, id)
  }

  @Post('update/stage')
  @RequirePermissions('opportunity:update')
  @LogOperation('opportunity', 'updateStage')
  @ApiOperation({ summary: '更新商机阶段' })
  updateStage(@CurrentUser() user: AuthUser, @Body() dto: OpportunityStageUpdateDto) {
    return this.service.updateStageCordys(user, dto)
  }

  @Post('batch/update')
  @RequirePermissions('opportunity:update')
  @LogOperation('opportunity', 'batchUpdate')
  @ApiOperation({ summary: '批量更新商机' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.service.batchUpdate(user, dto)
  }

  @Get('tab')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '所有商机和部门商机 tab 是否显示' })
  tab(@CurrentUser() user: AuthUser) {
    return this.service.getTabEnable(user)
  }

  @Get('contact/list/:opportunityId')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '商机下的联系人列表' })
  contactList(@CurrentUser() user: AuthUser, @Param('opportunityId') opportunityId: string) {
    return this.service.contactList(user, opportunityId)
  }

  @Post('sort')
  @RequirePermissions('opportunity:update')
  @LogOperation('opportunity', 'sort')
  @ApiOperation({ summary: '商机阶段看板拖拽排序' })
  sort(@CurrentUser() user: AuthUser, @Body() dto: OpportunityBoardSortDto) {
    return this.service.sortBoard(user, dto)
  }

  @Post('export-all')
  @RequirePermissions('opportunity:export')
  @LogOperation('opportunity', 'exportAll')
  @ApiOperation({ summary: '商机导出全部' })
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: OpportunityExportDto) {
    return this.service.exportAll(user, dto)
  }

  @Post('export-select')
  @RequirePermissions('opportunity:export')
  @LogOperation('opportunity', 'exportSelected')
  @ApiOperation({ summary: '导出选中商机' })
  exportSelected(@CurrentUser() user: AuthUser, @Body() dto: OpportunityExportSelectDto) {
    return this.service.exportSelected(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('opportunity:import')
  @ApiOperation({ summary: '下载商机导入模板' })
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
  @RequirePermissions('opportunity:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '商机导入预校验' })
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.precheckImportXlsx(user, file.buffer, importType)
  }

  @Post('import')
  @RequirePermissions('opportunity:import')
  @LogOperation('opportunity', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入商机' })
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.importXlsx(user, file.buffer, importType)
  }

  @Post('chart')
  @RequirePermissions('menu:opportunity')
  @ApiOperation({ summary: '商机图表生成' })
  chart(@CurrentUser() user: AuthUser, @Body() dto: OpportunityChartDto) {
    return this.service.chart(user, dto)
  }
}
