import type { FieldVO } from './metadata'

/** External integrations expose a fixed set of CRM business actions; no user-supplied scripts. */
export type ExternalEventUserProvider = 'CRM' | 'WECOM' | 'DINGTALK' | 'LARK'

/** Module-aware action plan. The outer template still owns authentication and idempotency.
 * Omitted flow means the original customer-sync/conversion behavior (v1).
 */
export type ExternalEventTarget = 'lead' | 'customer'
/** `upsertCustomer` is a persisted compatibility key for payment sync; it never creates records. */
export type ExternalEventAction = 'update' | 'convert' | 'create' | 'upsertCustomer'
/** Reserved mapping targets for system columns on newly-created leads. */
export const EXTERNAL_EVENT_LEAD_CONTACT_FIELD_KEY = 'contact'
export const EXTERNAL_EVENT_LEAD_PHONE_FIELD_KEY = 'phone'
/** Reserved mapping target used to route newly-created leads into a pool. */
export const EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY = '__leadPool'

/**
 * The mapping picker and server validator must derive writable targets from the
 * current module form. Internal business columns are never exposed as ordinary
 * mappings; name/owner and lead-pool routing keep their dedicated workflows.
 */
export function externalEventWritableFormFields(
  fields: readonly FieldVO[],
  action: ExternalEventAction,
  target: ExternalEventTarget,
): FieldVO[] {
  return fields.filter((field) => {
    if (field.hidden || ['formula', 'sub_product'].includes(field.type)) return false
    if (!field.system) return true
    if (action !== 'create' || target !== 'lead') return false
    return (
      (field.key === EXTERNAL_EVENT_LEAD_CONTACT_FIELD_KEY && field.type === 'text') ||
      (field.key === EXTERNAL_EVENT_LEAD_PHONE_FIELD_KEY && field.type === 'phone')
    )
  })
}

export interface ExternalEventFlow {
  target: ExternalEventTarget
  action: ExternalEventAction
  fields: Array<{
    source: 'event' | 'leadOwner'
    externalKey: string
    /** Dynamic field key; lead-create may also target contact/phone system columns or EXTERNAL_EVENT_LEAD_POOL_FIELD_KEY. */
    fieldKey: string
    provider?: ExternalEventUserProvider
    /** Optional external enum/value translation before CRM field validation. */
    valueMap?: Array<{ externalValue: string; crmValue: string }>
  }>
  /** Required by create; maps an external data property to the record name. */
  nameExternalKey?: string
  /** Optional source identity for new owner (legacy create/convert actions). */
  owner?: { externalKey: string; provider: ExternalEventUserProvider } | null
  /** Cross-module identity for payment sync: update customer or convert a matching lead. */
  identity?: {
    phoneExternalKey: string
    customerPhoneFieldKey: string
    leadPhoneFieldKey: string
  }
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

/** Creation does not require identifiers: the server generates both. */
export type ExternalEventTemplateCreateInput = Omit<
  ExternalEventTemplateInput,
  'eventType' | 'source'
> & { eventType?: string; source?: string }

export interface ExternalEventTemplateVO extends ExternalEventTemplateInput {
  id: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface ExternalEventExecuteInput {
  /** Legacy request field, ignored for configured execution. */
  source?: string
  eventType: string
  /** Optional idempotency key for stable client retries; server generates one if absent. */
  externalEventId?: string
  data: Record<string, unknown>
}
