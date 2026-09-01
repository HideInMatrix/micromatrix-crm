-- W3.7 DB-011 / 9.3C: node return-back record and round reconstruction support.
-- Cordys keeps only the latest return-back record for the same instance + target node,
-- while approval task / approval record history keeps the immutable round history.

CREATE TABLE "approval_return_back_records" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "instance_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "return_to_node_id" TEXT NOT NULL,
  "return_reason" TEXT,
  "return_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "approval_return_back_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_return_back_records_instance_id_return_to_node_id_key"
ON "approval_return_back_records"("instance_id", "return_to_node_id");

CREATE INDEX "approval_return_back_records_tenantId_instance_id_created_at_idx"
ON "approval_return_back_records"("tenantId", "instance_id", "created_at");

CREATE INDEX "approval_return_back_records_task_id_idx"
ON "approval_return_back_records"("task_id");

ALTER TABLE "approval_return_back_records"
ADD CONSTRAINT "approval_return_back_records_instance_id_fkey"
FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "approval_return_back_records"
ADD CONSTRAINT "approval_return_back_records_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "approval_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
