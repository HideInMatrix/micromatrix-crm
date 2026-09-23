import { isCustomFieldKey, type ContactVO, type FieldVO } from '@micromatrix/shared'

export function createContactFormModel(fields: FieldVO[]) {
  return Object.fromEntries(
    fields
      .filter((field) => field.type !== 'formula')
      .map((field) => [field.key, field.config?.defaultValue]),
  )
}

export function contactToFormModel(contact: ContactVO, fields: FieldVO[]) {
  const model = createContactFormModel(fields)

  for (const field of fields) {
    if (field.type === 'formula') continue
    if (isCustomFieldKey(field.key)) {
      model[field.key] = contact.customData[field.key]
      continue
    }
    if (field.key === 'owner') {
      model[field.key] = contact.ownerId ?? undefined
      continue
    }
    if (field.key === 'customerId') {
      model[field.key] = contact.customerId
      continue
    }
    model[field.key] = (contact as unknown as Record<string, unknown>)[field.key]
  }

  return model
}

export function contactFormToPayload(model: Record<string, unknown>) {
  const payload: Record<string, unknown> = {}
  const customData: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(model)) {
    if (value === undefined || value === '') continue
    if (isCustomFieldKey(key)) customData[key] = value
    else payload[key] = value
  }

  if (Object.keys(customData).length) payload.customData = customData
  return payload
}

export function firstMissingRequiredContactField(
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

