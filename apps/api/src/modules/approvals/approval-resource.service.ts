import { Injectable, NotFoundException } from '@nestjs/common'
import type { ApprovalModule } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { ApprovalInstance } from '../../generated/prisma/client'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ApprovalResourceCaptureService } from './approval-resource-capture.service'
import { ApprovalResourceRestoreService } from './approval-resource-restore.service'
import { ApprovalResourceSnapshotService } from './approval-resource-snapshot.service'

export interface ApprovalTargetInfo {
  name: string
  amount: number
  approvalStatus: string
}

interface ResourceRuntimeHandler {
  readonly rootKey: 'quotation' | 'contract' | 'invoice' | 'order'
  targetInfo(tenantId: string, targetId: string): Promise<ApprovalTargetInfo>
  setStatus(tenantId: string, targetId: string, status: string): Promise<void>
  delete(tenantId: string, targetId: string): Promise<void>
}

/**
 * Cordys ApprovalResourceHandler 的统一资源边界。
 * ApprovalsService 只维护审批状态机，业务资源能力由显式白名单 handler 执行。
 */
@Injectable()
export class ApprovalResourceService {
  private readonly handlers: Record<ApprovalModule, ResourceRuntimeHandler>

  constructor(
    private readonly prisma: PrismaService,
    private readonly captureService: ApprovalResourceCaptureService,
    private readonly restoreService: ApprovalResourceRestoreService,
    private readonly snapshots: ApprovalResourceSnapshotService,
  ) {
    this.handlers = {
      quote: {
        rootKey: 'quotation',
        targetInfo: (tenantId, targetId) => this.quotationTargetInfo(tenantId, targetId),
        setStatus: (tenantId, targetId, status) => this.setQuotationStatus(tenantId, targetId, status),
        delete: (tenantId, targetId) => this.deleteQuotation(tenantId, targetId),
      },
      contract: {
        rootKey: 'contract',
        targetInfo: (tenantId, targetId) => this.contractTargetInfo(tenantId, targetId),
        setStatus: (tenantId, targetId, status) => this.setContractStatus(tenantId, targetId, status),
        delete: (tenantId, targetId) => this.deleteContract(tenantId, targetId),
      },
      invoice: {
        rootKey: 'invoice',
        targetInfo: (tenantId, targetId) => this.invoiceTargetInfo(tenantId, targetId),
        setStatus: (tenantId, targetId, status) => this.setInvoiceStatus(tenantId, targetId, status),
        delete: (tenantId, targetId) => this.deleteInvoice(tenantId, targetId),
      },
      order: {
        rootKey: 'order',
        targetInfo: (tenantId, targetId) => this.orderTargetInfo(tenantId, targetId),
        setStatus: (tenantId, targetId, status) => this.setOrderStatus(tenantId, targetId, status),
        delete: (tenantId, targetId) => this.deleteOrder(tenantId, targetId),
      },
    }
  }

  capture(user: AuthUser, module: ApprovalModule, targetId: string) {
    return this.captureService.capture(user, module, targetId)
  }

  savePreUpdateSnapshot(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
    snapshotData: Prisma.InputJsonValue,
  ) {
    return this.snapshots.save(user, module, targetId, snapshotData)
  }

  async deriveUpdateFields(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
    before: Prisma.InputJsonValue,
  ): Promise<string[]> {
    const after = await this.capture(user, module, targetId)
    return this.diffBusinessFields(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      this.handlers[module].rootKey,
    )
  }

  targetInfo(tenantId: string, module: ApprovalModule, targetId: string) {
    return this.handlers[module].targetInfo(tenantId, targetId)
  }

  setBizStatus(tenantId: string, module: ApprovalModule, targetId: string, status: string) {
    return this.handlers[module].setStatus(tenantId, targetId, status)
  }

  async restore(instance: ApprovalInstance, operatorId: string) {
    if (instance.executeTiming !== 'UPDATE') return
    const snapshot = await this.snapshots.load(instance)
    if (!snapshot) return
    await this.restoreService.restore(
      instance.tenantId,
      instance.module as ApprovalModule,
      instance.targetId,
      snapshot,
      operatorId,
    )
    await this.snapshots.clear(instance)
  }

  async effectApproved(instance: ApprovalInstance) {
    if (instance.executeTiming === 'DELETE') {
      await this.handlers[instance.module as ApprovalModule].delete(instance.tenantId, instance.targetId)
      return
    }
    if (instance.executeTiming === 'UPDATE') await this.snapshots.clear(instance)
  }

  private diffBusinessFields(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    rootKey: ResourceRuntimeHandler['rootKey'],
  ) {
    const changed = new Set<string>()
    const beforeRoot = this.asRecord(before[rootKey])
    const afterRoot = this.asRecord(after[rootKey])
    for (const key of new Set([...Object.keys(beforeRoot), ...Object.keys(afterRoot)])) {
      if (!this.valuesEqual(beforeRoot[key], afterRoot[key])) changed.add(key)
    }
    this.diffDynamicFields(before.fields, after.fields, changed)
    this.diffDynamicFields(before.fieldBlobs, after.fieldBlobs, changed)
    return [...changed].sort()
  }

  private diffDynamicFields(beforeValue: unknown, afterValue: unknown, changed: Set<string>) {
    const before = this.dynamicFieldMap(beforeValue)
    const after = this.dynamicFieldMap(afterValue)
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const oldCell = before.get(key)
      const newCell = after.get(key)
      if (!this.valuesEqual(oldCell?.fieldValue, newCell?.fieldValue)) {
        const fieldId = newCell?.fieldId ?? oldCell?.fieldId
        if (fieldId) changed.add(fieldId)
      }
    }
  }

  private dynamicFieldMap(value: unknown) {
    const map = new Map<string, { fieldId: string; fieldValue: unknown }>()
    if (!Array.isArray(value)) return map
    for (const item of value) {
      const row = this.asRecord(item)
      const fieldId = typeof row.fieldId === 'string' ? row.fieldId : ''
      if (!fieldId) continue
      const key = [fieldId, row.refSubId ?? '', row.rowId ?? '', row.bizId ?? ''].join(':')
      map.set(key, { fieldId, fieldValue: row.fieldValue })
    }
    return map
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private valuesEqual(left: unknown, right: unknown) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
  }

  private normalizeApprovalStatus(status: string) {
    if (status === 'APPROVING') return 'PENDING'
    if (status === 'UNAPPROVED') return 'REJECTED'
    if (status === 'REVOKED') return 'NONE'
    return status
  }

  private toBusinessApprovalStatus(status: string) {
    if (status === 'PENDING') return 'APPROVING'
    if (status === 'REJECTED') return 'UNAPPROVED'
    return status
  }

  private async quotationTargetInfo(tenantId: string, targetId: string) {
    const row = await this.prisma.opportunityQuotation.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { name: true, amount: true, approvalStatus: true },
    })
    if (!row) throw new NotFoundException('报价不存在')
    return {
      name: `报价 ${row.name}`,
      amount: Number(row.amount),
      approvalStatus: this.normalizeApprovalStatus(row.approvalStatus),
    }
  }

  private async contractTargetInfo(tenantId: string, targetId: string) {
    const row = await this.prisma.contract.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { name: true, amount: true, approvalStatus: true },
    })
    if (!row) throw new NotFoundException('合同不存在')
    return {
      name: `合同 ${row.name}`,
      amount: Number(row.amount),
      approvalStatus: this.normalizeApprovalStatus(row.approvalStatus),
    }
  }

  private async invoiceTargetInfo(tenantId: string, targetId: string) {
    const row = await this.prisma.contractInvoice.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { name: true, amount: true, approvalStatus: true },
    })
    if (!row) throw new NotFoundException('发票不存在')
    return {
      name: `发票 ${row.name}`,
      amount: Number(row.amount ?? 0),
      approvalStatus: this.normalizeApprovalStatus(row.approvalStatus ?? 'NONE'),
    }
  }

  private async orderTargetInfo(tenantId: string, targetId: string) {
    const row = await this.prisma.order.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { name: true, amount: true, approvalStatus: true },
    })
    if (!row) throw new NotFoundException('订单不存在')
    return {
      name: `订单 ${row.name}`,
      amount: Number(row.amount ?? 0),
      approvalStatus: this.normalizeApprovalStatus(row.approvalStatus),
    }
  }

  private async setQuotationStatus(tenantId: string, targetId: string, status: string) {
    const row = await this.prisma.opportunityQuotation.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { id: true },
    })
    if (!row) throw new NotFoundException('报价不存在')
    const approvalStatus = this.toBusinessApprovalStatus(status)
    const updated = await this.prisma.opportunityQuotation.update({
      where: { id: row.id },
      data: { approvalStatus, ...(approvalStatus === 'APPROVED' ? { approved: true } : {}) },
    })
    await this.syncQuotationSnapshot(targetId, approvalStatus, updated.approved)
  }

  private async setContractStatus(tenantId: string, targetId: string, status: string) {
    const row = await this.prisma.contract.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { id: true },
    })
    if (!row) throw new NotFoundException('合同不存在')
    const approvalStatus = this.toBusinessApprovalStatus(status)
    const updated = await this.prisma.contract.update({
      where: { id: row.id },
      data: { approvalStatus, ...(approvalStatus === 'APPROVED' ? { approved: true } : {}) },
    })
    await this.syncContractSnapshot(targetId, approvalStatus, updated.approved)
  }

  private async setInvoiceStatus(tenantId: string, targetId: string, status: string) {
    const row = await this.prisma.contractInvoice.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { id: true },
    })
    if (!row) throw new NotFoundException('发票不存在')
    const approvalStatus = this.toBusinessApprovalStatus(status)
    const updated = await this.prisma.contractInvoice.update({
      where: { id: row.id },
      data: {
        approvalStatus,
        ...(approvalStatus === 'APPROVED' ? { approved: true } : {}),
        updateTime: BigInt(Date.now()),
      },
    })
    await this.syncInvoiceSnapshot(targetId, approvalStatus, updated.approved)
  }

  private async setOrderStatus(tenantId: string, targetId: string, status: string) {
    const row = await this.prisma.order.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { id: true },
    })
    if (!row) throw new NotFoundException('订单不存在')
    const approvalStatus = this.toBusinessApprovalStatus(status)
    const updated = await this.prisma.order.update({
      where: { id: row.id },
      data: {
        approvalStatus,
        ...(approvalStatus === 'APPROVED' ? { approved: true } : {}),
        updateTime: BigInt(Date.now()),
      },
    })
    await this.syncOrderSnapshot(targetId, approvalStatus, updated.approved)
  }

  private async deleteQuotation(tenantId: string, targetId: string) {
    const result = await this.prisma.opportunityQuotation.deleteMany({
      where: { id: targetId, organizationId: tenantId },
    })
    if (result.count !== 1) throw new NotFoundException('报价不存在')
  }

  private async deleteContract(tenantId: string, targetId: string) {
    const result = await this.prisma.contract.deleteMany({ where: { id: targetId, organizationId: tenantId } })
    if (result.count !== 1) throw new NotFoundException('合同不存在')
  }

  private async deleteInvoice(tenantId: string, targetId: string) {
    const result = await this.prisma.contractInvoice.deleteMany({ where: { id: targetId, organizationId: tenantId } })
    if (result.count !== 1) throw new NotFoundException('发票不存在')
  }

  private async deleteOrder(tenantId: string, targetId: string) {
    const result = await this.prisma.order.deleteMany({ where: { id: targetId, organizationId: tenantId } })
    if (result.count !== 1) throw new NotFoundException('订单不存在')
  }

  private async syncQuotationSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const rows = await this.prisma.opportunityQuotationSnapshot.findMany({ where: { quotationId: resourceId } })
    for (const row of rows) {
      if (!row.quotationValue) continue
      const value = this.parseSnapshotValue(row.quotationValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.opportunityQuotationSnapshot.update({
        where: { id: row.id },
        data: { quotationValue: JSON.stringify(value) },
      })
    }
  }

  private async syncContractSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const rows = await this.prisma.contractSnapshot.findMany({ where: { contractId: resourceId } })
    for (const row of rows) {
      if (!row.contractValue) continue
      const value = this.parseSnapshotValue(row.contractValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.contractSnapshot.update({
        where: { id: row.id },
        data: { contractValue: JSON.stringify(value) },
      })
    }
  }

  private async syncInvoiceSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const rows = await this.prisma.contractInvoiceSnapshot.findMany({ where: { invoiceId: resourceId } })
    for (const row of rows) {
      if (!row.invoiceValue) continue
      const value = this.parseSnapshotValue(row.invoiceValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.contractInvoiceSnapshot.update({
        where: { id: row.id },
        data: { invoiceValue: JSON.stringify(value) },
      })
    }
  }

  private async syncOrderSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const rows = await this.prisma.orderSnapshot.findMany({ where: { orderId: resourceId } })
    for (const row of rows) {
      if (!row.orderValue) continue
      const value = this.parseSnapshotValue(row.orderValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.orderSnapshot.update({
        where: { id: row.id },
        data: { orderValue: JSON.stringify(value) },
      })
    }
  }

  private parseSnapshotValue(raw: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
}
