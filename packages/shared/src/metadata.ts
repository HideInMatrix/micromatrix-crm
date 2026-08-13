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
  | 'formula'

export interface FieldOption {
  label: string
  value: string
  color?: string
}

export interface FieldConfig {
  placeholder?: string
  defaultValue?: unknown
  /** formula 类型的表达式，变量为同对象字段 key，如 "amount * discount / 100" */
  formula?: string
  precision?: number
  min?: number
  max?: number
}

export interface FieldVO {
  id: string
  module: string
  key: string
  label: string
  type: FieldType
  required: boolean
  system: boolean
  hidden: boolean
  options: FieldOption[] | null
  config: FieldConfig | null
  sort: number
  span: number
  showInList: boolean
  listWidth: number | null
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
  { value: 'formula', label: '计算字段' },
]

/** 自定义字段键前缀（值存业务表 customData JSONB） */
export function isCustomFieldKey(key: string): boolean {
  return key.startsWith('cf_')
}

// ============ 高级筛选 ============

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'contains'
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
  contains: '包含',
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
      return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty']
    case 'date':
    case 'datetime':
      return ['gte', 'lte', 'isEmpty', 'notEmpty']
    case 'select':
    case 'radio':
    case 'member':
    case 'dept':
    case 'switch':
      return ['eq', 'ne', 'isEmpty', 'notEmpty']
    case 'multiselect':
    case 'checkbox':
      return ['contains', 'isEmpty', 'notEmpty']
    default:
      return ['contains', 'eq', 'ne', 'isEmpty', 'notEmpty']
  }
}

// ============ 公式求值（安全的四则运算解析器，不使用 eval） ============

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; name: string }
  | { kind: 'op'; op: string }

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
export function evaluateFormula(
  expr: string,
  vars: Record<string, unknown>,
): number | null {
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
    return [...new Set(tokenize(expr).filter((t) => t.kind === 'ident').map((t) => (t as { kind: 'ident'; name: string }).name))]
  } catch {
    return []
  }
}
