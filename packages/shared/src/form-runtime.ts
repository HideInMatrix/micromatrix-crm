import type { DataSourceRecordVO, FieldLinkOption, FieldVO, FormLinkScenario } from './metadata'

export interface FormRuntimeState {
  values: Record<string, unknown>
  visibleByFieldId: Record<string, boolean>
  optionRangesByFieldId: Record<string, string[] | undefined>
}

export function isEmptyFormValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function normalizedOptionValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (value === undefined || value === null || value === '') return []
  return [String(value)]
}

function sameOptionSet(left: unknown, right: unknown): boolean {
  const a = normalizedOptionValues(left)
  const b = normalizedOptionValues(right)
  if (a.length !== b.length) return false
  return a.every((value) => b.includes(value))
}

function fieldLinkMatches(source: FieldVO, current: unknown, expected: string | string[]): boolean {
  if (source.type === 'select') {
    const currentValues = normalizedOptionValues(current)
    const expectedValues = normalizedOptionValues(expected)
    return (
      currentValues.length === 1 &&
      expectedValues.length === 1 &&
      currentValues[0] === expectedValues[0]
    )
  }
  return sameOptionSet(current, expected)
}

function controlRuleMatches(value: unknown, expected: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => Object.is(item, expected))
  return Object.is(value, expected)
}

/**
 * 计算字段最终可见性。永久 hidden 优先；showControlRules 跨控制字段保持 Cordys OR 语义。
 */
export function computeFieldVisibility(
  fields: FieldVO[],
  values: Record<string, unknown>,
): Record<string, boolean> {
  const byId = new Map(fields.map((field) => [field.id, field]))
  const controlled = new Map<string, boolean[]>()

  for (const controlField of fields) {
    for (const rule of controlField.config?.showControlRules ?? []) {
      const matched = controlRuleMatches(values[controlField.key], rule.value)
      for (const targetId of rule.fieldIds) {
        if (!byId.has(targetId)) continue
        const states = controlled.get(targetId) ?? []
        states.push(matched)
        controlled.set(targetId, states)
      }
    }
  }

  return Object.fromEntries(
    fields.map((field) => {
      if (field.hidden) return [field.id, false]
      const rules = controlled.get(field.id)
      return [field.id, rules ? rules.some(Boolean) : true]
    }),
  )
}

function linkedValueForTarget(targetField: FieldVO, option: FieldLinkOption): unknown {
  const multiple = ['multiselect', 'checkbox', 'data_source_multiple'].includes(targetField.type)
  if (multiple) return Array.isArray(option.target) ? [...option.target] : [option.target]
  return Array.isArray(option.target) ? option.target[0] : option.target
}

/** SELECT/MULTISELECT AUTO 与 HIDDEN(范围限制) 的纯运行时。 */
export function applyFieldLinks(
  fields: FieldVO[],
  input: Record<string, unknown>,
): Pick<FormRuntimeState, 'values' | 'optionRangesByFieldId'> {
  const values = { ...input }
  const byId = new Map(fields.map((field) => [field.id, field]))
  let optionRangesByFieldId: Record<string, string[] | undefined> = {}

  // AUTO 可能级联触发后续控制字段；用有界迭代收敛，配置层同时禁止环。
  for (let pass = 0; pass < Math.max(1, fields.length); pass++) {
    let changed = false
    const nextRanges: Record<string, string[] | undefined> = {}

    for (const source of fields) {
      const link = source.config?.linkProp
      if (!link) continue
      const target = byId.get(link.targetField)
      if (!target) continue
      const current = values[source.key]
      const matched = link.linkOptions.find((option) =>
        fieldLinkMatches(source, current, option.current),
      )
      if (!matched) continue

      if (matched.method === 'HIDDEN') {
        nextRanges[target.id] = normalizedOptionValues(matched.target)
        continue
      }

      const nextValue = linkedValueForTarget(target, matched)
      if (!sameOptionSet(values[target.key], nextValue)) {
        values[target.key] = nextValue
        changed = true
      }
    }

    optionRangesByFieldId = nextRanges
    if (!changed) break
  }

  return { values, optionRangesByFieldId }
}

export function evaluateFormRuntime(
  fields: FieldVO[],
  input: Record<string, unknown>,
): FormRuntimeState {
  const linked = applyFieldLinks(fields, input)
  return {
    ...linked,
    visibleByFieldId: computeFieldVisibility(fields, linked.values),
  }
}

export function valueWithinOptionRange(value: unknown, range?: string[]): boolean {
  if (!range) return true
  const values = normalizedOptionValues(value)
  return values.every((item) => range.includes(item))
}

function linkedOptionLabels(field: FieldVO, value: unknown): string[] {
  const optionMap = new Map((field.options ?? []).map((option) => [option.value, option.label]))
  return normalizedOptionValues(value).map((item) => optionMap.get(item) ?? item)
}

export function convertLinkedFieldValue(target: FieldVO, source: FieldVO, value: unknown): unknown {
  if (isEmptyFormValue(value)) return undefined
  if (target.type === 'data_source' || target.type === 'data_source_multiple') {
    if (!['data_source', 'data_source_multiple'].includes(source.type)) return undefined
    if (target.config?.dataSourceType !== source.config?.dataSourceType) return undefined
    const values = normalizedOptionValues(value)
    return target.type === 'data_source_multiple' ? values : values[0]
  }

  if (target.type === 'select' || target.type === 'multiselect') {
    const labels = linkedOptionLabels(source, value)
    const targetByLabel = new Map(
      (target.options ?? []).map((option) => [option.label, option.value]),
    )
    const mapped = labels.flatMap((label) => {
      const option = targetByLabel.get(label)
      return option ? [option] : []
    })
    return target.type === 'multiselect' ? mapped : mapped[0]
  }

  if (target.type === 'text' || target.type === 'textarea') {
    if (Array.isArray(value)) return value.map(String).join(',')
    return String(value)
  }

  if (target.type === source.type) return value
  if (['number', 'currency', 'percent'].includes(target.type)) {
    const number = Number(value)
    return Number.isFinite(number) ? number : undefined
  }
  return undefined
}

/** Cordys formLink 设计器的字段可选边界；比 DATA_SOURCE 填充更严格。 */
export function isFormLinkFieldCompatible(target: FieldVO, source: FieldVO): boolean {
  if (target.type === 'formula' || ['sub_product', 'picture', 'attachment'].includes(target.type)) {
    return false
  }
  if (['sub_product', 'picture', 'attachment'].includes(source.type)) return false

  if (target.type === 'text' || target.type === 'textarea') return true

  if (target.type === 'data_source' || target.type === 'data_source_multiple') {
    if (!['data_source', 'data_source_multiple'].includes(source.type)) return false
    if (target.config?.dataSourceType !== source.config?.dataSourceType) return false
    return target.type === 'data_source_multiple' || source.type === 'data_source'
  }

  if (target.type === 'select' || target.type === 'radio') {
    return source.type === 'select' || source.type === 'radio'
  }
  if (target.type === 'multiselect' || target.type === 'checkbox') {
    return ['select', 'radio', 'multiselect', 'checkbox'].includes(source.type)
  }

  return target.type === source.type
}

/**
 * Cordys formLink 场景运行时。sourceValues / 返回值均以字段 key 为键，
 * 配置本身严格使用字段 ID，避免业务 key 改名后产生隐式映射。
 */
export function applyFormLinkScenario(
  sourceFields: FieldVO[],
  targetFields: FieldVO[],
  scenario: FormLinkScenario | undefined,
  sourceValues: Record<string, unknown>,
): Record<string, unknown> {
  if (!scenario) return {}
  const sourceById = new Map(sourceFields.map((field) => [field.id, field]))
  const targetById = new Map(targetFields.map((field) => [field.id, field]))
  const output: Record<string, unknown> = {}

  for (const link of scenario.linkFields) {
    if (!link.enable) continue
    const target = targetById.get(link.current)
    const source = sourceById.get(link.link)
    if (!target || !source || !isFormLinkFieldCompatible(target, source)) continue
    const converted = convertLinkedFieldValue(target, source, sourceValues[source.key])
    if (converted !== undefined) output[target.key] = converted
  }
  return output
}

/**
 * DATA_SOURCE 选中记录后的字段填充。只处理配置允许的顶层字段和 SUB_PRODUCT 行；
 * 权限与引用存在性仍由各数据源 API / 保存 API 负责。
 */
export function applyDataSourceRecordLinks(
  fields: FieldVO[],
  dataSourceField: FieldVO,
  record: DataSourceRecordVO,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const values = { ...input }
  const currentById = new Map(fields.map((field) => [field.id, field]))
  const sourceById = new Map(record.fields.map((field) => [field.id, field]))

  for (const link of dataSourceField.config?.linkFields ?? []) {
    if (!link.enable) continue
    const target = currentById.get(link.current)
    if (!target) continue
    if (link.link === dataSourceField.id) {
      if (
        ['data_source', 'data_source_multiple'].includes(target.type) &&
        target.config?.dataSourceType === dataSourceField.config?.dataSourceType
      ) {
        values[target.key] = target.type === 'data_source_multiple' ? [record.id] : record.id
      }
      continue
    }
    const source = sourceById.get(link.link)
    if (!source) continue
    const linked = convertLinkedFieldValue(target, source, record.values[source.id])
    if (linked === undefined) delete values[target.key]
    else values[target.key] = linked
  }

  for (const parentLink of dataSourceField.config?.childLinkFields ?? []) {
    if (!parentLink.enable) continue
    const targetParent = currentById.get(parentLink.current)
    const sourceParent = sourceById.get(parentLink.link)
    if (
      !targetParent ||
      targetParent.type !== 'sub_product' ||
      sourceParent?.type !== 'sub_product'
    ) {
      continue
    }
    const sourceRows = record.values[sourceParent.id]
    if (!Array.isArray(sourceRows)) {
      values[targetParent.key] = []
      continue
    }
    const targetChildren = new Map((targetParent.subFields ?? []).map((field) => [field.id, field]))
    const sourceChildren = new Map((sourceParent.subFields ?? []).map((field) => [field.id, field]))
    values[targetParent.key] = sourceRows.flatMap((rawRow) => {
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) return []
      const sourceRow = rawRow as Record<string, unknown>
      const row: Record<string, unknown> = {}
      for (const childLink of parentLink.childLinks) {
        if (!childLink.enable) continue
        const target = targetChildren.get(childLink.current)
        const source = sourceChildren.get(childLink.link)
        if (!target || !source || target.type === 'formula') continue
        const linked = convertLinkedFieldValue(target, source, sourceRow[source.key])
        if (linked !== undefined) row[target.key] = linked
      }
      return [row]
    })
  }

  return values
}
