-- W3.7 DB-011 / 9.3A: approval task round/action + independent action record.
-- Historical task comments are migrated into approval_records before the legacy
-- approval_tasks.comment column is removed, so action opinion has one truth source.

ALTER TYPE "ApprovalTaskType" ADD VALUE IF NOT EXISTS 'SIGN';
ALTER TYPE "ApprovalTaskType" ADD VALUE IF NOT EXISTS 'BACK';

CREATE TYPE "ApprovalTaskAction" AS ENUM ('APPROVE', 'REJECT', 'SIGN', 'BACK');

ALTER TABLE "approval_tasks"
ADD COLUMN "node_id" TEXT,
ADD COLUMN "node_round" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "action" "ApprovalTaskAction",
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "approval_tasks" ALTER COLUMN "updatedAt" DROP DEFAULT;

UPDATE "approval_tasks"
SET "action" = CASE
  WHEN "status" = 'APPROVED' THEN 'APPROVE'::"ApprovalTaskAction"
  WHEN "status" = 'REJECTED' THEN 'REJECT'::"ApprovalTaskAction"
  ELSE NULL
END
WHERE "status" IN ('APPROVED', 'REJECTED');

CREATE TABLE "approval_records" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "node_id" TEXT,
  "node_round" INTEGER NOT NULL DEFAULT 1,
  "result" "ApprovalTaskAction" NOT NULL,
  "comment" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "approval_records_pkey" PRIMARY KEY ("id")
);

INSERT INTO "approval_records" (
  "id",
  "tenantId",
  "instanceId",
  "taskId",
  "node_id",
  "node_round",
  "result",
  "comment",
  "created_by_id",
  "created_at",
  "updated_at"
)
SELECT
  'legacy_' || md5(task."id"),
  task."tenantId",
  task."instanceId",
  task."id",
  NULL,
  1,
  CASE
    WHEN task."status" = 'APPROVED' THEN 'APPROVE'::"ApprovalTaskAction"
    ELSE 'REJECT'::"ApprovalTaskAction"
  END,
  task."comment",
  task."approverId",
  COALESCE(task."handledAt", task."createdAt"),
  COALESCE(task."handledAt", task."createdAt")
FROM "approval_tasks" task
WHERE task."status" IN ('APPROVED', 'REJECTED');

ALTER TABLE "approval_tasks" DROP COLUMN "comment";

CREATE INDEX "approval_tasks_instanceId_nodeIndex_node_round_idx"
ON "approval_tasks"("instanceId", "nodeIndex", "node_round");

CREATE INDEX "approval_records_tenantId_instanceId_created_at_idx"
ON "approval_records"("tenantId", "instanceId", "created_at");

CREATE INDEX "approval_records_taskId_idx"
ON "approval_records"("taskId");

ALTER TABLE "approval_records"
ADD CONSTRAINT "approval_records_instanceId_fkey"
FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "approval_records"
ADD CONSTRAINT "approval_records_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "approval_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
