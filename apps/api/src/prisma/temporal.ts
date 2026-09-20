import { Temporal } from '@js-temporal/polyfill'

/**
 * Project time columns represent absolute instants.
 *
 * Prisma maps PostgreSQL `timestamptz` to `Temporal.Instant`; keep the
 * application boundary instant-first and only convert to Date when integrating
 * with APIs that still require the legacy JavaScript Date type.
 */
export function nowInstant(): Temporal.Instant {
  return Temporal.Now.instant()
}

export function instantFromDate(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime())
}

export function instantFromISOString(value: string): Temporal.Instant {
  return Temporal.Instant.from(value)
}

export function instantFromEpochMilliseconds(value: number): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value)
}

export function instantToISOString(value: Temporal.Instant): string {
  return value.toString({ smallestUnit: 'millisecond' })
}
