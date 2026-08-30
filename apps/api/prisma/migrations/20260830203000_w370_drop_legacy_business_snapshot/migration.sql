-- W3.7 DB-010 9.2C: generic approval_resource_snapshots is now the sole
-- pre-update snapshot source. Migration 58 already copied every active
-- PENDING UPDATE snapshot before this legacy instance column is removed.

ALTER TABLE "approval_instances"
  DROP COLUMN "business_snapshot";
