import {
  filterOpsForType,
  isBuiltinDataSourceType,
  isEmptyFormValue,
  type DataSourceFilterCombine,
  type DataSourceOptionVO,
  type DataSourcePageVO,
  type DataSourceRecordVO,
  type DataSourceType,
  type FieldVO,
  type FilterCondition,
  type FilterOp,
} from '@micromatrix/shared'
import { getCustomer, getCustomerModuleForm, listCustomers } from './customers'
import { customFormApi } from './custom-form'
import { contactApi, leadApi } from './sales'

export interface DataSourcePageQuery {
  current?: number
  pageSize?: number
  keyword?: string
  filters?: FilterCondition[]
  filterMode?: 'AND' | 'OR'
}

const sourceFieldsCache = new Map<string, Promise<FieldVO[]>>()

function filterOp(
  operator: NonNullable<DataSourceFilterCombine['conditions'][number]>['operator'],
): FilterOp {
  switch (operator) {
    case 'EQUALS':
      return 'eq'
    case 'NOT_EQUALS':
      return 'ne'
    case 'IN':
      return 'in'
    case 'NOT_IN':
      return 'notIn'
    case 'CONTAINS':
      return 'contains'
    case 'NOT_CONTAINS':
      return 'notContains'
    case 'GT':
      return 'gt'
    case 'GE':
      return 'gte'
    case 'LT':
      return 'lt'
    case 'LE':
      return 'lte'
    case 'EMPTY':
      return 'isEmpty'
    case 'NOT_EMPTY':
      return 'notEmpty'
  }
}

function optionOf(value: unknown): DataSourceOptionVO | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && typeof row.name === 'string'
    ? { id: row.id, name: row.name }
    : null
}

function optionsOf(values: unknown[]): DataSourceOptionVO[] {
  return values.flatMap((value) => {
    const option = optionOf(value)
    return option ? [option] : []
  })
}

async function fetchDataSourceFields(sourceType: DataSourceType): Promise<FieldVO[]> {
  if (!isBuiltinDataSourceType(sourceType)) {
    return (await customFormApi.config(sourceType)).data.fields
  }

  switch (sourceType) {
    case 'CUSTOMER':
      return (await getCustomerModuleForm()).data.fields
    case 'CONTACT':
      return (await contactApi.moduleForm()).data.fields
    case 'CLUE':
      return (await leadApi.moduleForm()).data.fields
  }
}

export function loadDataSourceFields(sourceType: DataSourceType): Promise<FieldVO[]> {
  let cached = sourceFieldsCache.get(sourceType)
  if (!cached) {
    cached = fetchDataSourceFields(sourceType).catch((error) => {
      sourceFieldsCache.delete(sourceType)
      throw error
    })
    sourceFieldsCache.set(sourceType, cached)
  }
  return cached
}

export async function buildDataSourceFilters(
  sourceType: DataSourceType,
  combineSearch: DataSourceFilterCombine | undefined,
  currentFields: FieldVO[],
  currentValues: Record<string, unknown>,
): Promise<FilterCondition[]> {
  if (!combineSearch?.conditions.length) return []
  const sourceFields = await loadDataSourceFields(sourceType)
  const sourceById = new Map(sourceFields.map((field) => [field.id, field]))
  const currentById = new Map(currentFields.map((field) => [field.id, field]))
  const output: FilterCondition[] = []

  for (const condition of combineSearch.conditions) {
    const sourceField = sourceById.get(condition.leftFieldId)
    if (!sourceField) continue
    let value = condition.rightFieldCustomValue
    if (condition.matchType === 'MATCH_FIELD') {
      const currentField = condition.rightFieldId
        ? currentById.get(condition.rightFieldId)
        : undefined
      if (!currentField) continue
      value = currentValues[currentField.key]
      if (isEmptyFormValue(value)) continue
    }
    const op = filterOp(condition.operator)
    if (!filterOpsForType(sourceField.type).includes(op)) continue
    output.push({
      key: sourceField.key,
      op,
      ...(!['isEmpty', 'notEmpty'].includes(op) ? { value } : {}),
    })
  }
  return output
}

export async function loadDataSourcePage(
  sourceType: DataSourceType,
  query: DataSourcePageQuery = {},
): Promise<DataSourcePageVO> {
  const current = query.current ?? 1
  const pageSize = query.pageSize ?? 20
  const keyword = query.keyword?.trim() || undefined
  const filters = query.filters?.length ? query.filters : undefined
  const filterMode = query.filterMode ?? 'AND'
  const serializedFilters = filters ? JSON.stringify(filters) : undefined

  if (!isBuiltinDataSourceType(sourceType)) {
    const { data } = await customFormApi.dataSourcePage(sourceType, {
      current,
      pageSize,
      keyword,
      filters,
      filterMode,
    })
    return data
  }

  switch (sourceType) {
    case 'CUSTOMER': {
      const { data } = await listCustomers({
        page: current,
        pageSize,
        keyword,
        view: 'ALL',
        filters: serializedFilters,
        filterMode,
      })
      return {
        list: optionsOf(data.items),
        total: data.total,
        current: data.page,
        pageSize: data.pageSize,
      }
    }
    case 'CONTACT': {
      const { data } = await contactApi.page({
        page: current,
        pageSize,
        keyword,
        filters: serializedFilters,
        filterMode,
      })
      return {
        list: optionsOf(data.items),
        total: data.total,
        current: data.page,
        pageSize: data.pageSize,
      }
    }
    case 'CLUE': {
      const { data } = await leadApi.list({
        page: current,
        pageSize,
        keyword,
        filters: serializedFilters,
        filterMode,
      })
      return {
        list: optionsOf(data.items),
        total: data.total,
        current: data.page,
        pageSize: data.pageSize,
      }
    }
  }
}

async function loadBuiltinDataSourceOption(
  sourceType: Exclude<DataSourceType, string> | string,
  id: string,
): Promise<DataSourceOptionVO | null> {
  try {
    switch (sourceType) {
      case 'CUSTOMER':
        return optionOf((await getCustomer(id)).data)
      case 'CONTACT':
        return optionOf((await contactApi.get(id)).data)
      case 'CLUE':
        return optionOf((await leadApi.get(id)).data)
      default:
        return null
    }
  } catch {
    return null
  }
}

function valueFromSourceRecord(raw: Record<string, unknown>, field: FieldVO): unknown {
  if (Object.prototype.hasOwnProperty.call(raw, field.key)) return raw[field.key]
  for (const containerKey of ['values', 'customData']) {
    const container = raw[containerKey]
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      const record = container as Record<string, unknown>
      if (Object.prototype.hasOwnProperty.call(record, field.key)) return record[field.key]
    }
  }
  const moduleFields = raw['moduleFields']
  if (Array.isArray(moduleFields)) {
    const item = moduleFields.find(
      (value) =>
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>)['fieldId'] === field.id,
    ) as Record<string, unknown> | undefined
    if (item) return item['fieldValue']
  }
  return undefined
}

function sourceRecordOf(fields: FieldVO[], rawValue: unknown): DataSourceRecordVO | null {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null
  const raw = rawValue as Record<string, unknown>
  const id = raw['id']
  const name = raw['name']
  if (typeof id !== 'string' || typeof name !== 'string') return null
  return {
    id,
    name,
    fields,
    values: Object.fromEntries(
      fields.map((field) => [field.id, valueFromSourceRecord(raw, field)]),
    ),
  }
}

async function loadBuiltinDataSourceRaw(sourceType: DataSourceType, id: string): Promise<unknown> {
  switch (sourceType) {
    case 'CUSTOMER':
      return (await getCustomer(id)).data
    case 'CONTACT':
      return (await contactApi.get(id)).data
    case 'CLUE':
      return (await leadApi.get(id)).data
    default:
      return null
  }
}

export async function loadDataSourceRecord(
  sourceType: DataSourceType,
  id: string,
): Promise<DataSourceRecordVO | null> {
  const fields = await loadDataSourceFields(sourceType)
  if (!isBuiltinDataSourceType(sourceType)) {
    try {
      const { data } = await customFormApi.dataDetail(sourceType, id)
      return sourceRecordOf(fields, data)
    } catch {
      return null
    }
  }
  try {
    return sourceRecordOf(fields, await loadBuiltinDataSourceRaw(sourceType, id))
  } catch {
    return null
  }
}

export async function resolveDataSourceOptions(
  sourceType: DataSourceType,
  ids: string[],
): Promise<DataSourceOptionVO[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (!uniqueIds.length) return []

  if (!isBuiltinDataSourceType(sourceType)) {
    const { data } = await customFormApi.dataSourceResolve(sourceType, uniqueIds)
    const map = new Map(data.map((item) => [item.id, item]))
    return uniqueIds.flatMap((id) => {
      const option = map.get(id)
      return option ? [option] : []
    })
  }

  const options = await Promise.all(
    uniqueIds.map((id) => loadBuiltinDataSourceOption(sourceType, id)),
  )
  return options.filter((option): option is DataSourceOptionVO => Boolean(option))
}

export const dataSourceApi = {
  page: loadDataSourcePage,
  resolve: resolveDataSourceOptions,
  fields: loadDataSourceFields,
  record: loadDataSourceRecord,
}
