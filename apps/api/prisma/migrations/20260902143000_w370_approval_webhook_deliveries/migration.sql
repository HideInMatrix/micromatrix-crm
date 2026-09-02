CREATE TYPE "ApprovalWebhookDeliverySource" AS ENUM ('TEST', 'RUNTIME');
CREATE TYPE "ApprovalWebhookDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "approval_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "instance_id" TEXT,
  "flow_id" TEXT,
  "flow_version_id" TEXT,
  "node_id" TEXT,
  "node_index" INTEGER,
  "action" TEXT,
  "source" "ApprovalWebhookDeliverySource" NOT NULL,
  "method" TEXT NOT NULL,
  "target_origin" TEXT NOT NULL,
  "target_path" TEXT NOT NULL,
  "status" "ApprovalWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "http_status" INTEGER,
  "response_bytes" INTEGER,
  "duration_ms" INTEGER,
  "error_code" VARCHAR(64),
  "error_message" VARCHAR(500),
  "created_by_id" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "approval_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "approval_webhook_deliveries_tenant_id_status_created_at_idx"
ON "approval_webhook_deliveries"("tenant_id", "status", "created_at");

CREATE INDEX "approval_webhook_deliveries_tenant_id_instance_id_created_at_idx"
ON "approval_webhook_deliveries"("tenant_id", "instance_id", "created_at");

CREATE INDEX "approval_webhook_deliveries_tenant_id_flow_id_created_at_idx"
ON "approval_webhook_deliveries"("tenant_id", "flow_id", "created_at");

ALTER TABLE "approval_webhook_deliveries"
ADD CONSTRAINT "approval_webhook_deliveries_instance_id_fkey"
FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
