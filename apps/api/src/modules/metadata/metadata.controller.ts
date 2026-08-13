import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { CreateFieldDto, ReorderFieldsDto, UpdateFieldDto } from './dto/field.dto'
import { MetadataService } from './metadata.service'

@ApiTags('模块设置（元数据）')
@ApiBearerAuth()
@Controller('metadata')
export class MetadataController {
  constructor(private readonly metadataService: MetadataService) {}

  @Get(':module/fields')
  @ApiOperation({ summary: '模块字段定义（驱动动态表单/列表）' })
  listFields(@CurrentUser() user: AuthUser, @Param('module') module: string) {
    return this.metadataService.listFields(user.tenantId, module)
  }

  @Post(':module/fields')
  @RequirePermissions('system:module')
  @LogOperation('metadata', 'createField')
  @ApiOperation({ summary: '新增自定义字段' })
  createField(
    @CurrentUser() user: AuthUser,
    @Param('module') module: string,
    @Body() dto: CreateFieldDto,
  ) {
    return this.metadataService.createField(user.tenantId, module, dto)
  }

  @Patch('fields/:id')
  @RequirePermissions('system:module')
  @LogOperation('metadata', 'updateField')
  @ApiOperation({ summary: '更新字段' })
  updateField(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFieldDto) {
    return this.metadataService.updateField(user.tenantId, id, dto)
  }

  @Delete('fields/:id')
  @RequirePermissions('system:module')
  @LogOperation('metadata', 'deleteField')
  @ApiOperation({ summary: '删除自定义字段' })
  deleteField(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.metadataService.deleteField(user.tenantId, id)
  }

  @Post(':module/fields/reorder')
  @RequirePermissions('system:module')
  @LogOperation('metadata', 'reorderFields')
  @ApiOperation({ summary: '字段排序' })
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('module') module: string,
    @Body() dto: ReorderFieldsDto,
  ) {
    return this.metadataService.reorder(user.tenantId, module, dto.orderedIds)
  }
}
