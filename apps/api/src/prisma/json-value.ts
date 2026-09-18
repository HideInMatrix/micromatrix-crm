import type { JsonValue } from '@prisma/orm-postgres/target/codec-types'

function assertFiniteJsonNumbers(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('JSON value cannot contain NaN or Infinity')
    }
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) assertFiniteJsonNumbers(item, seen)
    return
  }
  for (const item of Object.values(value)) assertFiniteJsonNumbers(item, seen)
}

export function jsonValue(value: unknown): JsonValue {
  assertFiniteJsonNumbers(value)
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('JSON value must be JSON-serializable')
  }
  return JSON.parse(serialized) as JsonValue
}
