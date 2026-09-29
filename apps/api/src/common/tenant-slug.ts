import { randomUUID } from 'node:crypto'

/**
 * Stable external tenant identifier used by public login/branding routes.
 * It is system-managed and intentionally carries no tenant-name/business semantics.
 */
export function createTenantSlug(): string {
  return `org-${randomUUID().replaceAll('-', '')}`
}
