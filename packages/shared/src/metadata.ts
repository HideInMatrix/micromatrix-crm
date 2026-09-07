// ============ 元数据引擎：字段类型 / 筛选 / 公式 ============

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'switch'
  | 'member'
  | 'dept'
  | 'phone'
  | 'email'
  | 'picture'
  | 'location'
  | 'attachment'
  | 'data_source'
  | 'data_source_multiple'
  | 'sub_product'
  | 'formula'

export interface FieldOption {
  label: string
  value: string
  color?: string
}

/** Cordys showControlRules：配置在控制字段上，命中任一规则时显示目标字段。 */
export interface FieldShowControlRule {
  value?: string | number | boolean
  fieldIds: string[]
}

export interface FieldLinkOption {
  /** Cordys：SELECT 为标量，SELECT_MULTIPLE 为数组。 */
  current: string | string[]
  method: 'AUTO' | 'HIDDEN'
  target: string | string[]
}

/** Cordys 普通选择字段联动；HIDDEN 表示限制目标选项范围，不是隐藏字段。 */
export interface FieldLinkProp {
  targetField: string
  linkOptions: FieldLinkOption[]
}

export type DataSourceFilterSearchMode = 'AND' | 'OR'
export type DataSourceFilterMatchType = 'MATCH_FIELD' | 'MATCH_VALUE'
export type DataSourceFilterOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'IN'
  | 'NOT_IN'
  | 'CONTAINS'
  | 'NOT_CONTAINS'
  | 'GT'
  | 'GE'
  | 'LT'
  | 'LE'
  | 'EMPTY'
  | 'NOT_EMPTY'

export interface DataSourceFilterItem {
  /** 数据源侧字段 ID。 */
  leftFieldId: string
  leftFieldType: FieldType
  operator: DataSourceFilterOperator
  matchType: DataSourceFilterMatchType
  /** MATCH_FIELD 时引用当前表单字段 ID。 */
  rightFieldId?: string
  /** MATCH_VALUE / Cordys rightFieldCustom 时使用固定值。 */
  rightFieldCustom?: boolean
  rightFieldCustomValue?: unknown
  rightFieldType?: FieldType
}

export interface DataSourceFilterCombine {
  searchMode: DataSourceFilterSearchMode
  conditions: DataSourceFilterItem[]
}

export interface DataSourceLinkField {
  /** 当前表单被填充字段 ID。 */
  current: string
  /** 数据源侧字段 ID。 */
  link: string
  method: 'fill'
  enable: boolean
}

export interface DataSourceSubFieldLinkField extends DataSourceLinkField {
  /** 父级映射时存当前/来源 SUB_PRODUCT ID；childLinks 存子字段映射。 */
  childLinks: DataSourceSubFieldLinkField[]
}

export const FORM_LINK_SCENARIO_KEYS = [
  'CLUE_TO_CUSTOMER',
  'CLUE_TO_CONTACT',
  'CLUE_TO_OPPORTUNITY',
  'CUSTOMER_TO_OPPORTUNITY',
  'CLUE_TO_RECORD',
  'CUSTOMER_TO_RECORD',
  'OPPORTUNITY_TO_RECORD',
  'PLAN_TO_RECORD',
  'CONTRACT_TO_INVOICE',
  'CONTRACT_TO_ORDER',
] as const

export type FormLinkScenarioKey = (typeof FORM_LINK_SCENARIO_KEYS)[number]

/** Cordys 表单级联动字段：current 为目标表单字段 ID，link 为来源表单字段 ID。 */
export interface FormLinkField {
  current: string
  link: string
  enable: boolean
}

export interface FormLinkScenario {
  key: FormLinkScenarioKey
  linkFields: FormLinkField[]
}

/** key 为来源 formKey；配置保存在目标表单 formProp.linkProp。 */
export type FormLinkProp = Record<string, FormLinkScenario[]>

/** MicroMatrix 当前正式消费的表单级 FormDesign 属性。 */
export interface ModuleFormProp {
  labelPos?: 'top' | 'left'
  viewSize?: 'small' | 'medium' | 'large'
  /** 既有跨表单联动配置；PLAN-FORM-001 不新增其设计器 UI。 */
  linkProp?: FormLinkProp
  /** 保留未识别扩展键，避免局部 PATCH 覆盖其它 formProp 能力。 */
  [key: string]: unknown
}

export interface FieldConfig {
  placeholder?: string
  defaultValue?: unknown
  /** Cordys rules.unique 的等价配置。 */
  unique?: boolean
  /** formula 类型的表达式，变量为同对象字段 key，如 "amount * discount / 100" */
  formula?: string
  precision?: number
  min?: number
  max?: number
  pictureShowType?: 'card' | 'list'
  uploadLimit?: number
  uploadSizeLimit?: number
  /** Cordys LOCATION 地址范围。 */
  scope?: 'ALL' | 'CN'
  /** Cordys LOCATION 地址层级。 */
  locationType?: 'C' | 'P' | 'PC' | 'PCD' | 'detail'
  /** Cordys ATTACHMENT 单附件模式。 */
  onlyOne?: boolean
  /** Cordys ATTACHMENT 允许扩展名，逗号分隔，如 `.pdf,.docx`。 */
  accept?: string
  /** Cordys ATTACHMENT 单文件大小，如 `500KB` / `20MB`。 */
  limitSize?: string
  /** Cordys DATA_SOURCE 数据源类型；自定义表单时直接保存目标 customFormId。 */
  dataSourceType?: DataSourceType
  /** Cordys 字段显隐规则，配置在控制字段上。 */
  showControlRules?: FieldShowControlRule[]
  /** Cordys SELECT / MULTISELECT 普通字段联动。 */
  linkProp?: FieldLinkProp
  /** Cordys DATA_SOURCE 候选动态过滤。 */
  combineSearch?: DataSourceFilterCombine
  /** Cordys DATA_SOURCE 选中后只读派生展示字段，值为数据源字段 ID。 */
  showFields?: string[]
  /** Cordys DATA_SOURCE -> 当前表单字段填充。 */
  linkFields?: DataSourceLinkField[]
  /** Cordys DATA_SOURCE -> SUB_PRODUCT 行填充。 */
  childLinkFields?: DataSourceSubFieldLinkField[]
  /** Cordys SUB_PRODUCT 固定左侧列数量。 */
  fixedColumn?: 1 | 2 | 3
  /** Cordys SUB_PRODUCT 汇总列，值为子字段 ID。 */
  sumColumns?: string[]
}

export const SUB_TABLE_FIELD_TYPES = [
  'text',
  'number',
  'currency',
  'percent',
  'select',
  'multiselect',
  'data_source',
  'formula',
  'picture',
  'datetime',
  'member',
  'dept',
] as const satisfies readonly FieldType[]

export type SubTableFieldType = (typeof SUB_TABLE_FIELD_TYPES)[number]

export function isSubTableFieldType(type: FieldType): type is SubTableFieldType {
  return (SUB_TABLE_FIELD_TYPES as readonly string[]).includes(type)
}

export const BUILTIN_DATA_SOURCE_TYPES = [
  'CUSTOMER',
  'CONTACT',
  'OPPORTUNITY',
  'PRODUCT',
  'CLUE',
  'PRICE',
  'CONTRACT',
  'QUOTATION',
  'PAYMENT_PLAN',
  'CONTRACT_PAYMENT_RECORD',
  'BUSINESS_TITLE',
  'ORDER',
  'INVOICE',
] as const

export type BuiltinDataSourceType = (typeof BUILTIN_DATA_SOURCE_TYPES)[number]
export type DataSourceType = BuiltinDataSourceType | string

export interface DataSourceTypeOption {
  value: BuiltinDataSourceType
  label: string
}

export interface DataSourceOptionVO {
  id: string
  name: string
}

/** DATA_SOURCE 选中记录的统一运行时快照；values 以源字段 ID 为 key。 */
export interface DataSourceRecordVO extends DataSourceOptionVO {
  values: Record<string, unknown>
  fields: FieldVO[]
}

export interface DataSourcePageVO {
  list: DataSourceOptionVO[]
  total: number
  current: number
  pageSize: number
}

export const BUILTIN_DATA_SOURCE_OPTIONS: DataSourceTypeOption[] = [
  { value: 'CUSTOMER', label: '客户' },
  { value: 'CONTACT', label: '联系人' },
  { value: 'OPPORTUNITY', label: '商机' },
  { value: 'PRODUCT', label: '产品' },
  { value: 'CLUE', label: '线索' },
  { value: 'PRICE', label: '价格表' },
  { value: 'CONTRACT', label: '合同' },
  { value: 'QUOTATION', label: '报价单' },
  { value: 'PAYMENT_PLAN', label: '回款计划' },
  { value: 'CONTRACT_PAYMENT_RECORD', label: '回款记录' },
  { value: 'BUSINESS_TITLE', label: '工商抬头' },
  { value: 'ORDER', label: '订单' },
  { value: 'INVOICE', label: '发票' },
]

export function isBuiltinDataSourceType(value?: string | null): value is BuiltinDataSourceType {
  return Boolean(value && (BUILTIN_DATA_SOURCE_TYPES as readonly string[]).includes(value))
}

export interface FieldVO {
  id: string
  module: string
  key: string
  label: string
  type: FieldType
  mobile?: boolean
  required: boolean
  system: boolean
  hidden: boolean
  options: FieldOption[] | null
  config: FieldConfig | null
  sort: number
  span: number
  showInList: boolean
  listWidth: number | null
  /** Cordys SUB_PRODUCT 嵌套子列；子列本身禁止再次包含 subFields。 */
  subFields?: FieldVO[] | null
}

export const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'currency', label: '金额' },
  { value: 'percent', label: '百分比' },
  { value: 'date', label: '日期' },
  { value: 'datetime', label: '日期时间' },
  { value: 'select', label: '单选下拉' },
  { value: 'multiselect', label: '多选下拉' },
  { value: 'radio', label: '单选框' },
  { value: 'checkbox', label: '复选框' },
  { value: 'switch', label: '开关' },
  { value: 'member', label: '成员' },
  { value: 'dept', label: '部门' },
  { value: 'phone', label: '电话' },
  { value: 'email', label: '邮箱' },
  { value: 'picture', label: '图片' },
  { value: 'location', label: '地址' },
  { value: 'attachment', label: '附件' },
  { value: 'data_source', label: '数据源（单选）' },
  { value: 'data_source_multiple', label: '数据源（多选）' },
  { value: 'sub_product', label: '子表格' },
  { value: 'formula', label: '计算字段' },
]

/** 自定义字段键前缀；目标业务域的值存对应 *_field / *_field_blob 直接表。 */
export function isCustomFieldKey(key: string): boolean {
  return key.startsWith('cf_')
}

// ============ 高级筛选 ============

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'notContains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'isEmpty'
  | 'notEmpty'

export interface FilterCondition {
  key: string
  op: FilterOp
  value?: unknown
}

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  eq: '等于',
  ne: '不等于',
  in: '属于',
  notIn: '不属于',
  contains: '包含',
  notContains: '不包含',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  isEmpty: '为空',
  notEmpty: '不为空',
}

/** 各字段类型支持的筛选操作符 */
export function filterOpsForType(type: FieldType): FilterOp[] {
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'formula':
      return ['eq', 'ne', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty']
    case 'date':
    case 'datetime':
      return ['gte', 'lte', 'isEmpty', 'notEmpty']
    case 'select':
    case 'radio':
    case 'member':
    case 'dept':
    case 'switch':
    case 'location':
    case 'data_source':
      return ['eq', 'ne', 'in', 'notIn', 'isEmpty', 'notEmpty']
    case 'attachment':
      return ['isEmpty', 'notEmpty']
    case 'sub_product':
      return []
    case 'multiselect':
    case 'checkbox':
    case 'data_source_multiple':
      return ['contains', 'notContains', 'in', 'notIn', 'isEmpty', 'notEmpty']
    default:
      return ['contains', 'notContains', 'eq', 'ne', 'in', 'notIn', 'isEmpty', 'notEmpty']
  }
}

// ============ 公式求值（安全的四则运算解析器，不使用 eval） ============

type Token =
  { kind: 'num'; value: number } | { kind: 'ident'; name: string } | { kind: 'op'; op: string }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      let j = i
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++
      const value = Number(expr.slice(i, j))
      if (Number.isNaN(value)) throw new Error(`无效数字: ${expr.slice(i, j)}`)
      tokens.push({ kind: 'num', value })
      i = j
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++
      tokens.push({ kind: 'ident', name: expr.slice(i, j) })
      i = j
      continue
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push({ kind: 'op', op: ch })
      i++
      continue
    }
    throw new Error(`无效字符: ${ch}`)
  }
  return tokens
}

/**
 * 计算公式表达式的值。变量缺失或非数字时返回 null。
 * 仅支持 + - * / 与括号，防注入。
 */
export function evaluateFormula(expr: string, vars: Record<string, unknown>): number | null {
  let tokens: Token[]
  try {
    tokens = tokenize(expr)
  } catch {
    return null
  }
  if (tokens.length === 0) return null

  let pos = 0
  let failed = false

  const consumeOp = (op: string): boolean => {
    const t = tokens[pos]
    if (t?.kind === 'op' && t.op === op) {
      pos++
      return true
    }
    return false
  }

  function parsePrimary(): number {
    const t = tokens[pos]
    if (!t) {
      failed = true
      return 0
    }
    if (t.kind === 'num') {
      pos++
      return t.value
    }
    if (t.kind === 'ident') {
      pos++
      const raw = vars[t.name]
      const value = typeof raw === 'boolean' ? Number(raw) : Number(raw)
      if (raw === undefined || raw === null || raw === '' || Number.isNaN(value)) {
        failed = true
        return 0
      }
      return value
    }
    if (consumeOp('(')) {
      const value = parseExpr()
      if (!consumeOp(')')) failed = true
      return value
    }
    if (consumeOp('-')) return -parsePrimary()
    failed = true
    return 0
  }

  function parseTerm(): number {
    let value = parsePrimary()
    for (;;) {
      if (consumeOp('*')) value *= parsePrimary()
      else if (consumeOp('/')) {
        const divisor = parsePrimary()
        value = divisor === 0 ? NaN : value / divisor
      } else return value
    }
  }

  function parseExpr(): number {
    let value = parseTerm()
    for (;;) {
      if (consumeOp('+')) value += parseTerm()
      else if (consumeOp('-')) value -= parseTerm()
      else return value
    }
  }

  const result = parseExpr()
  if (failed || pos < tokens.length || Number.isNaN(result) || !Number.isFinite(result)) {
    return null
  }
  return result
}

/** 提取公式中引用的变量名（用于设计器校验字段引用合法性） */
export function formulaVariables(expr: string): string[] {
  try {
    return [
      ...new Set(
        tokenize(expr)
          .filter((t) => t.kind === 'ident')
          .map((t) => (t as { kind: 'ident'; name: string }).name),
      ),
    ]
  } catch {
    return []
  }
}
