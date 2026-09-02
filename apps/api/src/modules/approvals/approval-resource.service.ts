import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  ApprovalFieldPermission,
  ApprovalModule,
  ApprovalResourceFieldVO,
  FieldVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { ApprovalInstance } from '../../generated/prisma/client'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import {
  APPROVAL_MODULE_FORM_TYPE,
  APPROVAL_MODULE_METADATA_KEY,
  APPROVAL_MODULE_RESOURCE_TYPE,
  isApprovalEditableField,
} from './approval-field-permission.utils'
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
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
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

  async conditionFieldValues(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
  ): Promise<Record<string, unknown>> {
    const captured = (await this.capture(user, module, targetId)) as unknown as Record<string, unknown>
    const values: Record<string, unknown> = {
      ...this.asRecord(captured[this.handlers[module].rootKey]),
    }
    this.appendConditionDynamicFields(values, captured.fields)
    this.appendConditionDynamicFields(values, captured.fieldBlobs)
    return values
  }

  async approvalFields(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
    permissions: ApprovalFieldPermission[],
    forceView = false,
  ): Promise<ApprovalResourceFieldVO[]> {
    const [fields, values] = await Promise.all([
      this.moduleForms.listFields(user.tenantId, APPROVAL_MODULE_METADATA_KEY[module]),
      this.conditionFieldValues(user, module, targetId),
    ])
    const permissionMap = new Map(
      permissions.map((permission) => [permission.fieldId, permission.permissionType]),
    )
    return fields.flatMap((field) => {
      if (field.hidden) return []
      const permissionType = forceView ? 'VIEW' : (permissionMap.get(field.id) ?? 'VIEW')
      if (permissionType === 'HIDDEN') return []
      const rawValue = field.system ? values[field.key] : values[field.id]
      return [{
        fieldId: field.id,
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        options: field.options,
        value: this.approvalFieldValue(field, rawValue),
        permissionType,
      }]
    })
  }

  async updateApprovalFields(
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
    updates: Array<{ fieldId: string; value: unknown }>,
    editableFieldIds: ReadonlySet<string>,
  ) {
    await this.targetInfo(user.tenantId, module, targetId)
    const fields = await this.moduleForms.listFields(user.tenantId, APPROVAL_MODULE_METADATA_KEY[module])
    const fieldMap = new Map(fields.map((field) => [field.id, field]))
    const formType = APPROVAL_MODULE_FORM_TYPE[module]

    await this.prisma.$transaction(async (tx) => {
      for (const update of updates) {
        const field = fieldMap.get(update.fieldId)
        if (!field || !editableFieldIds.has(update.fieldId)) {
          throw new BadRequestException('审批字段不存在或当前节点无编辑权限')
        }
        if (!isApprovalEditableField(formType, field)) {
          throw new BadRequestException(`字段「${field.label}」不支持审批中编辑`)
        }
        if (field.system) {
          await this.updateApprovalSystemField(tx, user, module, targetId, field, update.value)
        } else {
          await this.fieldValues.saveBatch(
            user.tenantId,
            APPROVAL_MODULE_RESOURCE_TYPE[module],
            [targetId],
            field.id,
            update.value,
            tx,
          )
        }
      }
    })
  }

  async updateApprovalPostFields(
    tenantId: string,
    operatorId: string,
    module: ApprovalModule,
    targetId: string,
    updates: Array<{ fieldId: string; value: unknown }>,
  ) {
    if (!updates.length) return
    const actor: AuthUser = {
      id: operatorId,
      tenantId,
      email: null,
      name: '审批后置动作',
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: [],
    }
    await this.updateApprovalFields(
      actor,
      module,
      targetId,
      updates,
      new Set(updates.map((update) => update.fieldId)),
    )
  }

  async webhookVariables(
    tenantId: string,
    module: ApprovalModule,
    targetId: string,
  ): Promise<Record<string, Record<string, unknown>>> {
    const actor: AuthUser = {
      id: 'SYSTEM',
      tenantId,
      email: null,
      name: '审批 Webhook',
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: [],
    }
    const [fields, values] = await Promise.all([
      this.moduleForms.listFields(tenantId, APPROVAL_MODULE_METADATA_KEY[module]),
      this.conditionFieldValues(actor, module, targetId),
    ])
    const resource: Record<string, unknown> = { id: targetId }
    for (const field of fields) {
      const rawValue = field.system ? values[field.key] : values[field.id]
      const value = this.approvalFieldValue(field, rawValue)
      resource[field.key] = value
      resource[field.id] = value
    }
    const formType = APPROVAL_MODULE_FORM_TYPE[module]
    return {
      [formType]: resource,
      [module]: resource,
    }
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

  private approvalFieldValue(field: FieldVO, value: unknown) {
    if (value === undefined || value === null || value === '') return null
    if (field.type === 'number' || field.type === 'currency' || field.type === 'percent') {
      const parsed = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(parsed) ? parsed : value
    }
    if (field.type === 'date' || field.type === 'datetime') {
      const parsed = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(parsed) ? parsed : value
    }
    return value
  }

  private async updateApprovalSystemField(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    module: ApprovalModule,
    targetId: string,
    field: FieldVO,
    value: unknown,
  ) {
    const now = BigInt(Date.now())
    let count = 0
    if (module === 'quote') {
      if (field.key === 'name') {
        count = (await tx.opportunityQuotation.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { name: this.textFieldValue(field, value, 255)!, updateUser: user.id, updateTime: now },
        })).count
      } else if (field.key === 'untilTime') {
        count = (await tx.opportunityQuotation.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { untilTime: this.dateFieldValue(field, value)!, updateUser: user.id, updateTime: now },
        })).count
      }
    } else if (module === 'contract') {
      if (field.key === 'name') {
        count = (await tx.contract.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { name: this.textFieldValue(field, value, 255)!, updateUser: user.id, updateTime: now },
        })).count
      } else if (field.key === 'number') {
        count = (await tx.contract.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { number: this.textFieldValue(field, value, 50)!, updateUser: user.id, updateTime: now },
        })).count
      } else if (field.key === 'startTime' || field.key === 'endTime') {
        count = (await tx.contract.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: {
            [field.key]: this.dateFieldValue(field, value),
            updateUser: user.id,
            updateTime: now,
          },
        })).count
      }
    } else if (module === 'invoice') {
      if (field.key === 'name') {
        count = (await tx.contractInvoice.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { name: this.textFieldValue(field, value, 255)!, updateUser: user.id, updateTime: now },
        })).count
      } else if (field.key === 'amount') {
        count = (await tx.contractInvoice.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { amount: this.numberFieldValue(field, value), updateUser: user.id, updateTime: now },
        })).count
      } else if (field.key === 'invoiceType') {
        count = (await tx.contractInvoice.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { invoiceType: this.textFieldValue(field, value, 32), updateUser: user.id, updateTime: now },
        })).count
      } else if (field.key === 'taxRate') {
        count = (await tx.contractInvoice.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { taxRate: this.numberFieldValue(field, value), updateUser: user.id, updateTime: now },
        })).count
      }
    } else if (module === 'order') {
      if (field.key === 'name') {
        count = (await tx.order.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { name: this.textFieldValue(field, value, 255)!, updateUser: user.id, updateTime: now },
        })).count
      } else if (field.key === 'number') {
        count = (await tx.order.updateMany({
          where: { id: targetId, organizationId: user.tenantId },
          data: { number: this.textFieldValue(field, value, 50)!, updateUser: user.id, updateTime: now },
        })).count
      }
    }
    if (count !== 1) throw new BadRequestException(`字段「${field.label}」不支持审批中编辑`)
  }

  private textFieldValue(field: FieldVO, value: unknown, maxLength: number) {
    if (value === undefined || value === null || String(value).trim() === '') {
      if (field.required) throw new BadRequestException(`「${field.label}」为必填项`)
      return null
    }
    const result = String(value).trim()
    if (result.length > maxLength) throw new BadRequestException(`「${field.label}」长度不能超过 ${maxLength}`)
    return result
  }

  private numberFieldValue(field: FieldVO, value: unknown) {
    if (value === undefined || value === null || value === '') {
      if (field.required) throw new BadRequestException(`「${field.label}」为必填项`)
      return null
    }
    const result = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(result)) throw new BadRequestException(`「${field.label}」必须是有效数字`)
    if (field.config?.min !== undefined && result < field.config.min) {
      throw new BadRequestException(`「${field.label}」不能小于 ${field.config.min}`)
    }
    if (field.config?.max !== undefined && result > field.config.max) {
      throw new BadRequestException(`「${field.label}」不能大于 ${field.config.max}`)
    }
    return result
  }

  private dateFieldValue(field: FieldVO, value: unknown) {
    if (value === undefined || value === null || value === '') {
      if (field.required) throw new BadRequestException(`「${field.label}」为必填项`)
      return null
    }
    const direct = typeof value === 'number' ? value : Number(value)
    const timestamp = Number.isFinite(direct) ? direct : new Date(String(value)).getTime()
    if (!Number.isFinite(timestamp)) throw new BadRequestException(`「${field.label}」必须是有效日期`)
    return BigInt(Math.trunc(timestamp))
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

  private appendConditionDynamicFields(target: Record<string, unknown>, value: unknown) {
    if (!Array.isArray(value)) return
    for (const item of value) {
      const row = this.asRecord(item)
      const fieldId = typeof row.fieldId === 'string' ? row.fieldId : ''
      if (!fieldId) continue
      const fieldValue = this.parseConditionValue(row.fieldValue)
      const refSubId = typeof row.refSubId === 'string' ? row.refSubId : ''
      if (!refSubId) {
        target[fieldId] = fieldValue
        continue
      }
      const key = `${refSubId}.${fieldId}`
      const existing = target[key]
      target[key] = Array.isArray(existing) ? [...existing, fieldValue] : [fieldValue]
    }
  }

  private parseConditionValue(value: unknown) {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (!trimmed || !['[', '{'].includes(trimmed[0])) return value
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      return value
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
