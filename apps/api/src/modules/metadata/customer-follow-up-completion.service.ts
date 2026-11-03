import { BadRequestException, Injectable } from '@nestjs/common'
import type { CustomerFollowUpCompletionConfig, FieldVO } from '@micromatrix/shared'
import { ModuleFormsService } from './module-forms.service'
import { ResourceFieldValueService } from './resource-field-value.service'

export interface CustomerFollowUpCompletionRule {
  enabled: boolean
  valid: boolean
  config: CustomerFollowUpCompletionConfig | null
  field: FieldVO | null
}

@Injectable()
export class CustomerFollowUpCompletionService {
  constructor(
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
  ) {}

  async getRule(tenantId: string): Promise<CustomerFollowUpCompletionRule> {
    const config = await this.moduleForms.getConfig(tenantId, 'customer')
    const raw = config.formProp.customerFollowUpCompletion
    if (!raw || typeof raw !== 'object' || raw.enabled !== true) {
      return { enabled: false, valid: true, config: null, field: null }
    }
    const rule = raw as CustomerFollowUpCompletionConfig
    const field = config.fields.find((item) => item.key === rule.fieldKey) ?? null
    const supported = field && !field.hidden && !field.system &&
      ['select', 'radio', 'checkbox', 'multiselect', 'switch'].includes(field.type)
    const multi = field?.type === 'checkbox' || field?.type === 'multiselect'
    const operatorValid = (rule.operator === 'NOT_EMPTY' && field?.type !== 'switch') ||
      (multi ? rule.operator === 'CONTAINS' : rule.operator === 'EQUALS')
    const allowedValues = field?.type === 'switch'
      ? new Set(['true', 'false'])
      : new Set((field?.options ?? []).map((option) => option.value))
    const valuesValid = Array.isArray(rule.values) &&
      rule.values.length <= 30 &&
      rule.values.every((value) => typeof value === 'string' && allowedValues.has(value)) &&
      (rule.operator === 'NOT_EMPTY' ? rule.values.length === 0 : rule.values.length > 0)
    const valid = Boolean(supported && operatorValid && valuesValid)
    return { enabled: true, valid, config: rule, field: valid ? field : null }
  }

  isCompleted(
    rule: CustomerFollowUpCompletionRule,
    values: Record<string, unknown>,
  ): boolean {
    if (!rule.enabled || !rule.valid || !rule.config || !rule.field) return false
    const value = values[rule.field.key]
    if (rule.config.operator === 'NOT_EMPTY') {
      return value !== null && value !== undefined && value !== '' &&
        !(Array.isArray(value) && value.length === 0)
    }
    const candidates = Array.isArray(value)
      ? value.map((item) => String(item))
      : value === null || value === undefined || value === ''
        ? []
        : [String(value)]
    return rule.config.values.some((expected) => candidates.includes(expected))
  }

  async evaluate(
    tenantId: string,
    customerIds: string[],
  ): Promise<{ rule: CustomerFollowUpCompletionRule; completedIds: Set<string> }> {
    const rule = await this.getRule(tenantId)
    if (!rule.enabled || !rule.valid || !customerIds.length) {
      return { rule, completedIds: new Set() }
    }
    const values = await this.fieldValues.load(tenantId, 'customer', customerIds)
    const completedIds = new Set<string>()
    for (const id of customerIds) {
      if (this.isCompleted(rule, values.get(id) ?? {})) completedIds.add(id)
    }
    return { rule, completedIds }
  }

  async assertCanTransferOwner(tenantId: string, customerId: string): Promise<void> {
    await this.assertCanTransferOwners(tenantId, [customerId])
  }

  async assertCanTransferOwners(tenantId: string, customerIds: string[]): Promise<void> {
    const ids = [...new Set(customerIds)]
    if (!ids.length) return

    const { rule, completedIds } = await this.evaluate(tenantId, ids)
    if (rule.enabled && !rule.valid) {
      throw new BadRequestException('客户跟进完结规则引用的字段已失效，请先修复系统设置')
    }

    const completedCount = ids.filter((id) => completedIds.has(id)).length
    if (completedCount > 0) {
      throw new BadRequestException(
        ids.length === 1
          ? '该客户已完成跟进，不能转移负责人'
          : '所选客户中存在已完成跟进的客户，不能批量转移负责人',
      )
    }
  }

  async assertCanMoveToPool(tenantId: string, customerId: string): Promise<void> {
    const { rule, completedIds } = await this.evaluate(tenantId, [customerId])
    if (rule.enabled && !rule.valid) {
      throw new BadRequestException('客户跟进完结规则引用的字段已失效，请先修复系统设置')
    }
    if (completedIds.has(customerId)) {
      throw new BadRequestException('该客户已完成跟进，不能移入客户公海')
    }
  }
}
