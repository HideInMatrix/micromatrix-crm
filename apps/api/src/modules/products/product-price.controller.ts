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
  ProductPriceAddDto,
  ProductPriceExportDto,
  ProductPriceExportSelectDto,
  ProductPricePageDto,
  ProductPriceSortDto,
  ProductPriceUpdateDto,
} from './dto/product-price.dto'
import { ProductPriceService } from './product-price.service'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('价格表')
@ApiBearerAuth()
@Controller('price')
export class ProductPriceController {
  constructor(private readonly service: ProductPriceService) {}

  @Get('module/form')
  @ApiOperation({ summary: '获取价格表表单配置' })
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.getModuleForm(user)
  }

  @Post('page')
  @RequirePermissions('price:read')
  @ApiOperation({ summary: '价格表列表' })
  page(@CurrentUser() user: AuthUser, @Body() dto: ProductPricePageDto) {
    return this.service.page(user, dto)
  }

  @Post('add')
  @RequirePermissions('price:add')
  @LogOperation('price', 'create')
  @ApiOperation({ summary: '添加价格表' })
  add(@CurrentUser() user: AuthUser, @Body() dto: ProductPriceAddDto) {
    return this.service.add(user, dto)
  }

  @Get('copy/:id')
  @RequirePermissions('price:add')
  @LogOperation('price', 'copy')
  @ApiOperation({ summary: '复制价格表' })
  copy(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.copy(user, id)
  }

  @Post('update')
  @RequirePermissions('price:update')
  @LogOperation('price', 'update')
  @ApiOperation({ summary: '修改价格表' })
  update(@CurrentUser() user: AuthUser, @Body() dto: ProductPriceUpdateDto) {
    return this.service.update(user, dto)
  }

  @Get('get/:id')
  @RequirePermissions('price:read')
  @ApiOperation({ summary: '价格表详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @Get('delete/:id')
  @RequirePermissions('price:delete')
  @LogOperation('price', 'delete')
  @ApiOperation({ summary: '删除价格表' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.delete(user, id)
  }

  @Post('batch/update')
  @RequirePermissions('price:update')
  @LogOperation('price', 'batchUpdate')
  @ApiOperation({ summary: '批量更新价格表' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.service.batchUpdate(user, dto)
  }

  @Post('edit/pos')
  @RequirePermissions('price:update')
  @LogOperation('price', 'sort')
  @ApiOperation({ summary: '拖拽排序价格表' })
  editPos(@CurrentUser() user: AuthUser, @Body() dto: ProductPriceSortDto) {
    return this.service.editPos(user, dto)
  }

  @Get('template/download')
  @RequirePermissions('price:import')
  @ApiOperation({ summary: '下载价格表导入模板' })
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
  @RequirePermissions('price:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '价格表导入预校验' })
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.precheckImportXlsx(user, file.buffer, importType)
  }

  @Post('import')
  @RequirePermissions('price:import')
  @LogOperation('price', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入价格表' })
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.service.importXlsx(user, file.buffer, importType)
  }

  @Post('export')
  @RequirePermissions('price:export')
  @LogOperation('price', 'exportAll')
  @ApiOperation({ summary: '价格表导出全部' })
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: ProductPriceExportDto) {
    return this.service.exportAll(user, dto)
  }

  @Post('export-select')
  @RequirePermissions('price:export')
  @LogOperation('price', 'exportSelected')
  @ApiOperation({ summary: '导出选中价格表' })
  exportSelected(@CurrentUser() user: AuthUser, @Body() dto: ProductPriceExportSelectDto) {
    return this.service.exportSelected(user, dto)
  }
}
