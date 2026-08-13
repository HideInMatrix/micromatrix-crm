import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { DepartmentsService } from './departments.service'
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto'

@ApiTags('组织架构')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get('tree')
  @ApiOperation({ summary: '部门树（动态表单的部门字段也依赖，登录即可读）' })
  tree(@CurrentUser() user: AuthUser) {
    return this.departmentsService.tree(user.tenantId)
  }

  @Post()
  @RequirePermissions('system:dept')
  @LogOperation('department', 'create')
  @ApiOperation({ summary: '新建部门' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDepartmentDto) {
    return this.departmentsService.create(user.tenantId, dto)
  }

  @Patch(':id')
  @RequirePermissions('system:dept')
  @LogOperation('department', 'update')
  @ApiOperation({ summary: '更新部门' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departmentsService.update(user.tenantId, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('system:dept')
  @LogOperation('department', 'delete')
  @ApiOperation({ summary: '删除部门' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.departmentsService.remove(user.tenantId, id)
  }
}
