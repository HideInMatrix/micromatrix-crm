/** External integrations expose a fixed set of CRM business actions; no user-supplied scripts. */
export type ExternalEventUserProvider = 'CRM' | 'WECOM' | 'DINGTALK' | 'LARK'

export interface ExternalEventTemplateConfig {
  actions: { convertLead: boolean; updateCustomer: boolean }
  /** AND / exact lookup using the existing strict external resource resolver. */
  matches: Array<{ externalKey: string; crmFieldKey: string }>
  /** Non-system customer fields only. leadOwner resolves from Clue.owner on conversion. */
  fields: Array<{
    source: 'event' | 'leadOwner'
    externalKey: string
    customerFieldKey: string
    /** Member fields may use an external identity namespace. Defaults to the owner source's provider for the same input. */
    provider?: ExternalEventUserProvider
  }>
  /** On NEW customer creation only; existing customer owner is never silently transferred. */
  owner: { externalKey: string; provider: ExternalEventUserProvider } | null
}

export interface ExternalEventTemplateInput {
  name: string
  eventType: string
  source: string
  apiKeyUserId: string
  enabled: boolean
  config: ExternalEventTemplateConfig
}

export interface ExternalEventTemplateVO extends ExternalEventTemplateInput {
  id: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface ExternalEventExecuteInput {
  source: string
  eventType: string
  externalEventId: string
  data: Record<string, unknown>
}

export interface ExternalEventLogVO {
  id: string
  externalEventId: string
  status: string
  resolvedType: string | null
  resolvedId: string | null
  customerId: string | null
  attempts: number
  receivedAt: string
  completedAt: string | null
  errorCode: string | null
  errorMessage: string | null
}
