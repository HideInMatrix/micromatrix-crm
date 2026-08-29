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
  ProductAddDto,
  ProductExportDto,
  ProductExportSelectDto,
  ProductPageDto,
  ProductSortDto,
  ProductUpdateDto,
} from './dto/product.dto'
import { ProductsService } from './products.service'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('产品')
@ApiBearerAuth()
@Controller('product')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get('module/form')
  @ApiOperation({ summary: '获取产品表单配置' })
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.getModuleForm(user)
  }

  @Post('page')
  @RequirePermissions('menu:product')
  @ApiOperation({ summary: '产品列表' })
  page(@CurrentUser() user: AuthUser, @Body() dto: ProductPageDto) {
    return this.service.page(user, dto)
  }

  @Get('get/:id')
  @RequirePermissions('menu:product')
  @ApiOperation({ summary: '产品详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @Post('add')
  @RequirePermissions('product:create')
  @LogOperation('product', 'create')
  @ApiOperation({ summary: '添加产品' })
  add(@CurrentUser() user: AuthUser, @Body() dto: ProductAddDto) {
    return this.service.add(user, dto)
  }

  @Post('update')
  @RequirePermissions('product:update')
  @LogOperation('product', 'update')
  @ApiOperation({ summary: '更新产品' })
  update(@CurrentUser() user: AuthUser, @Body() dto: ProductUpdateDto) {
    return this.service.update(user, dto)
  }

  @Post('batch/update')
  @RequirePermissions('product:update')
  @LogOperation('product', 'batchUpdate')
  @ApiOperation({ summary: '批量更新产品' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.service.batchUpdate(user, dto)
  }

  @Get('delete/:id')
  @RequirePermissions('product:delete')
  @LogOperation('product', 'delete')
  @ApiOperation({ summary: '删除产品' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.delete(user, id)
  }

  @Post('batch/delete')
  @RequirePermissions('product:delete')
  @LogOperation('product', 'batchDelete')
  @ApiOperation({ summary: '批量删除产品' })
  batchDelete(@CurrentUser() user: AuthUser, @Body() ids: string[]) {
    return this.service.batchDelete(user, ids)
  }

  @Post('edit/pos')
  @RequirePermissions('product:update')
  @LogOperation('product', 'sort')
  @ApiOperation({ summary: '拖拽排序' })
  editPos(@CurrentUser() user: AuthUser, @Body() dto: ProductSortDto) {
    return this.service.editPos(user, dto)
  }

  @Get('list/option')
  @ApiOperation({ summary: '获取当前组织全部产品 option' })
  listOption(@CurrentUser() user: AuthUser) {
    return this.service.listOption(user)
  }

  @Post('export-all')
  @RequirePermissions('product:export')
  @LogOperation('product', 'exportAll')
  @ApiOperation({ summary: '产品导出全部' })
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: ProductExportDto) {
    return this.service.exportAll(user, dto)
  }

  @Post('export-select')
  @RequirePermissions('product:export')
  @LogOperation('product', 'exportSelected')
  @ApiOperation({ summary: '导出选中产品' })
  exportSelected(@CurrentUser() user: AuthUser, @Body() dto: ProductExportSelectDto) {
    return this.service.exportSelected(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('product:import')
  @ApiOperation({ summary: '下载产品导入模板' })
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
  @RequirePermissions('product:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '产品导入预校验' })
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.precheckImportXlsx(user, file.buffer, importType)
  }

  @Post('import')
  @RequirePermissions('product:import')
  @LogOperation('product', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入产品' })
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.importXlsx(user, file.buffer, importType)
  }
}
