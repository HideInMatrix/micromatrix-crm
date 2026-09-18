import type { Varchar } from '@prisma/orm-postgres/target/codec-types'
import { randomUUID } from 'node:crypto'

/**
 * Lift an application string into Prisma 8's branded PostgreSQL varchar type.
 * Keep the assertion behind a runtime length check so callers cannot silently
 * bypass the contract's VarChar(N) boundary.
 */
export function prisma8Varchar<const N extends number>(value: string, maxLength: N): Varchar<N> {
  if (Array.from(value).length > maxLength) {
    throw new RangeError(`Prisma 8 varchar(${maxLength}) value is too long`)
  }
  return value as Varchar<N>
}

export function prisma8Varchars<const N extends number>(
  values: readonly string[],
  maxLength: N,
): Varchar<N>[] {
  return values.map((value) => prisma8Varchar(value, maxLength))
}

/**
 * Legacy Cordys tables use varchar(32) primary keys without a database default.
 * Keep ID creation explicit until those contracts can own an equivalent default.
 */
export function prisma8Id32(): Varchar<32> {
  return prisma8Varchar(randomUUID().replaceAll('-', ''), 32)
}
