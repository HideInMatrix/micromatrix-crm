import type { ApprovalFormType, ApprovalModule, FieldVO } from '@micromatrix/shared'
import type { ResourceFieldType } from '../metadata/resource-field-value.service'

export const APPROVAL_FORM_METADATA_KEY: Record<ApprovalFormType, 'quote' | 'contract' | 'invoice' | 'order'> = {
  quotation: 'quote',
  contract: 'contract',
  invoice: 'invoice',
  order: 'order',
}

export const APPROVAL_MODULE_METADATA_KEY: Record<ApprovalModule, 'quote' | 'contract' | 'invoice' | 'order'> = {
  quote: 'quote',
  contract: 'contract',
  invoice: 'invoice',
  order: 'order',
}

export const APPROVAL_MODULE_RESOURCE_TYPE: Record<ApprovalModule, ResourceFieldType> = {
  quote: 'quotation',
  contract: 'contract',
  invoice: 'invoice',
  order: 'order',
}

export const APPROVAL_MODULE_FORM_TYPE: Record<ApprovalModule, ApprovalFormType> = {
  quote: 'quotation',
  contract: 'contract',
  invoice: 'invoice',
  order: 'order',
}

const EDITABLE_TYPES = new Set<FieldVO['type']>([
  'text',
  'textarea',
  'number',
  'currency',
  'percent',
  'select',
  'multiselect',
  'date',
  'datetime',
])

const EDITABLE_SYSTEM_KEYS: Record<ApprovalFormType, ReadonlySet<string>> = {
  quotation: new Set(['name', 'untilTime']),
  contract: new Set(['name', 'number', 'startTime', 'endTime']),
  invoice: new Set(['name', 'amount', 'invoiceType', 'taxRate']),
  order: new Set(['name', 'number']),
}

export function isApprovalEditableField(formType: ApprovalFormType, field: FieldVO) {
  if (field.hidden || !EDITABLE_TYPES.has(field.type)) return false
  if (!field.system) return true
  return EDITABLE_SYSTEM_KEYS[formType].has(field.key)
}
