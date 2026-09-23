import { isCustomFieldKey, type FieldVO, type LeadVO } from '@micromatrix/shared'

export function createLeadFormModel(fields: FieldVO[]) {
  return Object.fromEntries(
    fields
      .filter((field) => field.type !== 'formula')
      .map((field) => [field.key, field.config?.defaultValue]),
  )
}

export function leadToFormModel(lead: LeadVO, fields: FieldVO[]) {
  const source = lead as unknown as Record<string, unknown>
  const model = createLeadFormModel(fields)

  for (const field of fields) {
    if (field.type === 'formula') continue
    if (isCustomFieldKey(field.key)) {
      model[field.key] = lead.customData[field.key]
      continue
    }
    if (field.key === 'contact') {
      model[field.key] = lead.contactName
      continue
    }
    if (field.key === 'owner') {
      model[field.key] = lead.ownerId
      continue
    }
    model[field.key] = source[field.key]
  }
  return model
}

export function leadFormToPayload(model: Record<string, unknown>, fields: FieldVO[]) {
  const payload: Record<string, unknown> = { moduleFields: [] }
  const fieldMap = new Map(fields.map((field) => [field.key, field]))

  for (const [key, value] of Object.entries(model)) {
    if (value === undefined || value === '') continue
    const field = fieldMap.get(key)
    if (isCustomFieldKey(key)) {
      if (!field) continue
      ;(payload.moduleFields as Array<{ fieldId: string; fieldValue: unknown }>).push({
        fieldId: field.id,
        fieldValue: value,
      })
    } else if (key === 'owner') {
      payload.owner = value
    } else if (key === 'contact') {
      payload.contact = value
    } else {
      payload[key] = value
    }
  }

  return payload
}

export function firstMissingRequiredLeadField(
  model: Record<string, unknown>,
  fields: FieldVO[],
) {
  return fields.find((field) => {
    if (!field.required || field.hidden || field.mobile === false || field.type === 'formula') {
      return false
    }
    const value = model[field.key]
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    )
  })
}

