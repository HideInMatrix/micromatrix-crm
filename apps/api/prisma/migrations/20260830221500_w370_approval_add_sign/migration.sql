-- W3.7-9.3B DB-011: BEFORE / AFTER add-sign relation.
-- Forward-only migration 61. Migration 60 remains immutable.

CREATE TYPE "ApprovalAddSignType" AS ENUM ('BEFORE', 'AFTER');

CREATE TABLE "approval_add_sign_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "sign_task_id" TEXT NOT NULL,
    "type" "ApprovalAddSignType" NOT NULL,
    "root_task_id" TEXT NOT NULL,
    "sort" BIGINT NOT NULL,
    "comment" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_add_sign_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_add_sign_tasks_task_id_key"
    ON "approval_add_sign_tasks"("task_id");
CREATE INDEX "approval_add_sign_tasks_tenantId_instanceId_idx"
    ON "approval_add_sign_tasks"("tenantId", "instanceId");
CREATE INDEX "approval_add_sign_tasks_root_task_id_sort_idx"
    ON "approval_add_sign_tasks"("root_task_id", "sort");
CREATE INDEX "approval_add_sign_tasks_sign_task_id_idx"
    ON "approval_add_sign_tasks"("sign_task_id");

ALTER TABLE "approval_add_sign_tasks"
    ADD CONSTRAINT "approval_add_sign_tasks_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_add_sign_tasks"
    ADD CONSTRAINT "approval_add_sign_tasks_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "approval_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_add_sign_tasks"
    ADD CONSTRAINT "approval_add_sign_tasks_sign_task_id_fkey"
    FOREIGN KEY ("sign_task_id") REFERENCES "approval_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
