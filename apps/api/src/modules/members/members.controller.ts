import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { CreateMemberDto, QueryMembersDto, ResetPasswordDto, UpdateMemberDto } from './dto/member.dto'
import { MembersService } from './members.service'

@ApiTags('成员管理')
@ApiBearerAuth()
@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @RequirePermissions('system:member')
  @ApiOperation({ summary: '成员分页列表' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryMembersDto) {
    return this.membersService.findAll(user.tenantId, query)
  }

  @Get('options')
  @ApiOperation({ summary: '成员下拉选项（供负责人/审批人选择）' })
  options(@CurrentUser() user: AuthUser) {
    return this.membersService.options(user.tenantId)
  }

  @Post()
  @RequirePermissions('system:member:create')
  @LogOperation('member', 'create')
  @ApiOperation({ summary: '新建成员' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMemberDto) {
    return this.membersService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('system:member:update')
  @LogOperation('member', 'update')
  @ApiOperation({ summary: '更新成员' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.membersService.update(user, id, dto)
  }

  @Post(':id/reset-password')
  @RequirePermissions('system:member:resetPassword')
  @LogOperation('member', 'resetPassword')
  @ApiOperation({ summary: '重置密码' })
  resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.membersService.resetPassword(user.tenantId, id, dto.password)
  }

  @Post(':id/toggle-status')
  @RequirePermissions('system:member:status')
  @LogOperation('member', 'toggleStatus')
  @ApiOperation({ summary: '启用/禁用成员' })
  toggleStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.membersService.toggleStatus(user.tenantId, user.id, id)
  }

  @Delete(':id')
  @RequirePermissions('system:member:delete')
  @LogOperation('member', 'delete')
  @ApiOperation({ summary: '删除无业务引用的成员' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.membersService.remove(user.tenantId, user.id, id)
  }
}
