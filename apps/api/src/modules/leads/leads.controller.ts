import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AssignLeadDto, ConvertLeadDto, CreateLeadDto, QueryLeadsDto, UpdateLeadDto } from './dto/lead.dto'
import { LeadsService } from './leads.service'

@ApiTags('线索')
@ApiBearerAuth()
@RequirePermissions('menu:lead')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @ApiOperation({ summary: '线索列表（scope=pool 为线索池）' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryLeadsDto) {
    return this.leadsService.findAll(user, query)
  }

  @Get('export')
  @RequirePermissions('lead:import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: '导出线索 CSV' })
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryLeadsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.leadsService.exportCsv(user, query)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    return csv
  }

  @Post('import')
  @RequirePermissions('lead:import')
  @LogOperation('lead', 'import')
  @ApiOperation({ summary: '批量导入线索' })
  bulkImport(@CurrentUser() user: AuthUser, @Body() body: { rows: Record<string, unknown>[] }) {
    return this.leadsService.bulkImport(user, body.rows ?? [])
  }

  @Post()
  @RequirePermissions('lead:create')
  @LogOperation('lead', 'create')
  @ApiOperation({ summary: '新建线索' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'update')
  @ApiOperation({ summary: '更新线索' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(user, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('lead:delete')
  @LogOperation('lead', 'delete')
  @ApiOperation({ summary: '删除线索' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.remove(user, id)
  }

  @Post(':id/to-pool')
  @RequirePermissions('lead:assign')
  @LogOperation('lead', 'toPool')
  @ApiOperation({ summary: '退回线索池' })
  moveToPool(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.moveToPool(user, id)
  }

  @Post(':id/claim')
  @LogOperation('lead', 'claim')
  @ApiOperation({ summary: '从线索池领取' })
  claim(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.claim(user, id)
  }

  @Post(':id/assign')
  @RequirePermissions('lead:assign')
  @LogOperation('lead', 'assign')
  @ApiOperation({ summary: '分配负责人' })
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignLeadDto) {
    return this.leadsService.assign(user, id, dto)
  }

  @Post(':id/invalid')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'invalid')
  @ApiOperation({ summary: '标记无效' })
  markInvalid(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.markInvalid(user, id)
  }

  @Post(':id/convert')
  @RequirePermissions('lead:convert')
  @LogOperation('lead', 'convert')
  @ApiOperation({ summary: '一键转化为客户（+联系人 +商机）' })
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConvertLeadDto) {
    return this.leadsService.convert(user, id, dto)
  }
}
