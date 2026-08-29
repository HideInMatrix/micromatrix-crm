export const USER_VIEW_RESOURCE_TYPES = {
  lead: 'CLUE',
  lead_pool: 'CLUE_POOL',
  customer: 'CUSTOMER',
  contact: 'CUSTOMER_CONTACT',
  customer_pool: 'CUSTOMER_POOL',
  opportunity: 'OPPORTUNITY',
  quote: 'OPPORTUNITY_QUOTATION',
  contract: 'CONTRACT',
} as const

export type UserViewModule = keyof typeof USER_VIEW_RESOURCE_TYPES
export type UserViewResourceType = (typeof USER_VIEW_RESOURCE_TYPES)[UserViewModule]

export const USER_VIEW_RESOURCE_ROUTES: Array<{
  module: UserViewModule
  resourceType: UserViewResourceType
  path: string
  label: string
}> = [
  { module: 'lead', resourceType: 'CLUE', path: 'lead/view', label: '线索视图' },
  { module: 'lead_pool', resourceType: 'CLUE_POOL', path: 'pool/lead/view', label: '线索池视图' },
  { module: 'customer', resourceType: 'CUSTOMER', path: 'account/view', label: '客户视图' },
  {
    module: 'contact',
    resourceType: 'CUSTOMER_CONTACT',
    path: 'account/contact/view',
    label: '联系人视图',
  },
  {
    module: 'customer_pool',
    resourceType: 'CUSTOMER_POOL',
    path: 'pool/account/view',
    label: '客户公海视图',
  },
  {
    module: 'opportunity',
    resourceType: 'OPPORTUNITY',
    path: 'opportunity/view',
    label: '商机视图',
  },
  {
    module: 'quote',
    resourceType: 'OPPORTUNITY_QUOTATION',
    path: 'opportunity/quotation/view',
    label: '报价单视图',
  },
  { module: 'contract', resourceType: 'CONTRACT', path: 'contract/view', label: '合同视图' },
]
