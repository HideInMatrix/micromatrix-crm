-- LOG-002: project not released; legacy operation_logs.detail is intentionally not backfilled.

CREATE TYPE "OperationLogCleanupSource" AS ENUM ('AUTO', 'MANUAL');

CREATE TABLE "operation_log_blobs" (
    "operationLogId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    CONSTRAINT "operation_log_blobs_pkey" PRIMARY KEY ("operationLogId")
);

CREATE TABLE "operation_log_settings" (
    "tenantId" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "lastCleanupAt" TIMESTAMP(3),
    "lastCleanupDeleted" INTEGER NOT NULL DEFAULT 0,
    "lastCleanupSource" "OperationLogCleanupSource",
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "operation_log_settings_pkey" PRIMARY KEY ("tenantId")
);

ALTER TABLE "operation_logs" DROP COLUMN "detail";

ALTER TABLE "operation_log_blobs"
ADD CONSTRAINT "operation_log_blobs_operationLogId_fkey"
FOREIGN KEY ("operationLogId") REFERENCES "operation_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operation_log_settings"
ADD CONSTRAINT "operation_log_settings_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
