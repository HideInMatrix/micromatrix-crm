import { randomUUID } from 'node:crypto'

/**
 * Generate IDs for legacy Cordys tables whose primary keys remain
 * 32-character strings without a database-side default.
 */
export function createLegacyId32(): string {
  return randomUUID().replaceAll('-', '')
}
