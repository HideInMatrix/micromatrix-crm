import type { ContactVO, CustomerVO, LeadVO } from '@micromatrix/shared'
import { computed, ref } from 'vue'
import { getCustomerTabs, listCustomers } from '@/api/customers'
import { contactApi, leadApi, resourcePoolApi } from '@/api/sales'
import { useAuthStore } from '@/stores/auth'

export type GlobalSearchGroupKey =
  | 'lead'
  | 'leadPool'
  | 'customer'
  | 'customerPool'
  | 'contact'

export interface GlobalSearchItem {
  id: string
  name: string
  description?: string
}

export interface GlobalSearchGroup {
  key: GlobalSearchGroupKey
  label: string
  count: number
  items: GlobalSearchItem[]
}

const ITEM_LIMIT = 10

const loading = ref(false)
const groups = ref<Record<GlobalSearchGroupKey, GlobalSearchGroup>>({
  lead: { key: 'lead', label: '线索', count: 0, items: [] },
  leadPool: { key: 'leadPool', label: '线索池', count: 0, items: [] },
  customer: { key: 'customer', label: '客户', count: 0, items: [] },
  customerPool: { key: 'customerPool', label: '公海', count: 0, items: [] },
  contact: { key: 'contact', label: '联系人', count: 0, items: [] },
})
const searchedKeyword = ref('')
const activeNames = ref<string[]>([])
let searchContextKey = ''
let generation = 0

function mapLead(item: LeadVO, description?: string): GlobalSearchItem {
  return {
    id: item.id,
    name: item.name,
    description:
      description ??
      ([item.contactName, item.phone, item.ownerName].filter(Boolean).join(' · ') || undefined),
  }
}

function mapCustomer(item: CustomerVO, description?: string): GlobalSearchItem {
  return {
    id: item.id,
    name: item.name,
    description:
      description ??
      ([item.phone, item.ownerName].filter(Boolean).join(' · ') || undefined),
  }
}

function mapContact(item: ContactVO): GlobalSearchItem {
  return {
    id: item.id,
    name: item.name,
    description: [item.customerName, item.phone, item.ownerName].filter(Boolean).join(' · ') || undefined,
  }
}

export function useGlobalSearch() {
  const auth = useAuthStore()

  const visibleGroupKeys = computed<GlobalSearchGroupKey[]>(() => {
    const keys: GlobalSearchGroupKey[] = []
    if (auth.hasPerm('menu:lead')) keys.push('lead')
    if (auth.hasPerm('leadPool:read')) keys.push('leadPool')
    if (auth.hasPerm('menu:customer')) keys.push('customer')
    if (auth.hasPerm('customerPool:read')) keys.push('customerPool')
    if (auth.hasPerm('contact:read')) keys.push('contact')
    return keys
  })

  const visibleGroups = computed(() => visibleGroupKeys.value.map((key) => groups.value[key]))

  function clear() {
    generation += 1
    searchedKeyword.value = ''
    activeNames.value = []
    for (const group of Object.values(groups.value)) {
      group.count = 0
      group.items = []
    }
    loading.value = false
  }

  async function searchLeads(keyword: string) {
    const { data } = await leadApi.list({
      page: 1,
      pageSize: ITEM_LIMIT,
      scope: 'mine',
      keyword,
    })
    return {
      count: data.total,
      items: data.items.map((item) => mapLead(item)),
    }
  }

  async function searchLeadPools(keyword: string) {
    const { data: pools } = await leadApi.poolOptions()
    const pages = await Promise.all(
      pools.map(async (pool) => {
        const { data } = await leadApi.list({
          page: 1,
          pageSize: ITEM_LIMIT,
          scope: 'pool',
          poolId: pool.id,
          keyword,
        })
        return {
          poolName: pool.name,
          total: data.total,
          items: data.items,
        }
      }),
    )
    return {
      count: pages.reduce((sum, page) => sum + page.total, 0),
      items: pages
        .flatMap((page) => page.items.map((item) => mapLead(item, page.poolName)))
        .slice(0, ITEM_LIMIT),
    }
  }

  async function searchCustomers(keyword: string) {
    const { data: tabs } = await getCustomerTabs()
    const view = tabs.all ? 'ALL' : tabs.dept ? 'DEPARTMENT' : 'SELF'
    const { data } = await listCustomers({
      page: 1,
      pageSize: ITEM_LIMIT,
      keyword,
      view,
    })
    return {
      count: data.total,
      items: data.items.map((item) => mapCustomer(item)),
    }
  }

  async function searchCustomerPools(keyword: string) {
    const { data: pools } = await resourcePoolApi.options('customer')
    const pages = await Promise.all(
      pools.map(async (pool) => {
        const { data } = await listCustomers({
          page: 1,
          pageSize: ITEM_LIMIT,
          keyword,
          scope: 'sea',
          poolId: pool.id,
        })
        return {
          poolName: pool.name,
          total: data.total,
          items: data.items,
        }
      }),
    )
    return {
      count: pages.reduce((sum, page) => sum + page.total, 0),
      items: pages
        .flatMap((page) => page.items.map((item) => mapCustomer(item, page.poolName)))
        .slice(0, ITEM_LIMIT),
    }
  }

  async function searchContacts(keyword: string) {
    const { data: tabs } = await contactApi.tab()
    const scopeView = tabs.all ? 'ALL' : tabs.dept ? 'DEPT' : 'SELF'
    const { data } = await contactApi.page({
      page: 1,
      pageSize: ITEM_LIMIT,
      keyword,
      scopeView,
    })
    return {
      count: data.total,
      items: data.items.map(mapContact),
    }
  }

  const searchers: Record<
    GlobalSearchGroupKey,
    (keyword: string) => Promise<{ count: number; items: GlobalSearchItem[] }>
  > = {
    lead: searchLeads,
    leadPool: searchLeadPools,
    customer: searchCustomers,
    customerPool: searchCustomerPools,
    contact: searchContacts,
  }

  async function search(rawKeyword: string) {
    const keyword = rawKeyword.trim()
    if (!keyword) {
      clear()
      return
    }

    const currentContextKey = `${auth.user?.tenantId ?? ''}:${auth.user?.id ?? ''}`
    if (searchContextKey !== currentContextKey) {
      clear()
      searchContextKey = currentContextKey
    }
    if (searchedKeyword.value === keyword && !loading.value) return

    const currentGeneration = ++generation
    loading.value = true
    const keys = visibleGroupKeys.value
    const results = await Promise.allSettled(keys.map((key) => searchers[key](keyword)))

    if (currentGeneration !== generation) return

    results.forEach((result, index) => {
      const key = keys[index]
      if (!key) return
      if (result.status === 'fulfilled') {
        groups.value[key].count = result.value.count
        groups.value[key].items = result.value.items
      } else {
        groups.value[key].count = 0
        groups.value[key].items = []
      }
    })
    searchedKeyword.value = keyword
    loading.value = false
  }

  return {
    loading,
    visibleGroups,
    searchedKeyword,
    activeNames,
    search,
    clear,
  }
}

