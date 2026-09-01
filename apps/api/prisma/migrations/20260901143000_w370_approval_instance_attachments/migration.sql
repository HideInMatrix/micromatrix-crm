-- W3.7-9.3E / DB-011: approval action attachment relation.
CREATE TABLE "approval_instance_attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "element_id" TEXT NOT NULL,
    "attachment_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_instance_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_instance_attachments_instance_id_element_id_attachment_id_key"
ON "approval_instance_attachments"("instance_id", "element_id", "attachment_id");

CREATE INDEX "approval_instance_attachments_tenantId_instance_id_created_at_idx"
ON "approval_instance_attachments"("tenantId", "instance_id", "created_at");

CREATE INDEX "approval_instance_attachments_element_id_idx"
ON "approval_instance_attachments"("element_id");

CREATE INDEX "approval_instance_attachments_attachment_id_idx"
ON "approval_instance_attachments"("attachment_id");

ALTER TABLE "approval_instance_attachments"
ADD CONSTRAINT "approval_instance_attachments_instance_id_fkey"
FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "approval_instance_attachments"
ADD CONSTRAINT "approval_instance_attachments_attachment_id_fkey"
FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
