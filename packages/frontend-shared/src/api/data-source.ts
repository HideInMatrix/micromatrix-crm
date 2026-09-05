import {
  isBuiltinDataSourceType,
  type DataSourceOptionVO,
  type DataSourcePageVO,
  type DataSourceType,
} from '@micromatrix/shared'
import { getCustomer, listCustomers } from './customers'
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

export async function loadDataSourcePage(
  sourceType: DataSourceType,
  query: DataSourcePageQuery = {},
): Promise<DataSourcePageVO> {
  const current = query.current ?? 1
  const pageSize = query.pageSize ?? 20
  const keyword = query.keyword?.trim() || undefined

  if (!isBuiltinDataSourceType(sourceType)) {
    const { data } = await customFormApi.dataSourcePage(sourceType, { current, pageSize, keyword })
    return data
  }

  switch (sourceType) {
    case 'CUSTOMER': {
      const { data } = await listCustomers({ page: current, pageSize, keyword, view: 'ALL' })
      return {
        list: optionsOf(data.items),
        total: data.total,
        current: data.page,
        pageSize: data.pageSize,
      }
    }
    case 'CONTACT': {
      const { data } = await contactApi.page({ page: current, pageSize, keyword })
      return {
        list: optionsOf(data.items),
        total: data.total,
        current: data.page,
        pageSize: data.pageSize,
      }
    }
    case 'OPPORTUNITY': {
      const { data } = await opportunityApi.list({ page: current, pageSize, keyword })
      return {
        list: optionsOf(data.items),
        total: data.total,
        current: data.page,
        pageSize: data.pageSize,
      }
    }
    case 'CLUE': {
      const { data } = await leadApi.list({ page: current, pageSize, keyword })
      return {
        list: optionsOf(data.items),
        total: data.total,
        current: data.page,
        pageSize: data.pageSize,
      }
    }
    case 'PRODUCT': {
      const { data } = await productApi.page({ current, pageSize, keyword })
      return cordysPage(data)
    }
    case 'PRICE': {
      const { data } = await productPriceApi.page({ current, pageSize, keyword })
      return cordysPage(data)
    }
    case 'QUOTATION': {
      const { data } = await quoteApi.page({ current, pageSize, keyword })
      return cordysPage(data)
    }
    case 'CONTRACT': {
      const { data } = await contractApi.page({ current, pageSize, keyword })
      return cordysPage(data)
    }
    case 'INVOICE': {
      const { data } = await contractInvoiceApi.page({ current, pageSize, keyword })
      return cordysPage(data)
    }
    case 'BUSINESS_TITLE': {
      const { data } = await businessTitleApi.page({ current, pageSize, keyword })
      return cordysPage(data)
    }
    case 'PAYMENT_PLAN': {
      const { data } = await contractPaymentPlanApi.page({ current, pageSize, keyword })
      return cordysPage(data)
    }
    case 'CONTRACT_PAYMENT_RECORD': {
      const { data } = await contractPaymentRecordApi.page({ current, pageSize, keyword })
      return cordysPage(data)
    }
    case 'ORDER': {
      const { data } = await orderApi.page({ current, pageSize, keyword })
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
}
