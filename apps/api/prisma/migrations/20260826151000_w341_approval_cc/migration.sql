CREATE TYPE "ApprovalTaskType" AS ENUM ('APPROVAL', 'CC');

ALTER TABLE "approval_node_approvers"
ADD COLUMN "cc_user_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "approval_tasks"
ADD COLUMN "task_type" "ApprovalTaskType" NOT NULL DEFAULT 'APPROVAL';

CREATE INDEX "approval_tasks_tenantId_approverId_task_type_status_idx"
ON "approval_tasks"("tenantId", "approverId", "task_type", "status");
