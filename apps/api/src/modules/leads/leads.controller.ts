import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  BatchAssignOwnerDto,
  BatchClaimDto,
  BatchMoveToPoolDto,
  BatchIdsDto,
  PoolBatchIdsDto,
  PoolResourceBatchEditDto,
  ResourceBatchEditDto,
} from '../../common/dto/resource-batch.dto'
import { MoveToResourcePoolDto } from '../pool-rules/dto/resource-pool.dto'
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

  @Post('batch/claim')
  @LogOperation('lead', 'batchClaim')
  @ApiOperation({ summary: '批量领取线索' })
  batchClaim(@CurrentUser() user: AuthUser, @Body() dto: BatchClaimDto) {
    return this.leadsService.batchClaim(user, dto.ids, dto.poolId)
  }

  @Post('batch/assign')
  @RequirePermissions('lead:assign')
  @LogOperation('lead', 'batchAssign')
  @ApiOperation({ summary: '批量分配线索负责人' })
  batchAssign(@CurrentUser() user: AuthUser, @Body() dto: BatchAssignOwnerDto) {
    return this.leadsService.batchAssign(user, dto.ids, dto.ownerId)
  }

  @Post('batch/to-pool')
  @RequirePermissions('lead:assign')
  @LogOperation('lead', 'batchToPool')
  @ApiOperation({ summary: '批量退回线索池' })
  batchMoveToPool(@CurrentUser() user: AuthUser, @Body() dto: BatchMoveToPoolDto) {
    return this.leadsService.batchMoveToPool(user, dto.ids, dto.poolId, dto.reasonId)
  }

  @Post('batch/update')
  @RequirePermissions('lead:update')
  @LogOperation('lead', 'batchUpdate')
  @ApiOperation({ summary: '批量修改线索单个字段' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.leadsService.batchUpdate(user, dto)
  }

  @Post('batch/delete')
  @RequirePermissions('lead:delete')
  @LogOperation('lead', 'batchDelete')
  @ApiOperation({ summary: '批量删除线索' })
  batchDelete(@CurrentUser() user: AuthUser, @Body() dto: BatchIdsDto) {
    return this.leadsService.batchDelete(user, dto.ids)
  }

  @Post('pool/batch/update')
  @RequirePermissions('leadPool:update')
  @LogOperation('leadPool', 'batchUpdate')
  @ApiOperation({ summary: '线索池批量修改字段（独立池权限）' })
  poolBatchUpdate(@CurrentUser() user: AuthUser, @Body() dto: PoolResourceBatchEditDto) {
    return this.leadsService.poolBatchUpdate(user, dto)
  }

  @Post('pool/batch/delete')
  @RequirePermissions('leadPool:delete')
  @LogOperation('leadPool', 'batchDelete')
  @ApiOperation({ summary: '线索池批量删除（独立池权限）' })
  poolBatchDelete(@CurrentUser() user: AuthUser, @Body() dto: PoolBatchIdsDto) {
    return this.leadsService.poolBatchDelete(user, dto.poolId, dto.ids)
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
  moveToPool(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveToResourcePoolDto,
  ) {
    return this.leadsService.moveToPool(user, id, dto?.poolId, dto?.reasonId)
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

  @Get(':id/owner-history')
  @ApiOperation({ summary: '线索负责人历史' })
  ownerHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leadsService.ownerHistory(user, id)
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
