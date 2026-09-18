import { Temporal } from '@js-temporal/polyfill'

/**
 * Prisma 8 maps PostgreSQL `timestamp without time zone` to
 * `Temporal.PlainDateTime`. The legacy Prisma 7 API exposes the same columns
 * as JavaScript Date values, so keep the migration boundary explicitly UTC.
 */
export function prisma8Now(): Temporal.PlainDateTime {
  return Temporal.Now.instant().toZonedDateTimeISO('UTC').toPlainDateTime()
}

export function prisma8TimestampFromDate(value: Date): Temporal.PlainDateTime {
  return Temporal.Instant.from(value.toISOString()).toZonedDateTimeISO('UTC').toPlainDateTime()
}

export function prisma8TimestampToDate(value: Temporal.PlainDateTime): Date {
  return new Date(value.toZonedDateTime('UTC').toInstant().epochMilliseconds)
}

export function prisma8TimestampToISOString(value: Temporal.PlainDateTime): string {
  return prisma8TimestampToDate(value).toISOString()
}
