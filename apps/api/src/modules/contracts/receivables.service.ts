import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  ReceivablePlanStatus,
  ReceivablePlanVO,
  ReceivableRecordVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma, ReceivablePlan } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ApprovalsService } from '../approvals/approvals.service'
import { ContractsService } from './contracts.service'
import { CreatePlanDto, CreateRecordDto, UpdatePlanDto } from './dto/receivable.dto'

type PlanWithRecords = ReceivablePlan & {
  records: { amount: Prisma.Decimal; approvalStatus: string }[]
}

@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
    private readonly approvals: ApprovalsService,
  ) {}

  async listPlans(user: AuthUser, contractId: string): Promise<ReceivablePlanVO[]> {
    const plans = await this.prisma.receivablePlan.findMany({
      where: { tenantId: user.tenantId, contractId },
      include: { records: { select: { amount: true, approvalStatus: true } } },
      orderBy: { period: 'asc' },
    })
    return plans.map((p) => this.planToVO(p))
  }

  async createPlan(user: AuthUser, dto: CreatePlanDto): Promise<ReceivablePlanVO> {
    await this.contracts.ensureInScope(user, dto.contractId)
    const maxPeriod = await this.prisma.receivablePlan.aggregate({
      where: { tenantId: user.tenantId, contractId: dto.contractId },
      _max: { period: true },
    })
    const plan = await this.prisma.receivablePlan.create({
      data: {
        tenantId: user.tenantId,
        contractId: dto.contractId,
        period: (maxPeriod._max.period ?? 0) + 1,
        amount: dto.amount,
        dueDate: new Date(dto.dueDate),
        remark: dto.remark,
      },
      include: { records: { select: { amount: true, approvalStatus: true } } },
    })
    return this.planToVO(plan)
  }

  async updatePlan(user: AuthUser, id: string, dto: UpdatePlanDto): Promise<ReceivablePlanVO> {
    const existing = await this.prisma.receivablePlan.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!existing) throw new NotFoundException('回款计划不存在')
    const plan = await this.prisma.receivablePlan.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
        ...(dto.remark !== undefined ? { remark: dto.remark } : {}),
      },
      include: { records: { select: { amount: true, approvalStatus: true } } },
    })
    return this.planToVO(plan)
  }

  async removePlan(user: AuthUser, id: string) {
    const plan = await this.prisma.receivablePlan.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { records: { select: { id: true } } },
    })
    if (!plan) throw new NotFoundException('回款计划不存在')
    if (plan.records.length > 0) throw new BadRequestException('该计划已有回款记录，无法删除')
    await this.prisma.receivablePlan.delete({ where: { id } })
    return { id, name: `第${plan.period}期回款计划` }
  }

  async listRecords(user: AuthUser, contractId: string): Promise<ReceivableRecordVO[]> {
    const records = await this.prisma.receivableRecord.findMany({
      where: { tenantId: user.tenantId, contractId },
      include: { plan: { select: { period: true } } },
      orderBy: { receivedAt: 'desc' },
    })
    const ownerIds = [...new Set(records.map((r) => r.ownerId).filter((v): v is string => !!v))]
    const owners = ownerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, name: true },
        })
      : []
    const ownerMap = new Map(owners.map((o) => [o.id, o.name]))
    return records.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      planId: r.planId,
      planPeriod: r.plan?.period ?? null,
      amount: Number(r.amount),
      receivedAt: r.receivedAt.toISOString().slice(0, 10),
      method: r.method,
      remark: r.remark,
      approvalStatus: r.approvalStatus,
      ownerName: r.ownerId ? (ownerMap.get(r.ownerId) ?? null) : null,
    }))
  }

  async createRecord(user: AuthUser, dto: CreateRecordDto): Promise<{ id: string; name: string }> {
    await this.contracts.ensureInScope(user, dto.contractId)
    if (dto.planId) {
      const plan = await this.prisma.receivablePlan.findFirst({
        where: { id: dto.planId, tenantId: user.tenantId, contractId: dto.contractId },
      })
      if (!plan) throw new BadRequestException('回款计划不存在')
    }
    const record = await this.prisma.receivableRecord.create({
      data: {
        tenantId: user.tenantId,
        contractId: dto.contractId,
        planId: dto.planId,
        amount: dto.amount,
        receivedAt: new Date(dto.receivedAt),
        method: dto.method,
        remark: dto.remark,
        ownerId: user.id,
        deptId: user.deptId,
      },
    })
    // 配置了回款审批流则自动提交审批（通过前不计入已回款）
    if (await this.approvals.flowRequired(user.tenantId, 'receivableRecord', dto.amount)) {
      await this.approvals.submit(user, 'receivableRecord', record.id)
    }
    return { id: record.id, name: `回款 ¥${dto.amount}` }
  }

  async removeRecord(user: AuthUser, id: string) {
    const record = await this.prisma.receivableRecord.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!record) throw new NotFoundException('回款记录不存在')
    if (record.approvalStatus === 'PENDING') {
      throw new BadRequestException('该回款正在审批中，请先撤回审批')
    }
    await this.prisma.receivableRecord.delete({ where: { id } })
    return { id, name: `回款 ¥${Number(record.amount)}` }
  }

  private planToVO(plan: PlanWithRecords): ReceivablePlanVO {
    const paidAmount =
      Math.round(
        plan.records
          .filter((r) => r.approvalStatus === 'NONE' || r.approvalStatus === 'APPROVED')
          .reduce((sum, r) => sum + Number(r.amount), 0) * 100,
      ) / 100
    const amount = Number(plan.amount)
    let status: ReceivablePlanStatus
    if (paidAmount >= amount && amount > 0) status = 'PAID'
    else if (paidAmount > 0) status = 'PARTIAL'
    else if (plan.dueDate < new Date()) status = 'OVERDUE'
    else status = 'PENDING'

    return {
      id: plan.id,
      contractId: plan.contractId,
      period: plan.period,
      amount,
      paidAmount,
      status,
      dueDate: plan.dueDate.toISOString().slice(0, 10),
      remark: plan.remark,
    }
  }
}
