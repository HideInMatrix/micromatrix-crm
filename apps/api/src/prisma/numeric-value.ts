import type { Numeric } from '@prisma/orm-postgres/target/codec-types'

declare const decimalStringBrand: unique symbol

export type DecimalString = string & {
  readonly [decimalStringBrand]: true
}

export function decimalString<P extends number, S extends number>(
  value: unknown,
  precision: P,
  scale: S,
): DecimalString {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError(`numeric(${precision},${scale}) value is invalid`)
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`numeric(${precision},${scale}) value is invalid`)
  }
  const normalized = typeof value === 'string' ? value.trim() : String(value)
  const match = normalized.match(/^-?(\d+)(?:\.(\d+))?$/)
  if (!match) throw new TypeError(`numeric(${precision},${scale}) value is invalid`)

  const integerDigits = match[1]!.replace(/^0+(?=\d)/, '').length
  const fractionDigits = match[2]?.length ?? 0
  if (integerDigits > precision - scale || fractionDigits > scale) {
    throw new RangeError(`numeric(${precision},${scale}) value is out of range`)
  }
  return normalized as DecimalString
}

export function numericValue<P extends number, S extends number>(
  value: DecimalString,
  _precision: P,
  _scale: S,
): Numeric<P, S> {
  return value as unknown as Numeric<P, S>
}

export function tryNumericValues<P extends number, S extends number>(
  values: readonly unknown[],
  precision: P,
  scale: S,
): Numeric<P, S>[] | null {
  try {
    return values.map((value) =>
      numericValue(decimalString(value, precision, scale), precision, scale),
    )
  } catch {
    return null
  }
}
