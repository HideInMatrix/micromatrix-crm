import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
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
import { BatchIdsDto, ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import {
  ExportCreateDto,
  ExportSelectDto,
  type ImportType,
} from '../import-export/dto/import-export.dto'
import { CreateFieldDto, ReorderFieldsDto, UpdateFieldDto } from '../metadata/dto/field.dto'
import {
  CreateUserViewDto,
  EditUserViewPosDto,
  UpdateUserViewDto,
} from '../user-views/dto/user-view.dto'
import { CustomFormsService } from './custom-forms.service'
import {
  CustomFormDataPageDto,
  CustomFormUsersDto,
  SaveCustomFormDataDto,
  SaveCustomFormDto,
  UpdateCustomFormRoleUsersDto,
  UpdateCustomFormStatusDto,
} from './dto/custom-form.dto'

type UploadedBufferFile = {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

@ApiTags('自定义表单')
@ApiBearerAuth()
@Controller('custom-form')
export class CustomFormsController {
  constructor(private readonly forms: CustomFormsService) {}

  @Get('list')
  @RequirePermissions('CUSTOM_FORM:READ')
  list(@CurrentUser() user: AuthUser) {
    return this.forms.list(user)
  }

  @Get('options')
  @RequirePermissions('CUSTOM_FORM:READ')
  options(@CurrentUser() user: AuthUser) {
    return this.forms.options(user)
  }

  @Post()
  @RequirePermissions('CUSTOM_FORM:ADD')
  @LogOperation('custom-form', 'create')
  @ApiOperation({ summary: '创建自定义表单' })
  create(@CurrentUser() user: AuthUser, @Body() input: SaveCustomFormDto) {
    return this.forms.create(user, input)
  }

  @Get(':id')
  @RequirePermissions('CUSTOM_FORM:READ')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.forms.detail(user, id)
  }

  @Put(':id')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form', 'update')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: SaveCustomFormDto) {
    return this.forms.update(user, id, input)
  }

  @Patch(':id/status')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form', 'update-status')
  status(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateCustomFormStatusDto,
  ) {
    return this.forms.setStatus(user, id, input.enable)
  }

  @Delete(':id')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.forms.remove(user, id)
  }

  @Get(':id/admins')
  @RequirePermissions('CUSTOM_FORM:READ')
  admins(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.forms.admins(user, id)
  }

  @Put(':id/admins')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form', 'set-admins')
  setAdmins(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: CustomFormUsersDto,
  ) {
    return this.forms.setAdmins(user, id, input.userIds)
  }

  @Get(':id/roles')
  @RequirePermissions('CUSTOM_FORM:READ')
  roles(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.forms.roles(user, id)
  }

  @Put(':id/roles/users')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form', 'set-role-users')
  setRoleUsers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateCustomFormRoleUsersDto,
  ) {
    return this.forms.setRoleUsers(user, id, input.roleKey, input.userIds)
  }

  @Get(':id/form-config')
  @RequirePermissions('CUSTOM_FORM:READ')
  formConfig(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.forms.formConfig(user, id)
  }

  @Post(':id/fields')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form', 'create-field')
  createField(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: CreateFieldDto,
  ) {
    return this.forms.createField(user, id, input)
  }

  @Put(':id/fields/reorder')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form', 'reorder-fields')
  reorderFields(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ReorderFieldsDto,
  ) {
    return this.forms.reorderFields(user, id, input)
  }

  @Put(':id/fields/:fieldId')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form', 'update-field')
  updateField(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
    @Body() input: UpdateFieldDto,
  ) {
    return this.forms.updateField(user, id, fieldId, input)
  }

  @Delete(':id/fields/:fieldId')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form', 'delete-field')
  deleteField(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
  ) {
    return this.forms.deleteField(user, id, fieldId)
  }
}

@ApiTags('自定义表单数据')
@ApiBearerAuth()
@Controller('custom-form/:id/data')
export class CustomFormDataController {
  constructor(private readonly forms: CustomFormsService) {}

  @Get()
  @RequirePermissions('CUSTOM_FORM:READ')
  page(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() input: CustomFormDataPageDto,
  ) {
    return this.forms.dataPage(user, id, input)
  }

  @Post('page')
  @HttpCode(200)
  @RequirePermissions('CUSTOM_FORM:READ')
  dataPage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: CustomFormDataPageDto,
  ) {
    return this.forms.dataPage(user, id, input)
  }

  @Post('source-options')
  @HttpCode(200)
  @RequirePermissions('CUSTOM_FORM:READ')
  @ApiOperation({ summary: '自定义表单作为数据源时的候选分页' })
  sourceOptions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: CustomFormDataPageDto,
  ) {
    return this.forms.dataSourcePage(user, id, input)
  }

  @Post('source-resolve')
  @HttpCode(200)
  @RequirePermissions('CUSTOM_FORM:READ')
  @ApiOperation({ summary: '解析已选自定义表单数据源记录' })
  sourceResolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: BatchIdsDto,
  ) {
    return this.forms.dataSourceResolve(user, id, input.ids)
  }

  @Post('export-all')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-data', 'export-all')
  exportAll(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ExportCreateDto,
  ) {
    return this.forms.exportAll(user, id, input)
  }

  @Post('export-select')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-data', 'export-select')
  exportSelected(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ExportSelectDto,
  ) {
    return this.forms.exportSelected(user, id, input)
  }

  @Get('template/download')
  @RequirePermissions('CUSTOM_FORM:READ')
  async template(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('importType') importType: ImportType = 'ADD',
  ) {
    const result = await this.forms.importTemplate(user, id, importType)
    return new StreamableFile(result.data, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    })
  }

  @Post('import/pre-check')
  @RequirePermissions('CUSTOM_FORM:READ')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  precheckImport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.forms.precheckImportXlsx(user, id, file.buffer, importType)
  }

  @Post('import')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-data', 'import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  importXlsx(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: UploadedBufferFile | undefined,
    @Body('importType') importType: ImportType = 'ADD',
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择 xlsx 文件')
    return this.forms.importXlsx(user, id, file.buffer, importType)
  }

  @Post('batch/update')
  @HttpCode(200)
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-data', 'batch-update')
  batchUpdate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ResourceBatchEditDto,
  ) {
    return this.forms.batchUpdateData(user, id, input)
  }

  @Post('batch/delete')
  @HttpCode(200)
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-data', 'batch-delete')
  batchDelete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: BatchIdsDto) {
    return this.forms.batchDeleteData(user, id, input)
  }

  @Get('view/list')
  @RequirePermissions('CUSTOM_FORM:READ')
  viewList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.forms.viewList(user, id)
  }

  @Get('view/detail/:viewId')
  @RequirePermissions('CUSTOM_FORM:READ')
  viewDetail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('viewId') viewId: string,
  ) {
    return this.forms.viewDetail(user, id, viewId)
  }

  @Post('view/add')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-view', 'create')
  createView(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: CreateUserViewDto,
  ) {
    return this.forms.createView(user, id, input)
  }

  @Post('view/update')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-view', 'update')
  updateView(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateUserViewDto,
  ) {
    return this.forms.updateView(user, id, input)
  }

  @Get('view/delete/:viewId')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-view', 'delete')
  removeView(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('viewId') viewId: string,
  ) {
    return this.forms.removeView(user, id, viewId)
  }

  @Get('view/fixed/:viewId')
  @RequirePermissions('CUSTOM_FORM:READ')
  toggleViewFixed(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('viewId') viewId: string,
  ) {
    return this.forms.toggleViewFixed(user, id, viewId)
  }

  @Get('view/enable/:viewId')
  @RequirePermissions('CUSTOM_FORM:READ')
  toggleViewEnabled(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('viewId') viewId: string,
  ) {
    return this.forms.toggleViewEnabled(user, id, viewId)
  }

  @Post('view/edit/pos')
  @RequirePermissions('CUSTOM_FORM:READ')
  editViewPos(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: EditUserViewPosDto,
  ) {
    return this.forms.editViewPos(user, id, input)
  }

  @Get(':dataId')
  @RequirePermissions('CUSTOM_FORM:READ')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('dataId') dataId: string) {
    return this.forms.dataDetail(user, id, dataId)
  }

  @Get(':dataId/attachments/:attachmentId')
  @RequirePermissions('CUSTOM_FORM:READ')
  dataAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('dataId') dataId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.forms.viewDataAttachment(user, id, dataId, attachmentId)
  }

  @Post()
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-data', 'create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: SaveCustomFormDataDto,
  ) {
    return this.forms.createData(user, id, input)
  }

  @Put(':dataId')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-data', 'update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('dataId') dataId: string,
    @Body() input: SaveCustomFormDataDto,
  ) {
    return this.forms.updateData(user, id, dataId, input)
  }

  @Delete(':dataId')
  @RequirePermissions('CUSTOM_FORM:READ')
  @LogOperation('custom-form-data', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('dataId') dataId: string) {
    return this.forms.deleteData(user, id, dataId)
  }
}
