-- W2.5 process settings foundation: versioned flow graph and Cordys form types.

CREATE TYPE "ApprovalFormType" AS ENUM (
    'QUOTATION',
    'CONTRACT',
    'INVOICE',
    'ORDER',
    'RECEIVABLE_RECORD_LEGACY'
);

CREATE TYPE "ApprovalExecuteTiming" AS ENUM ('CREATE', 'UPDATE', 'DELETE');
CREATE TYPE "ApprovalNodeType" AS ENUM ('START', 'APPROVER', 'CONDITION', 'DEFAULT', 'END');
CREATE TYPE "DuplicateApproverRule" AS ENUM ('FIRST_ONLY', 'SEQUENTIAL_ALL', 'EACH');

ALTER TABLE "approval_flows"
    ADD COLUMN "number" TEXT,
    ADD COLUMN "formType" "ApprovalFormType",
    ADD COLUMN "currentVersionId" TEXT,
    ADD COLUMN "createExecute" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "updateExecute" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "deleteExecute" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "submitterCanRevoke" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "allowBatchProcess" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "allowWithdraw" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "allowAddSign" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "duplicateApproverRule" "DuplicateApproverRule" NOT NULL DEFAULT 'FIRST_ONLY',
    ADD COLUMN "requireComment" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "description" VARCHAR(1000),
    ADD COLUMN "deletedAt" TIMESTAMP(3),
    ADD COLUMN "createdById" TEXT,
    ADD COLUMN "updatedById" TEXT;

WITH numbered AS (
    SELECT
        "id",
        CASE "module"
            WHEN 'quote' THEN 'QTE-APV'
            WHEN 'contract' THEN 'CTR-APV'
            WHEN 'invoice' THEN 'INV-APV'
            WHEN 'order' THEN 'ORD-APV'
            ELSE 'RCV-LEG'
        END AS prefix,
        ROW_NUMBER() OVER (PARTITION BY "tenantId", "module" ORDER BY "createdAt", "id") AS seq
    FROM "approval_flows"
)
UPDATE "approval_flows" AS flow
SET
    "number" = numbered.prefix || '-' || LPAD(numbered.seq::TEXT, 5, '0'),
    "formType" = CASE flow."module"
        WHEN 'quote' THEN 'QUOTATION'::"ApprovalFormType"
        WHEN 'contract' THEN 'CONTRACT'::"ApprovalFormType"
        WHEN 'invoice' THEN 'INVOICE'::"ApprovalFormType"
        WHEN 'order' THEN 'ORDER'::"ApprovalFormType"
        ELSE 'RECEIVABLE_RECORD_LEGACY'::"ApprovalFormType"
    END
FROM numbered
WHERE flow."id" = numbered."id";

UPDATE "approval_flows"
SET "enabled" = false, "deletedAt" = COALESCE("deletedAt", CURRENT_TIMESTAMP)
WHERE "formType" = 'RECEIVABLE_RECORD_LEGACY';

ALTER TABLE "approval_flows"
    ALTER COLUMN "number" SET NOT NULL,
    ALTER COLUMN "formType" SET NOT NULL;

DROP INDEX "approval_flows_tenantId_module_key";

CREATE UNIQUE INDEX "approval_flows_tenantId_number_key"
ON "approval_flows"("tenantId", "number");

CREATE UNIQUE INDEX "approval_flows_active_form_type_key"
ON "approval_flows"("tenantId", "formType")
WHERE "deletedAt" IS NULL;

CREATE INDEX "approval_flows_tenantId_formType_deletedAt_idx"
ON "approval_flows"("tenantId", "formType", "deletedAt");

CREATE INDEX "approval_flows_tenantId_enabled_deletedAt_idx"
ON "approval_flows"("tenantId", "enabled", "deletedAt");

CREATE TABLE "approval_flow_number_counters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formType" "ApprovalFormType" NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "approval_flow_number_counters_pkey" PRIMARY KEY ("id")
);

INSERT INTO "approval_flow_number_counters" ("id", "tenantId", "formType", "nextValue", "updatedAt")
SELECT
    'w25_counter_' || MD5("tenantId" || ':' || "formType"::TEXT),
    "tenantId",
    "formType",
    COUNT(*)::INTEGER + 1,
    CURRENT_TIMESTAMP
FROM "approval_flows"
GROUP BY "tenantId", "formType";

CREATE UNIQUE INDEX "approval_flow_number_counters_tenantId_formType_key"
ON "approval_flow_number_counters"("tenantId", "formType");

CREATE TABLE "approval_flow_versions" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_flow_versions_pkey" PRIMARY KEY ("id")
);

INSERT INTO "approval_flow_versions" ("id", "flowId", "tenantId", "version", "createdById", "createdAt")
SELECT 'w25_v1_' || MD5("id"), "id", "tenantId", 1, "createdById", "createdAt"
FROM "approval_flows";

UPDATE "approval_flows" AS flow
SET "currentVersionId" = version."id"
FROM "approval_flow_versions" AS version
WHERE version."flowId" = flow."id" AND version."version" = 1;

CREATE UNIQUE INDEX "approval_flow_versions_flowId_version_key"
ON "approval_flow_versions"("flowId", "version");

CREATE INDEX "approval_flow_versions_tenantId_flowId_idx"
ON "approval_flow_versions"("tenantId", "flowId");

ALTER TABLE "approval_nodes"
    ADD COLUMN "flowVersionId" TEXT,
    ADD COLUMN "number" TEXT,
    ADD COLUMN "nodeType" "ApprovalNodeType",
    ADD COLUMN "executeTiming" "ApprovalExecuteTiming" NOT NULL DEFAULT 'CREATE';

UPDATE "approval_nodes" AS node
SET
    "flowVersionId" = version."id",
    "number" = 'PN' || LPAD((node."sort" + 2)::TEXT, 3, '0'),
    "nodeType" = 'APPROVER',
    "sort" = node."sort" + 1
FROM "approval_flow_versions" AS version
WHERE version."flowId" = node."flowId" AND version."version" = 1;

CREATE TABLE "approval_node_approvers" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "approverType" "ApproverType" NOT NULL,
    "approverIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mode" "ApprovalMode" NOT NULL DEFAULT 'ANY',
    CONSTRAINT "approval_node_approvers_pkey" PRIMARY KEY ("id")
);

INSERT INTO "approval_node_approvers" ("id", "nodeId", "approverType", "approverIds", "mode")
SELECT 'w25_approver_' || MD5("id"), "id", "approverType", "approverIds", "mode"
FROM "approval_nodes";

INSERT INTO "approval_nodes" (
    "id", "flowId", "flowVersionId", "number", "name", "nodeType", "executeTiming", "sort",
    "approverType", "approverIds", "mode"
)
SELECT
    'w25_start_' || MD5(version."id"),
    version."flowId",
    version."id",
    'PN001',
    '开始',
    'START',
    'CREATE',
    0,
    'DIRECT_LEADER',
    ARRAY[]::TEXT[],
    'ANY'
FROM "approval_flow_versions" AS version;

INSERT INTO "approval_nodes" (
    "id", "flowId", "flowVersionId", "number", "name", "nodeType", "executeTiming", "sort",
    "approverType", "approverIds", "mode"
)
SELECT
    'w25_end_' || MD5(version."id"),
    version."flowId",
    version."id",
    'PN999',
    '结束',
    'END',
    'CREATE',
    COALESCE(MAX(node."sort"), 0) + 1,
    'DIRECT_LEADER',
    ARRAY[]::TEXT[],
    'ANY'
FROM "approval_flow_versions" AS version
LEFT JOIN "approval_nodes" AS node
    ON node."flowVersionId" = version."id" AND node."nodeType" = 'APPROVER'
GROUP BY version."id", version."flowId";

CREATE TABLE "approval_node_links" (
    "id" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "approval_node_links_pkey" PRIMARY KEY ("id")
);

WITH ordered AS (
    SELECT
        "id",
        "flowVersionId",
        "sort",
        LAG("id") OVER (
            PARTITION BY "flowVersionId", "executeTiming"
            ORDER BY "sort", "id"
        ) AS previous_id
    FROM "approval_nodes"
)
INSERT INTO "approval_node_links" ("id", "flowVersionId", "fromNodeId", "toNodeId", "sort")
SELECT
    'w25_link_' || MD5(previous_id || ':' || "id"),
    "flowVersionId",
    previous_id,
    "id",
    "sort" - 1
FROM ordered
WHERE previous_id IS NOT NULL;

ALTER TABLE "approval_nodes" DROP CONSTRAINT "approval_nodes_flowId_fkey";
DROP INDEX "approval_nodes_flowId_idx";

ALTER TABLE "approval_nodes"
    DROP COLUMN "flowId",
    DROP COLUMN "approverType",
    DROP COLUMN "approverIds",
    DROP COLUMN "mode",
    ALTER COLUMN "flowVersionId" SET NOT NULL,
    ALTER COLUMN "number" SET NOT NULL,
    ALTER COLUMN "nodeType" SET NOT NULL;

CREATE UNIQUE INDEX "approval_nodes_flowVersionId_number_key"
ON "approval_nodes"("flowVersionId", "number");

CREATE INDEX "approval_nodes_flowVersionId_executeTiming_sort_idx"
ON "approval_nodes"("flowVersionId", "executeTiming", "sort");

CREATE UNIQUE INDEX "approval_node_approvers_nodeId_key"
ON "approval_node_approvers"("nodeId");

CREATE UNIQUE INDEX "approval_node_links_flowVersionId_fromNodeId_toNodeId_key"
ON "approval_node_links"("flowVersionId", "fromNodeId", "toNodeId");

CREATE INDEX "approval_node_links_flowVersionId_sort_idx"
ON "approval_node_links"("flowVersionId", "sort");

CREATE INDEX "approval_node_links_fromNodeId_idx" ON "approval_node_links"("fromNodeId");
CREATE INDEX "approval_node_links_toNodeId_idx" ON "approval_node_links"("toNodeId");

ALTER TABLE "approval_instances"
    ADD COLUMN "flowId" TEXT,
    ADD COLUMN "flowVersionId" TEXT,
    ADD COLUMN "executeTiming" "ApprovalExecuteTiming" NOT NULL DEFAULT 'CREATE';

UPDATE "approval_instances" AS instance
SET
    "flowId" = flow."id",
    "flowVersionId" = flow."currentVersionId"
FROM "approval_flows" AS flow
WHERE flow."tenantId" = instance."tenantId"
  AND flow."formType" = CASE instance."module"
      WHEN 'quote' THEN 'QUOTATION'::"ApprovalFormType"
      WHEN 'contract' THEN 'CONTRACT'::"ApprovalFormType"
      WHEN 'invoice' THEN 'INVOICE'::"ApprovalFormType"
      WHEN 'order' THEN 'ORDER'::"ApprovalFormType"
      ELSE 'RECEIVABLE_RECORD_LEGACY'::"ApprovalFormType"
  END;

CREATE INDEX "approval_instances_flowId_status_idx"
ON "approval_instances"("flowId", "status");

CREATE INDEX "approval_instances_flowVersionId_idx"
ON "approval_instances"("flowVersionId");

ALTER TABLE "approval_flow_versions"
ADD CONSTRAINT "approval_flow_versions_flowId_fkey"
FOREIGN KEY ("flowId") REFERENCES "approval_flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_flows"
ADD CONSTRAINT "approval_flows_currentVersionId_fkey"
FOREIGN KEY ("currentVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "approval_nodes"
ADD CONSTRAINT "approval_nodes_flowVersionId_fkey"
FOREIGN KEY ("flowVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_node_approvers"
ADD CONSTRAINT "approval_node_approvers_nodeId_fkey"
FOREIGN KEY ("nodeId") REFERENCES "approval_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_node_links"
ADD CONSTRAINT "approval_node_links_flowVersionId_fkey"
FOREIGN KEY ("flowVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_node_links"
ADD CONSTRAINT "approval_node_links_fromNodeId_fkey"
FOREIGN KEY ("fromNodeId") REFERENCES "approval_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_node_links"
ADD CONSTRAINT "approval_node_links_toNodeId_fkey"
FOREIGN KEY ("toNodeId") REFERENCES "approval_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_instances"
ADD CONSTRAINT "approval_instances_flowId_fkey"
FOREIGN KEY ("flowId") REFERENCES "approval_flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "approval_instances"
ADD CONSTRAINT "approval_instances_flowVersionId_fkey"
FOREIGN KEY ("flowVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "roles"
SET "permissions" = ARRAY(
    SELECT DISTINCT permission
    FROM UNNEST(
        "permissions" || ARRAY[
            'system:process',
            'system:process:add',
            'system:process:update',
            'system:process:delete'
        ]::TEXT[]
    ) AS permission
)
WHERE 'approval:flowManage' = ANY("permissions");

ALTER TABLE "approval_flows" DROP COLUMN "module";
