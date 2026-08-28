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
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator'
import { ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import type { ImportType } from '../import-export/dto/import-export.dto'
import {
  ClueAddDto,
  ClueBatchToPoolDto,
  ClueBatchTransferDto,
  ClueChartDto,
  ClueExportDto,
  ClueExportSelectDto,
  CluePageDto,
  ClueRetransitionCustomerDto,
  ClueStatusUpdateDto,
  ClueToPoolDto,
  ClueTransitionCustomerDto,
  ClueTransitionCustomerPageDto,
  ClueUpdateDto,
  TransformClueDto,
} from './dto/clue.dto'
import { LeadsService } from './leads.service'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('线索')
@ApiBearerAuth()
@Controller('lead')
export class ClueController {
  constructor(private readonly service: LeadsService) {}

  @Get('module/form')
  @RequireAnyPermissions('menu:lead', 'leadPool:read')
  @ApiOperation({ summary: '获取线索表单配置' })
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.getModuleForm(user)
  }

  @Post('page')
  @RequirePermissions('menu:lead')
  @ApiOperation({ summary: '线索列表' })
  page(@CurrentUser() user: AuthUser, @Body() dto: CluePageDto) {
    return this.service.page(user, dto)
  }

  @Get('get/:id')
  @RequirePermissions('menu:lead')
  @ApiOperation({ summary: '线索详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user, id)
  }

  @Post('add')
  @RequirePermissions('lead:create')
  @LogOperation('lead', 'create')
  @ApiOperation({ summary: '添加线索' })
  add(@CurrentUser() user: AuthUser, @Body() dto: ClueAddDto) {
    return this.service.addClue(user, dto)
  }

  @Post('update')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'update')
  @ApiOperation({ summary: '更新线索' })
  update(@CurrentUser() user: AuthUser, @Body() dto: ClueUpdateDto) {
    return this.service.updateClue(user, dto)
  }

  @Post('status/update')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'updateStatus')
  @ApiOperation({ summary: '更新线索状态' })
  updateStatus(@CurrentUser() user: AuthUser, @Body() dto: ClueStatusUpdateDto) {
    return this.service.updateStatus(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('lead:delete')
  @LogOperation('lead', 'delete')
  @ApiOperation({ summary: '删除线索' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Post('transition/account')
  @RequirePermissions('customer:create')
  @LogOperation('lead', 'transitionCustomer')
  @ApiOperation({ summary: '新建客户并关联线索' })
  transitionCustomer(@CurrentUser() user: AuthUser, @Body() dto: ClueTransitionCustomerDto) {
    return this.service.transitionCustomer(user, dto)
  }

  @Post('batch/transfer')
  @RequirePermissions('lead:transfer')
  @LogOperation('lead', 'batchTransfer')
  @ApiOperation({ summary: '批量转移线索' })
  batchTransfer(@CurrentUser() user: AuthUser, @Body() dto: ClueBatchTransferDto) {
    return this.service.batchTransfer(user, dto.ids, dto.owner)
  }

  @Post('batch/update')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'batchUpdate')
  @ApiOperation({ summary: '批量更新线索' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.service.batchUpdate(user, dto)
  }

  @Post('batch/delete')
  @RequirePermissions('lead:delete')
  @LogOperation('lead', 'batchDelete')
  @ApiOperation({ summary: '批量删除线索' })
  batchDelete(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestException('请选择线索')
    return this.service.batchDelete(user, ids)
  }

  @Post('batch/to-pool')
  @RequirePermissions('lead:recycle')
  @LogOperation('lead', 'batchToPool')
  @ApiOperation({ summary: '批量移入线索池' })
  batchToPool(@CurrentUser() user: AuthUser, @Body() dto: ClueBatchToPoolDto) {
    return this.service.batchMoveToPool(user, dto.ids, dto.poolId, dto.reasonId)
  }

  @Post('to-pool')
  @RequirePermissions('lead:recycle')
  @LogOperation('lead', 'toPool')
  @ApiOperation({ summary: '移入线索池' })
  toPool(@CurrentUser() user: AuthUser, @Body() dto: ClueToPoolDto) {
    return this.service.moveToPool(user, dto.id, dto.poolId, dto.reasonId)
  }

  @Get('tab')
  @RequirePermissions('menu:lead')
  @ApiOperation({ summary: '所有线索和部门线索 tab 是否显示' })
  tab(@CurrentUser() user: AuthUser) {
    return this.service.getTabEnable(user)
  }

  @Post('export')
  @RequirePermissions('lead:export')
  @LogOperation('lead', 'exportAll')
  @ApiOperation({ summary: '导出全部线索' })
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: ClueExportDto) {
    return this.service.exportXlsx(
      user,
      {
        page: dto.current,
        pageSize: dto.pageSize,
        keyword: dto.keyword,
        filters: dto.filters,
        viewId: dto.viewId,
        homeFilter: dto.homeFilter,
        sort: dto.sort,
        scope: 'mine',
      },
      { fileName: dto.fileName, headList: dto.headList },
    )
  }

  @Post('export-select')
  @RequirePermissions('lead:export')
  @LogOperation('lead', 'exportSelected')
  @ApiOperation({ summary: '导出选中线索' })
  exportSelected(@CurrentUser() user: AuthUser, @Body() dto: ClueExportSelectDto) {
    return this.service.exportXlsx(
      user,
      { scope: 'mine' },
      { fileName: dto.fileName, headList: dto.headList, ids: dto.ids },
    )
  }

  @Post('transition/account/page')
  @RequirePermissions('menu:lead', 'customer:read')
  @ApiOperation({ summary: '可关联客户分页列表' })
  transitionCustomerPage(
    @CurrentUser() user: AuthUser,
    @Body() dto: ClueTransitionCustomerPageDto,
  ) {
    return this.service.transitionCustomerList(user, dto)
  }

  @Post('re-transition/account')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'retransitionCustomer')
  @ApiOperation({ summary: '批量关联已有客户' })
  retransitionCustomer(
    @CurrentUser() user: AuthUser,
    @Body() dto: ClueRetransitionCustomerDto,
  ) {
    return this.service.retransitionCustomer(user, dto)
  }

  @Post('transform')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'transform')
  @ApiOperation({ summary: '转换线索' })
  transform(@CurrentUser() user: AuthUser, @Body() dto: TransformClueDto) {
    return this.service.transform(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('lead:import')
  @ApiOperation({ summary: '下载线索导入模板' })
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
  @RequirePermissions('lead:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '线索导入预校验' })
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.precheckImportXlsx(user, file.buffer, importType)
  }

  @Post('import')
  @RequirePermissions('lead:import')
  @LogOperation('lead', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入线索' })
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.importXlsx(user, file.buffer, importType)
  }

  @Post('chart')
  @RequirePermissions('menu:lead')
  @ApiOperation({ summary: '线索图表生成' })
  chart(@CurrentUser() user: AuthUser, @Body() dto: ClueChartDto) {
    return this.service.chart(user, dto)
  }
}
