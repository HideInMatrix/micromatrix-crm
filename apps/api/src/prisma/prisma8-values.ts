import type { JsonValue, Numeric, Varchar } from '@prisma/orm-postgres/target/codec-types'

/**
 * Normalize application objects through JSON serialization before crossing the
 * Prisma 8 json/jsonb codec boundary. This keeps the runtime value aligned with
 * what PostgreSQL JSON can actually store and avoids unsafe structural casts.
 */
export function prisma8JsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('Prisma 8 JSON value must be JSON-serializable')
  }
  return JSON.parse(serialized) as JsonValue
}

/**
 * Prisma 8 RC10 models varchar(N) as a compile-time branded string. The
 * PostgreSQL codec still accepts a normal string at runtime and enforces the
 * column length, so keep the cast isolated at this boundary.
 */
export function prisma8Varchar<N extends number>(value: string): Varchar<N> {
  return value as Varchar<N>
}

/**
 * Prisma 8 RC10 represents numeric(p,s) inputs as branded decimal strings.
 * Validate precision/scale at the migration boundary before applying the brand.
 */
export function prisma8Numeric<P extends number, S extends number>(
  value: string | number,
  precision: P,
  scale: S,
): Numeric<P, S> {
  const normalized = String(value)
  const match = normalized.match(/^-?(\d+)(?:\.(\d+))?$/)
  if (!match) throw new TypeError(`Prisma 8 numeric(${precision},${scale}) value is invalid`)
  const integerDigits = match[1]!.replace(/^0+(?=\d)/, '').length
  const fractionDigits = match[2]?.length ?? 0
  if (integerDigits > precision - scale || fractionDigits > scale) {
    throw new RangeError(`Prisma 8 numeric(${precision},${scale}) value is out of range`)
  }
  return normalized as Numeric<P, S>
}
