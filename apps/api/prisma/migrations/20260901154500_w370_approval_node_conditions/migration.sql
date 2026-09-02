-- W3.7-9.4A / DB-012: condition node configuration.
CREATE TABLE "approval_node_conditions" (
    "id" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "condition_config" JSONB,
    CONSTRAINT "approval_node_conditions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "approval_node_conditions_flowVersionId_idx"
ON "approval_node_conditions"("flowVersionId");

ALTER TABLE "approval_node_conditions"
ADD CONSTRAINT "approval_node_conditions_id_fkey"
FOREIGN KEY ("id") REFERENCES "approval_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_node_conditions"
ADD CONSTRAINT "approval_node_conditions_flowVersionId_fkey"
FOREIGN KEY ("flowVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
