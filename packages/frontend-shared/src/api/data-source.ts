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
import {
  businessTitleApi,
  contractApi,
  contractInvoiceApi,
  contractPaymentPlanApi,
  contractPaymentRecordApi,
  orderApi,
  productApi,
  productPriceApi,
  quoteApi,
} from './deal'
import { customFormApi } from './custom-form'
import { contactApi, leadApi, opportunityApi } from './sales'

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

function cordysPage(data: {
  list: unknown[]
  total: number
  current: number
  pageSize: number
}): DataSourcePageVO {
  return {
    list: optionsOf(data.list),
    total: data.total,
    current: data.current,
    pageSize: data.pageSize,
  }
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
    case 'OPPORTUNITY':
      return (await opportunityApi.moduleForm()).data.fields
    case 'CLUE':
      return (await leadApi.moduleForm()).data.fields
    case 'PRODUCT':
      return (await productApi.moduleForm()).data.fields
    case 'PRICE':
      return (await productPriceApi.moduleForm()).data.fields
    case 'QUOTATION':
      return (await quoteApi.moduleForm()).data.fields
    case 'CONTRACT':
      return (await contractApi.moduleForm()).data.fields
    case 'INVOICE':
      return (await contractInvoiceApi.moduleForm()).data.fields
    case 'BUSINESS_TITLE':
      return (await businessTitleApi.moduleForm()).data.fields
    case 'PAYMENT_PLAN':
      return (await contractPaymentPlanApi.moduleForm()).data.fields
    case 'CONTRACT_PAYMENT_RECORD':
      return (await contractPaymentRecordApi.moduleForm()).data.fields
    case 'ORDER':
      return (await orderApi.moduleForm()).data.fields
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
    case 'OPPORTUNITY': {
      const { data } = await opportunityApi.list({
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
    case 'PRODUCT': {
      const { data } = await productApi.page({ current, pageSize, keyword, filters, filterMode })
      return cordysPage(data)
    }
    case 'PRICE': {
      const { data } = await productPriceApi.page({
        current,
        pageSize,
        keyword,
        filters,
        filterMode,
      })
      return cordysPage(data)
    }
    case 'QUOTATION': {
      const { data } = await quoteApi.page({ current, pageSize, keyword, filters, filterMode })
      return cordysPage(data)
    }
    case 'CONTRACT': {
      const { data } = await contractApi.page({ current, pageSize, keyword, filters, filterMode })
      return cordysPage(data)
    }
    case 'INVOICE': {
      const { data } = await contractInvoiceApi.page({
        current,
        pageSize,
        keyword,
        filters,
        filterMode,
      })
      return cordysPage(data)
    }
    case 'BUSINESS_TITLE': {
      const { data } = await businessTitleApi.page({
        current,
        pageSize,
        keyword,
        filters,
        filterMode,
      })
      return cordysPage(data)
    }
    case 'PAYMENT_PLAN': {
      const { data } = await contractPaymentPlanApi.page({
        current,
        pageSize,
        keyword,
        filters,
        filterMode,
      })
      return cordysPage(data)
    }
    case 'CONTRACT_PAYMENT_RECORD': {
      const { data } = await contractPaymentRecordApi.page({
        current,
        pageSize,
        keyword,
        filters,
        filterMode,
      })
      return cordysPage(data)
    }
    case 'ORDER': {
      const { data } = await orderApi.page({ current, pageSize, keyword, filters, filterMode })
      return cordysPage(data)
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
      case 'OPPORTUNITY':
        return optionOf((await opportunityApi.get(id)).data)
      case 'CLUE':
        return optionOf((await leadApi.get(id)).data)
      case 'PRODUCT':
        return optionOf((await productApi.detail(id)).data)
      case 'PRICE':
        return optionOf((await productPriceApi.detail(id)).data)
      case 'QUOTATION':
        return optionOf((await quoteApi.detail(id)).data)
      case 'CONTRACT':
        return optionOf((await contractApi.detail(id)).data)
      case 'INVOICE':
        return optionOf((await contractInvoiceApi.detail(id)).data)
      case 'BUSINESS_TITLE':
        return optionOf((await businessTitleApi.detail(id)).data)
      case 'PAYMENT_PLAN':
        return optionOf((await contractPaymentPlanApi.detail(id)).data)
      case 'CONTRACT_PAYMENT_RECORD':
        return optionOf((await contractPaymentRecordApi.detail(id)).data)
      case 'ORDER':
        return optionOf((await orderApi.detail(id)).data)
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
    case 'OPPORTUNITY':
      return (await opportunityApi.get(id)).data
    case 'CLUE':
      return (await leadApi.get(id)).data
    case 'PRODUCT':
      return (await productApi.detail(id)).data
    case 'PRICE':
      return (await productPriceApi.detail(id)).data
    case 'QUOTATION':
      return (await quoteApi.detail(id)).data
    case 'CONTRACT':
      return (await contractApi.detail(id)).data
    case 'INVOICE':
      return (await contractInvoiceApi.detail(id)).data
    case 'BUSINESS_TITLE':
      return (await businessTitleApi.detail(id)).data
    case 'PAYMENT_PLAN':
      return (await contractPaymentPlanApi.detail(id)).data
    case 'CONTRACT_PAYMENT_RECORD':
      return (await contractPaymentRecordApi.detail(id)).data
    case 'ORDER':
      return (await orderApi.detail(id)).data
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
