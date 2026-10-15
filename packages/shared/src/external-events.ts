/** External integrations expose a fixed set of CRM business actions; no user-supplied scripts. */
export type ExternalEventUserProvider = 'CRM' | 'WECOM' | 'DINGTALK' | 'LARK'

/** Module-aware action plan. The outer template still owns authentication and idempotency.
 * Omitted flow means the original customer-sync/conversion behavior (v1).
 */
export type ExternalEventTarget = 'lead' | 'customer'
export type ExternalEventAction = 'update' | 'convert' | 'create' | 'stage'
export interface ExternalEventFlow {
  target: ExternalEventTarget
  action: ExternalEventAction
  fields: Array<{
    source: 'event' | 'leadOwner'
    externalKey: string
    fieldKey: string
    provider?: ExternalEventUserProvider
  }>
  /** Required by create; maps an external data property to the record name. */
  nameExternalKey?: string
  /** Optional source identity for new owner (create/convert). */
  owner?: { externalKey: string; provider: ExternalEventUserProvider } | null
  /** Required by lead stage changes. */
  stageExternalKey?: string
}

export interface ExternalEventTemplateConfig {
  /** Configured v2 flow. Absence keeps existing events working without migration. */
  flow?: ExternalEventFlow
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
