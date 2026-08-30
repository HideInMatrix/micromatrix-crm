-- W3.7 DB-010: generic approval resource snapshot + instance change context.
-- Keep approval_instances.business_snapshot temporarily; W3.7-9.2C removes it
-- only after all existing business handlers are migrated and regression-tested.

ALTER TABLE "approval_instances"
  ADD COLUMN "comment" TEXT,
  ADD COLUMN "update_fields" VARCHAR(2000);

CREATE TABLE "approval_resource_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formType" "ApprovalFormType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "snapshot_data" JSONB NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_resource_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_resource_snapshots_tenantId_formType_resourceId_key"
  ON "approval_resource_snapshots"("tenantId", "formType", "resourceId");

CREATE INDEX "approval_resource_snapshots_tenantId_formType_idx"
  ON "approval_resource_snapshots"("tenantId", "formType");

-- Preserve an in-flight UPDATE approval that still relies on the W3.6
-- instance-local business_snapshot. Finished historical snapshots are not copied:
-- only a currently active resource snapshot participates in rollback semantics.
INSERT INTO "approval_resource_snapshots" (
  "id",
  "tenantId",
  "formType",
  "resourceId",
  "snapshot_data",
  "created_by_id",
  "updated_by_id",
  "created_at",
  "updated_at"
)
SELECT
  'w370_' || md5(ai."id" || ':' || ai."targetId"),
  ai."tenantId",
  CASE ai."module"
    WHEN 'quote' THEN 'QUOTATION'::"ApprovalFormType"
    WHEN 'contract' THEN 'CONTRACT'::"ApprovalFormType"
    WHEN 'invoice' THEN 'INVOICE'::"ApprovalFormType"
    WHEN 'order' THEN 'ORDER'::"ApprovalFormType"
  END,
  ai."targetId",
  ai."business_snapshot",
  ai."submitterId",
  ai."submitterId",
  ai."createdAt",
  ai."updatedAt"
FROM "approval_instances" ai
WHERE ai."status" = 'PENDING'
  AND ai."executeTiming" = 'UPDATE'
  AND ai."business_snapshot" IS NOT NULL
  AND ai."module" IN ('quote', 'contract', 'invoice', 'order')
ON CONFLICT ("tenantId", "formType", "resourceId") DO UPDATE SET
  "snapshot_data" = EXCLUDED."snapshot_data",
  "updated_by_id" = EXCLUDED."updated_by_id",
  "updated_at" = EXCLUDED."updated_at";
