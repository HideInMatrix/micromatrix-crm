import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { LogOperation } from '../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CustomersService } from './customers.service'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { QueryCustomersDto } from './dto/query-customers.dto'
import { UpdateCustomerDto } from './dto/update-customer.dto'

@ApiTags('客户')
@ApiBearerAuth()
@RequirePermissions('menu:customer')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @ApiOperation({ summary: '分页查询客户列表（按数据范围过滤）' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryCustomersDto) {
    return this.customersService.findAll(user, query)
  }

  @Get('export')
  @RequirePermissions('customer:import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: '导出客户 CSV' })
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryCustomersDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.customersService.exportCsv(user, query)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    return csv
  }

  @Post('import')
  @RequirePermissions('customer:import')
  @LogOperation('customer', 'import')
  @ApiOperation({ summary: '批量导入客户（结构化行）' })
  bulkImport(@CurrentUser() user: AuthUser, @Body() body: { rows: Record<string, unknown>[] }) {
    return this.customersService.bulkImport(user, body.rows ?? [])
  }

  @Get(':id')
  @ApiOperation({ summary: '查询客户详情' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customersService.findOne(user, id)
  }

  @Post()
  @RequirePermissions('customer:create')
  @LogOperation('customer', 'create')
  @ApiOperation({ summary: '新建客户' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'update')
  @ApiOperation({ summary: '更新客户' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(user, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('customer:delete')
  @LogOperation('customer', 'delete')
  @ApiOperation({ summary: '删除客户' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customersService.remove(user, id)
  }

  @Post(':id/to-sea')
  @RequirePermissions('customer:assign')
  @LogOperation('customer', 'toSea')
  @ApiOperation({ summary: '退回公海' })
  moveToSea(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customersService.moveToSea(user, id)
  }

  @Post(':id/claim')
  @LogOperation('customer', 'claim')
  @ApiOperation({ summary: '从公海领取' })
  claim(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customersService.claimFromSea(user, id)
  }

  @Post(':id/assign')
  @RequirePermissions('customer:assign')
  @LogOperation('customer', 'assign')
  @ApiOperation({ summary: '分配负责人' })
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { ownerId: string },
  ) {
    return this.customersService.assignOwner(user, id, body.ownerId)
  }

  @Get(':id/team')
  @ApiOperation({ summary: '协作团队成员' })
  teamList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customersService.teamList(user, id)
  }

  @Post(':id/team')
  @RequirePermissions('customer:team')
  @LogOperation('customer', 'teamAdd')
  @ApiOperation({ summary: '添加团队成员' })
  teamAdd(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { userId: string; role?: string },
  ) {
    return this.customersService.teamAdd(user, id, body.userId, body.role)
  }

  @Delete(':id/team/:memberId')
  @RequirePermissions('customer:team')
  @LogOperation('customer', 'teamRemove')
  @ApiOperation({ summary: '移除团队成员' })
  teamRemove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.customersService.teamRemove(user, id, memberId)
  }
}
