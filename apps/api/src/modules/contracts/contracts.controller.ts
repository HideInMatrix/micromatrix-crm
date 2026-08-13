import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { ContractsService } from './contracts.service'
import {
  ChangeContractStatusDto,
  CreateContractDto,
  QueryContractsDto,
  UpdateContractDto,
} from './dto/contract.dto'
import { CreateInvoiceDto, IssueInvoiceDto, TitleDto } from './dto/invoice.dto'
import { CreatePlanDto, CreateRecordDto, UpdatePlanDto } from './dto/receivable.dto'
import { InvoicesService } from './invoices.service'
import { ReceivablesService } from './receivables.service'

@ApiTags('合同与回款')
@ApiBearerAuth()
@RequirePermissions('menu:contract')
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly receivablesService: ReceivablesService,
    private readonly invoicesService: InvoicesService,
  ) {}

  // ===== 工商抬头（放在具体 id 路由前） =====

  @Get('invoice-titles')
  @ApiOperation({ summary: '工商抬头列表' })
  listTitles(@CurrentUser() user: AuthUser, @Query('customerId') customerId?: string) {
    return this.invoicesService.listTitles(user, customerId)
  }

  @Post('invoice-titles')
  @RequirePermissions('invoiceTitle:manage')
  @LogOperation('invoiceTitle', 'create')
  @ApiOperation({ summary: '新建工商抬头' })
  createTitle(@CurrentUser() user: AuthUser, @Body() dto: TitleDto) {
    return this.invoicesService.createTitle(user, dto)
  }

  @Patch('invoice-titles/:id')
  @RequirePermissions('invoiceTitle:manage')
  @LogOperation('invoiceTitle', 'update')
  @ApiOperation({ summary: '更新工商抬头' })
  updateTitle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TitleDto) {
    return this.invoicesService.updateTitle(user, id, dto)
  }

  @Delete('invoice-titles/:id')
  @RequirePermissions('invoiceTitle:manage')
  @LogOperation('invoiceTitle', 'delete')
  @ApiOperation({ summary: '删除工商抬头' })
  removeTitle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoicesService.removeTitle(user, id)
  }

  // ===== 合同 =====

  @Get()
  @ApiOperation({ summary: '合同列表' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryContractsDto) {
    return this.contractsService.findAll(user, query)
  }

  @Get(':id')
  @ApiOperation({ summary: '合同详情（含明细/回款汇总）' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contractsService.findOne(user, id)
  }

  @Post()
  @RequirePermissions('contract:create')
  @LogOperation('contract', 'create')
  @ApiOperation({ summary: '新建合同（支持从报价单创建）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContractDto) {
    return this.contractsService.create(user, dto)
  }

  @Patch(':id')
  @RequirePermissions('contract:update')
  @LogOperation('contract', 'update')
  @ApiOperation({ summary: '更新合同（仅草稿）' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contractsService.update(user, id, dto)
  }

  @Post(':id/status')
  @RequirePermissions('contract:update')
  @LogOperation('contract', 'changeStatus')
  @ApiOperation({ summary: '变更合同状态（履约/完成/终止）' })
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ChangeContractStatusDto,
  ) {
    return this.contractsService.changeStatus(user, id, dto)
  }

  @Delete(':id')
  @RequirePermissions('contract:delete')
  @LogOperation('contract', 'delete')
  @ApiOperation({ summary: '删除合同（仅草稿）' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contractsService.remove(user, id)
  }

  // ===== 回款计划 =====

  @Get(':id/receivable-plans')
  @ApiOperation({ summary: '回款计划列表' })
  listPlans(@CurrentUser() user: AuthUser, @Param('id') contractId: string) {
    return this.receivablesService.listPlans(user, contractId)
  }

  @Post('receivable-plans')
  @RequirePermissions('receivable:manage')
  @LogOperation('receivablePlan', 'create')
  @ApiOperation({ summary: '新建回款计划' })
  createPlan(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    return this.receivablesService.createPlan(user, dto)
  }

  @Patch('receivable-plans/:planId')
  @RequirePermissions('receivable:manage')
  @LogOperation('receivablePlan', 'update')
  @ApiOperation({ summary: '更新回款计划' })
  updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('planId') planId: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.receivablesService.updatePlan(user, planId, dto)
  }

  @Delete('receivable-plans/:planId')
  @RequirePermissions('receivable:manage')
  @LogOperation('receivablePlan', 'delete')
  @ApiOperation({ summary: '删除回款计划' })
  removePlan(@CurrentUser() user: AuthUser, @Param('planId') planId: string) {
    return this.receivablesService.removePlan(user, planId)
  }

  // ===== 回款记录 =====

  @Get(':id/receivable-records')
  @ApiOperation({ summary: '回款记录列表' })
  listRecords(@CurrentUser() user: AuthUser, @Param('id') contractId: string) {
    return this.receivablesService.listRecords(user, contractId)
  }

  @Post('receivable-records')
  @RequirePermissions('receivable:manage')
  @LogOperation('receivableRecord', 'create')
  @ApiOperation({ summary: '登记回款' })
  createRecord(@CurrentUser() user: AuthUser, @Body() dto: CreateRecordDto) {
    return this.receivablesService.createRecord(user, dto)
  }

  @Delete('receivable-records/:recordId')
  @RequirePermissions('receivable:manage')
  @LogOperation('receivableRecord', 'delete')
  @ApiOperation({ summary: '删除回款记录' })
  removeRecord(@CurrentUser() user: AuthUser, @Param('recordId') recordId: string) {
    return this.receivablesService.removeRecord(user, recordId)
  }

  // ===== 发票 =====

  @Get(':id/invoices')
  @ApiOperation({ summary: '合同的发票记录' })
  listInvoices(@CurrentUser() user: AuthUser, @Param('id') contractId: string) {
    return this.invoicesService.listInvoices(user, contractId)
  }

  @Post('invoices')
  @RequirePermissions('invoice:manage')
  @LogOperation('invoice', 'create')
  @ApiOperation({ summary: '新建开票申请' })
  createInvoice(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.createInvoice(user, dto)
  }

  @Post('invoices/:invoiceId/issue')
  @RequirePermissions('invoice:manage')
  @LogOperation('invoice', 'issue')
  @ApiOperation({ summary: '标记已开票' })
  issueInvoice(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: IssueInvoiceDto,
  ) {
    return this.invoicesService.issueInvoice(user, invoiceId, dto)
  }

  @Post('invoices/:invoiceId/void')
  @RequirePermissions('invoice:manage')
  @LogOperation('invoice', 'void')
  @ApiOperation({ summary: '作废发票' })
  voidInvoice(@CurrentUser() user: AuthUser, @Param('invoiceId') invoiceId: string) {
    return this.invoicesService.voidInvoice(user, invoiceId)
  }
}
