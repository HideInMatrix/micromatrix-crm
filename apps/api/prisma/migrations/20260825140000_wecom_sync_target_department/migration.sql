ALTER TABLE "organization_sync_batches"
ADD COLUMN "targetDepartmentId" TEXT;

UPDATE "organization_sync_batches" AS batch
SET "targetDepartmentId" = (
    SELECT department."id"
    FROM "departments" AS department
    WHERE department."tenantId" = batch."tenantId"
      AND department."parentId" IS NULL
    ORDER BY department."createdAt" ASC, department."id" ASC
    LIMIT 1
);

ALTER TABLE "organization_sync_batches"
ALTER COLUMN "targetDepartmentId" SET NOT NULL;

CREATE INDEX "organization_sync_batches_tenantId_targetDepartmentId_createdAt_idx"
ON "organization_sync_batches"("tenantId", "targetDepartmentId", "createdAt");
