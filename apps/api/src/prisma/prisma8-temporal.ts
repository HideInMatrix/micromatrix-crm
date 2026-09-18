import { Temporal } from '@js-temporal/polyfill'

/**
 * Project time columns represent absolute instants.
 *
 * Prisma 8 maps PostgreSQL `timestamptz` to `Temporal.Instant`; keep the
 * application boundary instant-first and only convert to Date when integrating
 * with APIs that still require the legacy JavaScript Date type.
 */
export function prisma8Now(): Temporal.Instant {
  return Temporal.Now.instant()
}

export function prisma8TimestampFromDate(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime())
}

export function prisma8TimestampFromISOString(value: string): Temporal.Instant {
  return Temporal.Instant.from(value)
}

export function prisma8TimestampFromEpochMilliseconds(value: number): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value)
}

export function prisma8TimestampToISOString(value: Temporal.Instant): string {
  return value.toString({ smallestUnit: 'millisecond' })
}
