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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator'
import { ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import {
  ExportCreateDto,
  ExportSelectDto,
  ImportUploadDto,
} from '../import-export/dto/import-export.dto'
import { ContactsService } from './contacts.service'
import {
  CreateContactDto,
  DisableContactDto,
  QueryContactsDto,
  UpdateContactRequestDto,
} from './dto/contact.dto'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('客户联系人')
@ApiBearerAuth()
@RequirePermissions('menu:customer')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post('page')
  @RequirePermissions('contact:read')
  @ApiOperation({ summary: '联系人独立分页列表' })
  page(@CurrentUser() user: AuthUser, @Body() query: QueryContactsDto) {
    return this.contactsService.findAll(user, query)
  }

  @Get('list/:customerId')
  @ApiOperation({ summary: '客户下联系人列表' })
  listByCustomer(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.contactsService.listByCustomer(user, customerId)
  }

  @Get('get/:id')
  @ApiOperation({ summary: '联系人详情' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contactsService.findOne(user, id)
  }

  @Post('add')
  @RequireAnyPermissions('customer:create', 'contact:create')
  @LogOperation('contact', 'create')
  @ApiOperation({ summary: '新增联系人' })
  add(@CurrentUser() user: AuthUser, @Body() dto: CreateContactDto) {
    return this.contactsService.create(user, dto)
  }

  @Post('update')
  @RequireAnyPermissions('customer:update', 'contact:update')
  @LogOperation('contact', 'update')
  @ApiOperation({ summary: '更新联系人' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateContactRequestDto) {
    const { id, ...data } = dto
    return this.contactsService.update(user, id, data)
  }

  @Get('enable/:id')
  @RequireAnyPermissions('customer:update', 'contact:update')
  @LogOperation('contact', 'enable')
  @ApiOperation({ summary: '启用联系人' })
  enable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contactsService.enable(user, id)
  }

  @Post('disable/:id')
  @RequireAnyPermissions('customer:update', 'contact:update')
  @LogOperation('contact', 'disable')
  @ApiOperation({ summary: '停用联系人' })
  disable(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DisableContactDto,
  ) {
    return this.contactsService.disable(user, id, dto.reason)
  }

  @Get('delete/:id')
  @RequireAnyPermissions('customer:delete', 'contact:delete')
  @LogOperation('contact', 'delete')
  @ApiOperation({ summary: '删除联系人；有关联商机时拒绝' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contactsService.remove(user, id)
  }

  @Get('opportunity/check/:id')
  @RequireAnyPermissions('customer:delete', 'contact:delete')
  @ApiOperation({ summary: '检查联系人是否关联商机' })
  checkOpportunity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contactsService.checkOpportunity(user, id)
  }

  @Get('tab')
  @RequirePermissions('contact:read')
  @ApiOperation({ summary: '联系人所有/部门数据 Tab 显示配置' })
  tab(@CurrentUser() user: AuthUser) {
    return this.contactsService.tab(user)
  }

  @Post('export-all')
  @RequirePermissions('contact:export')
  @LogOperation('contact', 'exportAll')
  @ApiOperation({ summary: '联系人导出全部' })
  exportAll(
    @CurrentUser() user: AuthUser,
    @Body() body: QueryContactsDto & ExportCreateDto,
  ) {
    const { fileName, headList, ...query } = body
    return this.contactsService.exportXlsx(user, query, { fileName, headList })
  }

  @Post('export-select')
  @RequirePermissions('contact:export')
  @LogOperation('contact', 'exportSelected')
  @ApiOperation({ summary: '导出选中联系人' })
  exportSelected(
    @CurrentUser() user: AuthUser,
    @Body() body: QueryContactsDto & ExportSelectDto,
  ) {
    const { fileName, headList, ids, ...query } = body
    return this.contactsService.exportXlsx(user, query, { fileName, headList, ids })
  }

  @Get('template/download')
  @RequirePermissions('contact:import')
  @ApiOperation({ summary: '下载联系人导入模板' })
  async downloadTemplate(@CurrentUser() user: AuthUser) {
    const result = await this.contactsService.importTemplate(user)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('import/pre-check')
  @RequirePermissions('contact:import')
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
  @ApiOperation({ summary: '联系人导入预校验' })
  precheckImport(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body() dto: ImportUploadDto,
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.contactsService.precheckImportXlsx(user, file.buffer, dto.importType)
  }

  @Post('import')
  @RequirePermissions('contact:import')
  @LogOperation('contact', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '联系人正式导入' })
  importXlsx(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body() dto: ImportUploadDto,
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.contactsService.importXlsx(user, file.buffer, dto.importType)
  }

  @Post('batch/update')
  @RequirePermissions('contact:update')
  @LogOperation('contact', 'batchUpdate')
  @ApiOperation({ summary: '批量更新联系人' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.contactsService.batchUpdate(user, dto)
  }
}
