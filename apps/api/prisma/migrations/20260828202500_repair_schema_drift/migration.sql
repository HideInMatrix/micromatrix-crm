-- Repair historical schema drift without changing already-published migrations.
-- Safe on both older development databases and fresh databases built from the current migration history.

ALTER TABLE "approval_flows"
ALTER COLUMN "enabled" SET DEFAULT false;

DO $$
BEGIN
    IF to_regclass('public."organization_sync_batches_tenantId_targetDepartmentId_createdAt"') IS NOT NULL
       AND to_regclass('public."organization_sync_batches_tenantId_targetDepartmentId_creat_idx"') IS NULL THEN
        ALTER INDEX "organization_sync_batches_tenantId_targetDepartmentId_createdAt"
        RENAME TO "organization_sync_batches_tenantId_targetDepartmentId_creat_idx";
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public."organization_sync_items_tenantId_batchId_resourceType_action_id"') IS NOT NULL
       AND to_regclass('public."organization_sync_items_tenantId_batchId_resourceType_actio_idx"') IS NULL THEN
        ALTER INDEX "organization_sync_items_tenantId_batchId_resourceType_action_id"
        RENAME TO "organization_sync_items_tenantId_batchId_resourceType_actio_idx";
    END IF;
END $$;
