import {
  HOME_SEARCH_TYPES,
  HOME_STATISTIC_PERIODS,
  HOME_TIME_FIELDS,
  HOME_USER_FIELDS,
  type HomeFilterModule,
  type HomeFilterPayload,
} from '@micromatrix/shared'

const STORAGE_PREFIX = 'micromatrix:home-filter:'

function token() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function storeHomeFilter(payload: HomeFilterPayload) {
  const key = token()
  sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(payload))
  return key
}

export function consumeHomeFilter(key: unknown, expectedModule: HomeFilterModule) {
  if (typeof key !== 'string' || !key) return null
  const storageKey = `${STORAGE_PREFIX}${key}`
  const raw = sessionStorage.getItem(storageKey)
  sessionStorage.removeItem(storageKey)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (value.module !== expectedModule) return null
    if (!HOME_STATISTIC_PERIODS.includes(value.period as never)) return null
    if (!HOME_SEARCH_TYPES.includes(value.searchType as never)) return null
    if (!Array.isArray(value.deptIds) || value.deptIds.some((id) => typeof id !== 'string'))
      return null
    if (value.userField !== undefined && !HOME_USER_FIELDS.includes(value.userField as never))
      return null
    if (value.timeField !== undefined && !HOME_TIME_FIELDS.includes(value.timeField as never))
      return null
    if (value.status !== undefined && value.status !== 'AFOOT' && value.status !== 'SUCCESS')
      return null
    return value as unknown as HomeFilterPayload
  } catch {
    return null
  }
}
