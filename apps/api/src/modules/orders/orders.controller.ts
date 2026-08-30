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
import type { ImportType } from '../import-export/dto/import-export.dto'
import {
  OrderAddDto,
  OrderBatchUpdateDto,
  OrderExportDto,
  OrderExportSelectDto,
  OrderPageDto,
  OrderSortDto,
  OrderStageDto,
  OrderUpdateDto,
} from './dto/order.dto'
import { OrdersService } from './orders.service'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('订单')
@ApiBearerAuth()
@RequirePermissions('ORDER:READ')
@Controller('order')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get('module/form')
  @ApiOperation({ summary: '获取订单表单配置' })
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.form(user)
  }

  @Post('page')
  @ApiOperation({ summary: '订单列表 / 阶段看板分页' })
  page(@CurrentUser() user: AuthUser, @Body() dto: OrderPageDto) {
    return this.service.page(user, dto)
  }

  @Post('add')
  @RequirePermissions('ORDER:ADD')
  @LogOperation('order', 'create')
  @ApiOperation({ summary: '新增订单' })
  add(@CurrentUser() user: AuthUser, @Body() dto: OrderAddDto) {
    return this.service.add(user, dto)
  }

  @Post('update')
  @RequirePermissions('ORDER:UPDATE')
  @LogOperation('order', 'update')
  @ApiOperation({ summary: '更新订单' })
  update(@CurrentUser() user: AuthUser, @Body() dto: OrderUpdateDto) {
    return this.service.update(user, dto)
  }

  @Post('update/stage')
  @RequirePermissions('ORDER:UPDATE')
  @LogOperation('order', 'stage')
  @ApiOperation({ summary: '更新订单阶段' })
  updateStage(@CurrentUser() user: AuthUser, @Body() dto: OrderStageDto) {
    return this.service.updateStage(user, dto)
  }

  @Post('batch/update')
  @RequirePermissions('ORDER:UPDATE')
  @LogOperation('order', 'batchUpdate')
  @ApiOperation({ summary: '批量更新订单' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: OrderBatchUpdateDto) {
    return this.service.batchUpdate(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('ORDER:DELETE')
  @LogOperation('order', 'delete')
  @ApiOperation({ summary: '删除订单' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Get('get/snapshot/:id')
  @ApiOperation({ summary: '获取订单详情快照' })
  snapshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getSnapshot(user, id)
  }

  @Get('get/:id')
  @ApiOperation({ summary: '订单详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user, id)
  }

  @Get('module/form/snapshot/:id')
  @ApiOperation({ summary: '获取订单表单快照配置' })
  snapshotForm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getSnapshotForm(user, id)
  }

  @Get('tab')
  @ApiOperation({ summary: '订单全部 / 部门 Tab 显隐' })
  tab(@CurrentUser() user: AuthUser) {
    return this.service.tab(user)
  }

  @Get('download/:id')
  @RequirePermissions('ORDER:DOWNLOAD')
  @LogOperation('order', 'download')
  @ApiOperation({ summary: '下载订单日志记录' })
  download(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.download(user, id)
  }

  @Post('statistic')
  @ApiOperation({ summary: '订单统计' })
  statistic(@CurrentUser() user: AuthUser, @Body() dto: OrderPageDto) {
    return this.service.statistic(user, dto)
  }

  @Post('sort')
  @RequirePermissions('ORDER:UPDATE')
  @LogOperation('order', 'sort')
  @ApiOperation({ summary: '订单看板拖拽排序' })
  sort(@CurrentUser() user: AuthUser, @Body() dto: OrderSortDto) {
    return this.service.sort(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('ORDER:IMPORT')
  @ApiOperation({ summary: '下载订单导入模板' })
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
  @RequirePermissions('ORDER:IMPORT')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '订单导入检查' })
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.precheckImportXlsx(user, file.buffer, importType)
  }

  @Post('import')
  @RequirePermissions('ORDER:IMPORT')
  @LogOperation('order', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入订单' })
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.importXlsx(user, file.buffer, importType)
  }

  @Post('export-all')
  @RequirePermissions('ORDER:EXPORT')
  @LogOperation('order', 'exportAll')
  @ApiOperation({ summary: '导出全部订单' })
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: OrderExportDto) {
    return this.service.exportAll(user, dto)
  }

  @Post('export-select')
  @RequirePermissions('ORDER:EXPORT')
  @LogOperation('order', 'exportSelected')
  @ApiOperation({ summary: '导出选中订单' })
  exportSelected(@CurrentUser() user: AuthUser, @Body() dto: OrderExportSelectDto) {
    return this.service.exportSelected(user, dto)
  }
}
