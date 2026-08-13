import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto'
import { RolesService } from './roles.service'

@ApiTags('角色权限')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: '角色列表' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.rolesService.findAll(user.tenantId)
  }

  @Post()
  @RequirePermissions('system:role')
  @LogOperation('role', 'create')
  @ApiOperation({ summary: '新建角色' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.rolesService.create(user.tenantId, dto)
  }

  @Patch(':id')
  @RequirePermissions('system:role')
  @LogOperation('role', 'update')
  @ApiOperation({ summary: '更新角色' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(user.tenantId, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('system:role')
  @LogOperation('role', 'delete')
  @ApiOperation({ summary: '删除角色' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rolesService.remove(user.tenantId, id)
  }
}
