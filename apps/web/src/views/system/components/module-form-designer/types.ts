import type { FieldOption, FieldType, FieldVO, ModuleKey } from '@micromatrix/shared'

export interface ModuleFormFieldDraft extends FieldVO {
  draft?: boolean
}

export interface FieldPaletteItem {
  type: FieldType
  label: string
}

export const BASIC_FIELD_PALETTE: FieldPaletteItem[] = [
  { type: 'text', label: '单行文本' },
  { type: 'textarea', label: '多行文本' },
  { type: 'number', label: '数字' },
  { type: 'datetime', label: '日期时间' },
  { type: 'radio', label: '单选' },
  { type: 'checkbox', label: '多选' },
  { type: 'select', label: '下拉单选' },
  { type: 'multiselect', label: '下拉多选' },
  { type: 'member', label: '成员' },
  { type: 'dept', label: '部门' },
  { type: 'switch', label: '开关' },
]

export const ADVANCED_FIELD_PALETTE: FieldPaletteItem[] = [
  { type: 'picture', label: '图片' },
  { type: 'location', label: '地址' },
  { type: 'phone', label: '手机' },
  { type: 'email', label: '邮箱' },
  { type: 'data_source', label: '数据单选' },
  { type: 'data_source_multiple', label: '数据多选' },
  { type: 'attachment', label: '附件' },
  { type: 'currency', label: '金额' },
  { type: 'percent', label: '百分比' },
  { type: 'formula', label: '计算' },
  { type: 'sub_product', label: '子表格' },
]

const OPTION_FIELD_TYPES = new Set<FieldType>(['select', 'multiselect', 'radio', 'checkbox'])

function defaultOptions(): FieldOption[] {
  return [1, 2, 3].map((index) => ({
    label: `选项 ${index}`,
    value: `option_${index}_${globalThis.crypto.randomUUID()}`,
  }))
}

export function createDraftField(
  module: ModuleKey,
  item: FieldPaletteItem,
): ModuleFormFieldDraft {
  const id = `draft:${globalThis.crypto.randomUUID()}`
  return {
    id,
    module,
    key: id,
    label: item.label,
    type: item.type,
    mobile: true,
    required: false,
    system: false,
    hidden: false,
    options: OPTION_FIELD_TYPES.has(item.type) ? defaultOptions() : null,
    config:
      item.type === 'formula'
        ? { formula: '', precision: 2 }
        : item.type === 'location'
          ? { scope: 'ALL', locationType: 'PCD' }
          : {},
    sort: Number.MAX_SAFE_INTEGER,
    span: item.type === 'sub_product' ? 24 : 12,
    showInList: item.type !== 'sub_product',
    listWidth: null,
    subFields: item.type === 'sub_product' ? [] : null,
    draft: true,
  }
}

export function cloneDraftField(field: ModuleFormFieldDraft): ModuleFormFieldDraft {
  const cloned = JSON.parse(JSON.stringify(field)) as ModuleFormFieldDraft
  const id = `draft:${globalThis.crypto.randomUUID()}`
  return {
    ...cloned,
    id,
    key: id,
    label: `${field.label} 副本`,
    system: false,
    draft: true,
  }
}

export function isDraftField(field: ModuleFormFieldDraft): boolean {
  return field.draft === true || field.id.startsWith('draft:')
}
