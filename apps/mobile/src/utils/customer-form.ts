import { isCustomFieldKey, type CustomerVO, type FieldVO } from '@micromatrix/shared'

export function createCustomerFormModel(fields: FieldVO[]) {
  return Object.fromEntries(
    fields
      .filter((field) => field.type !== 'formula')
      .map((field) => [field.key, field.config?.defaultValue]),
  )
}

export function customerToFormModel(customer: CustomerVO, fields: FieldVO[]) {
  const source = customer as unknown as Record<string, unknown>
  const model = createCustomerFormModel(fields)

  for (const field of fields) {
    if (field.type === 'formula') continue
    if (isCustomFieldKey(field.key)) {
      model[field.key] = customer.customData[field.key]
      continue
    }
    if (field.key === 'owner') {
      model[field.key] = customer.ownerId
      continue
    }
    model[field.key] = source[field.key]
  }
  return model
}

export function customerFormToPayload(model: Record<string, unknown>) {
  const payload: Record<string, unknown> = {}
  const customData: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(model)) {
    if (value === undefined || value === '') continue
    if (isCustomFieldKey(key)) customData[key] = value
    else payload[key] = value
  }

  payload.customData = customData
  return payload
}

export function firstMissingRequiredCustomerField(
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

