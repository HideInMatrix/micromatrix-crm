import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { ContactsService } from './contacts.service'
import {
  ContactAddDto,
  ContactChartDto,
  ContactExportDto,
  ContactExportSelectDto,
  ContactPageDto,
  ContactUpdateDto,
  DisableContactDto,
} from './dto/contact.dto'

type UploadedBufferFile = { buffer: Buffer }

@ApiTags('客户联系人')
@ApiBearerAuth()
@Controller('account/contact')
export class AccountContactController {
  constructor(private readonly service: ContactsService) {}

  @Get('module/form')
  @RequireAnyPermissions('customer:read', 'contact:read', 'menu:opportunity')
  @ApiOperation({ summary: '获取联系人表单配置' })
  moduleForm(@CurrentUser() user: AuthUser) {
    return this.service.getModuleForm(user)
  }

  @Post('page')
  @RequirePermissions('contact:read')
  @ApiOperation({ summary: '联系人列表' })
  page(@CurrentUser() user: AuthUser, @Body() dto: ContactPageDto) {
    return this.service.page(user, dto)
  }

  @Post('chart')
  @RequirePermissions('contact:read')
  @ApiOperation({ summary: '联系人图表生成' })
  chart(@CurrentUser() user: AuthUser, @Body() dto: ContactChartDto) {
    return this.service.chart(user, dto)
  }

  @Get('list/:customerId')
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: '客户下的联系人列表' })
  async list(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return { list: await this.service.listByCustomer(user, customerId), optionMap: {} }
  }

  @Get('get/:id')
  @RequireAnyPermissions('customer:read', 'contact:read')
  @ApiOperation({ summary: '客户联系人详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user, id)
  }

  @Post('add')
  @RequireAnyPermissions('customer:create', 'contact:create')
  @LogOperation('contact', 'create')
  @ApiOperation({ summary: '添加客户联系人' })
  add(@CurrentUser() user: AuthUser, @Body() dto: ContactAddDto) {
    return this.service.addAccountContact(user, dto)
  }

  @Post('update')
  @RequireAnyPermissions('customer:update', 'contact:update')
  @LogOperation('contact', 'update')
  @ApiOperation({ summary: '更新客户联系人' })
  update(@CurrentUser() user: AuthUser, @Body() dto: ContactUpdateDto) {
    return this.service.updateAccountContact(user, dto)
  }

  @Get('enable/:id')
  @RequireAnyPermissions('customer:update', 'contact:update')
  @LogOperation('contact', 'enable')
  enable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.enable(user, id)
  }

  @Post('disable/:id')
  @RequireAnyPermissions('customer:update', 'contact:update')
  @LogOperation('contact', 'disable')
  disable(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DisableContactDto,
  ) {
    return this.service.disable(user, id, dto.reason)
  }

  @Get('delete/:id')
  @RequireAnyPermissions('customer:delete', 'contact:delete')
  @LogOperation('contact', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Get('opportunity/check/:id')
  @RequireAnyPermissions('customer:delete', 'contact:delete')
  async checkOpportunity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return (await this.service.checkOpportunity(user, id)).linked
  }

  @Get('tab')
  @RequirePermissions('contact:read')
  tab(@CurrentUser() user: AuthUser) {
    return this.service.tab(user)
  }

  @Post('export-all')
  @RequirePermissions('contact:export')
  @LogOperation('contact', 'exportAll')
  exportAll(@CurrentUser() user: AuthUser, @Body() dto: ContactExportDto) {
    return this.service.exportXlsx(
      user,
      {
        page: dto.current,
        pageSize: dto.pageSize,
        keyword: dto.keyword,
        viewId: dto.viewId,
        scopeView: dto.scopeView,
        filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
      },
      { fileName: dto.fileName, headList: dto.headList },
    )
  }

  @Post('export-select')
  @RequirePermissions('contact:export')
  @LogOperation('contact', 'exportSelected')
  exportSelect(@CurrentUser() user: AuthUser, @Body() dto: ContactExportSelectDto) {
    return this.service.exportXlsx(
      user,
      {},
      { fileName: dto.fileName, headList: dto.headList, ids: dto.ids },
    )
  }

  @Get('template/download')
  @RequirePermissions('contact:import')
  async template(@CurrentUser() user: AuthUser) {
    const result = await this.service.importTemplate(user)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('import/pre-check')
  @RequirePermissions('contact:import')
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
  @RequirePermissions('contact:import')
  @LogOperation('contact', 'import')
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

  @Post('batch/update')
  @RequirePermissions('contact:update')
  @LogOperation('contact', 'batchUpdate')
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.service.batchUpdate(user, dto)
  }
}
