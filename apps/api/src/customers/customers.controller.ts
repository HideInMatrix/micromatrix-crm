import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import type { AuthUser } from '../common/auth-user'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { LogOperation } from '../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import {
  BatchAssignOwnerDto,
  BatchClaimDto,
  BatchIdsDto,
  BatchMoveToPoolDto,
  PoolBatchIdsDto,
  PoolResourceBatchEditDto,
  ResourceBatchEditDto,
} from '../common/dto/resource-batch.dto'
import { MoveToResourcePoolDto } from '../modules/pool-rules/dto/resource-pool.dto'
import { CustomersService } from './customers.service'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { CustomerMergeDto } from './dto/customer-merge.dto'
import {
  ReplaceCustomerRelationsDto,
  SaveCustomerRelationDto,
} from './dto/customer-relation.dto'
import { CheckDuplicateQueryDto, QueryCustomersDto } from './dto/query-customers.dto'
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

  @Post('batch/claim')
  @LogOperation('customer', 'batchClaim')
  @ApiOperation({ summary: '批量领取公海客户' })
  batchClaim(@CurrentUser() user: AuthUser, @Body() dto: BatchClaimDto) {
    return this.customersService.batchClaimFromSea(user, dto.ids, dto.poolId)
  }

  @Post('batch/assign')
  @RequirePermissions('customer:assign')
  @LogOperation('customer', 'batchAssign')
  @ApiOperation({ summary: '批量分配客户负责人' })
  batchAssign(@CurrentUser() user: AuthUser, @Body() dto: BatchAssignOwnerDto) {
    return this.customersService.batchAssignOwner(user, dto.ids, dto.ownerId)
  }

  @Post('batch/to-sea')
  @RequirePermissions('customer:assign')
  @LogOperation('customer', 'batchToSea')
  @ApiOperation({ summary: '批量退回客户公海' })
  batchMoveToSea(@CurrentUser() user: AuthUser, @Body() dto: BatchMoveToPoolDto) {
    return this.customersService.batchMoveToSea(user, dto.ids, dto.poolId, dto.reasonId)
  }

  @Post('batch/update')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'batchUpdate')
  @ApiOperation({ summary: '批量修改客户单个字段' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: ResourceBatchEditDto) {
    return this.customersService.batchUpdate(user, dto)
  }

  @Post('batch/delete')
  @RequirePermissions('customer:delete')
  @LogOperation('customer', 'batchDelete')
  @ApiOperation({ summary: '批量删除客户（存在关联资源时拒绝）' })
  batchDelete(@CurrentUser() user: AuthUser, @Body() dto: BatchIdsDto) {
    return this.customersService.batchDelete(user, dto.ids)
  }

  @Post('pool/batch/update')
  @RequirePermissions('customerPool:update')
  @LogOperation('customerPool', 'batchUpdate')
  @ApiOperation({ summary: '客户公海批量修改字段（独立公海权限）' })
  poolBatchUpdate(@CurrentUser() user: AuthUser, @Body() dto: PoolResourceBatchEditDto) {
    return this.customersService.poolBatchUpdate(user, dto)
  }

  @Post('pool/batch/delete')
  @RequirePermissions('customerPool:delete')
  @LogOperation('customerPool', 'batchDelete')
  @ApiOperation({ summary: '客户公海批量删除（独立公海权限）' })
  poolBatchDelete(@CurrentUser() user: AuthUser, @Body() dto: PoolBatchIdsDto) {
    return this.customersService.poolBatchDelete(user, dto.poolId, dto.ids)
  }

  @Post('merge')
  @RequirePermissions('customer:merge')
  @LogOperation('customer', 'merge')
  @ApiOperation({ summary: '合并客户' })
  merge(@CurrentUser() user: AuthUser, @Body() dto: CustomerMergeDto) {
    return this.customersService.merge(user, dto)
  }

  @Post('merge/preview')
  @RequirePermissions('customer:merge')
  @ApiOperation({ summary: '客户合并影响预览（不修改数据）' })
  mergePreview(@CurrentUser() user: AuthUser, @Body() dto: CustomerMergeDto) {
    return this.customersService.mergePreview(user, dto)
  }

  @Get('check-duplicate')
  @ApiOperation({ summary: '客户查重（名称模糊 + 电话精确）' })
  checkDuplicate(@CurrentUser() user: AuthUser, @Query() query: CheckDuplicateQueryDto) {
    return this.customersService.checkDuplicate(user, query)
  }

  @Get('options')
  @ApiOperation({ summary: '客户轻量选项（租户内 id/name，用于客户关系等选择器）' })
  options(@CurrentUser() user: AuthUser, @Query('keyword') keyword?: string) {
    return this.customersService.customerOptions(user, keyword)
  }

  @Get(':id/related')
  @ApiOperation({ summary: '客户 360 关联数据' })
  related(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customersService.related(user, id)
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
  moveToSea(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveToResourcePoolDto,
  ) {
    return this.customersService.moveToSea(user, id, dto?.poolId, dto?.reasonId)
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

  @Get(':id/owner-history')
  @ApiOperation({ summary: '客户负责人历史' })
  ownerHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customersService.ownerHistory(user, id)
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
    @Body()
    body: {
      userId: string
      role?: string
      collaborationType?: 'READ_ONLY' | 'COLLABORATION'
    },
  ) {
    return this.customersService.teamAdd(
      user,
      id,
      body.userId,
      body.role,
      body.collaborationType ?? 'COLLABORATION',
    )
  }

  @Patch(':id/team/:memberId')
  @RequirePermissions('customer:team')
  @LogOperation('customer', 'teamUpdate')
  @ApiOperation({ summary: '修改客户协作类型' })
  teamUpdate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() body: { collaborationType: 'READ_ONLY' | 'COLLABORATION' },
  ) {
    if (!['READ_ONLY', 'COLLABORATION'].includes(body.collaborationType)) {
      throw new BadRequestException('协作类型仅支持 READ_ONLY/COLLABORATION')
    }
    return this.customersService.teamUpdate(user, id, memberId, body.collaborationType)
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

  @Get(':id/relations')
  @ApiOperation({ summary: '客户集团/子公司关系' })
  relationList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customersService.relationList(user, id)
  }

  @Put(':id/relations')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'relationReplace')
  @ApiOperation({ summary: '整组替换客户集团/子公司关系（Cordys 保存语义）' })
  relationReplace(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReplaceCustomerRelationsDto,
  ) {
    return this.customersService.relationReplace(user, id, dto.relations)
  }

  @Post(':id/relations')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'relationAdd')
  @ApiOperation({ summary: '添加客户集团/子公司关系' })
  relationAdd(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SaveCustomerRelationDto,
  ) {
    return this.customersService.relationAdd(user, id, dto.customerId, dto.relationType)
  }

  @Patch(':id/relations/:relationId')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'relationUpdate')
  @ApiOperation({ summary: '修改客户集团/子公司关系' })
  relationUpdate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('relationId') relationId: string,
    @Body() dto: SaveCustomerRelationDto,
  ) {
    return this.customersService.relationUpdate(
      user,
      id,
      relationId,
      dto.customerId,
      dto.relationType,
    )
  }

  @Delete(':id/relations/:relationId')
  @RequirePermissions('customer:update')
  @LogOperation('customer', 'relationDelete')
  @ApiOperation({ summary: '删除客户集团/子公司关系' })
  relationRemove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('relationId') relationId: string,
  ) {
    return this.customersService.relationRemove(user, id, relationId)
  }
}
