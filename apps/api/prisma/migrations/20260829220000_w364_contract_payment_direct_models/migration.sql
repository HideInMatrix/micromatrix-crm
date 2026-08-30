-- W3.6.4: introduce Cordys direct payment-plan/payment-record tables.
-- Legacy receivable_* tables are retained temporarily as a read-only upgrade
-- source. Runtime callers move to the direct tables and never dual-write.

CREATE TABLE "contract_payment_plan" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "contract_id" VARCHAR(32) NOT NULL,
    "owner" VARCHAR(32) NOT NULL,
    "plan_status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "plan_amount" DECIMAL(20,10),
    "plan_end_time" BIGINT,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    CONSTRAINT "contract_payment_plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_payment_plan_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,
    CONSTRAINT "contract_payment_plan_field_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_payment_plan_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,
    CONSTRAINT "contract_payment_plan_field_blob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_payment_record" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "no" VARCHAR(50),
    "owner" VARCHAR(32) NOT NULL,
    "contract_id" VARCHAR(32) NOT NULL,
    "payment_plan_id" VARCHAR(32),
    "record_amount" DECIMAL(20,10),
    "record_end_time" BIGINT,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    CONSTRAINT "contract_payment_record_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_payment_record_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,
    CONSTRAINT "contract_payment_record_field_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_payment_record_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,
    CONSTRAINT "contract_payment_record_field_blob_pkey" PRIMARY KEY ("id")
);

INSERT INTO "contract_payment_plan" (
  "id", "name", "contract_id", "owner", "plan_status", "plan_amount",
  "plan_end_time", "organization_id", "create_time", "update_time",
  "create_user", "update_user"
)
SELECT
  p."id",
  '第 ' || p."period"::text || ' 期回款计划',
  p."contractId",
  COALESCE(c."owner", u."id", 'system'),
  CASE
    WHEN COALESCE(paid.amount, 0) >= p."amount" AND p."amount" > 0 THEN 'COMPLETED'
    WHEN COALESCE(paid.amount, 0) > 0 THEN 'PARTIALLY_COMPLETED'
    ELSE 'PENDING'
  END,
  p."amount"::DECIMAL(20,10),
  (EXTRACT(EPOCH FROM p."dueDate") * 1000)::BIGINT,
  p."tenantId",
  (EXTRACT(EPOCH FROM p."createdAt") * 1000)::BIGINT,
  (EXTRACT(EPOCH FROM p."updatedAt") * 1000)::BIGINT,
  COALESCE(c."owner", u."id", 'system'),
  COALESCE(c."owner", u."id", 'system')
FROM "receivable_plans" p
JOIN "contract" c ON c."id" = p."contractId"
LEFT JOIN LATERAL (
  SELECT SUM(r."amount") AS amount
  FROM "receivable_records" r
  WHERE r."planId" = p."id" AND r."approvalStatus" IN ('NONE', 'APPROVED')
) paid ON true
LEFT JOIN LATERAL (
  SELECT usr."id" FROM "users" usr
  WHERE usr."tenantId" = p."tenantId"
  ORDER BY usr."createdAt" ASC LIMIT 1
) u ON true;

WITH migrated AS (
  SELECT
    r.*,
    COALESCE(r."ownerId", c."owner", u."id", 'system') AS resolved_owner,
    ROW_NUMBER() OVER (
      PARTITION BY r."tenantId", TO_CHAR(r."receivedAt", 'YYYYMM')
      ORDER BY r."receivedAt" ASC, r."id" ASC
    ) AS serial_no
  FROM "receivable_records" r
  JOIN "contract" c ON c."id" = r."contractId"
  LEFT JOIN LATERAL (
    SELECT usr."id" FROM "users" usr
    WHERE usr."tenantId" = r."tenantId"
    ORDER BY usr."createdAt" ASC LIMIT 1
  ) u ON true
  WHERE r."approvalStatus" IN ('NONE', 'APPROVED')
)
INSERT INTO "contract_payment_record" (
  "id", "name", "no", "owner", "contract_id", "payment_plan_id",
  "record_amount", "record_end_time", "organization_id", "create_time",
  "update_time", "create_user", "update_user"
)
SELECT
  m."id",
  '回款记录 ' || TO_CHAR(m."receivedAt", 'YYYY-MM-DD'),
  'PAY-' || TO_CHAR(m."receivedAt", 'YYYYMM') || '-' || LPAD(m.serial_no::text, 6, '0'),
  m.resolved_owner,
  m."contractId",
  m."planId",
  m."amount"::DECIMAL(20,10),
  (EXTRACT(EPOCH FROM m."receivedAt") * 1000)::BIGINT,
  m."tenantId",
  (EXTRACT(EPOCH FROM m."createdAt") * 1000)::BIGINT,
  (EXTRACT(EPOCH FROM m."createdAt") * 1000)::BIGINT,
  m.resolved_owner,
  m.resolved_owner
FROM migrated m;

CREATE UNIQUE INDEX "contract_payment_plan_field_resource_id_field_id_key" ON "contract_payment_plan_field"("resource_id", "field_id");
CREATE INDEX "contract_payment_plan_field_resource_id_field_id_field_value_idx" ON "contract_payment_plan_field"("resource_id", "field_id", "field_value");
CREATE UNIQUE INDEX "contract_payment_plan_field_blob_resource_id_field_id_key" ON "contract_payment_plan_field_blob"("resource_id", "field_id");
CREATE INDEX "contract_payment_plan_field_blob_resource_id_idx" ON "contract_payment_plan_field_blob"("resource_id");
CREATE INDEX "contract_payment_plan_contract_id_idx" ON "contract_payment_plan"("contract_id");
CREATE INDEX "contract_payment_plan_owner_idx" ON "contract_payment_plan"("owner");
CREATE INDEX "contract_payment_plan_organization_id_idx" ON "contract_payment_plan"("organization_id");
CREATE INDEX "contract_payment_plan_plan_end_time_idx" ON "contract_payment_plan"("plan_end_time");
CREATE INDEX "contract_payment_plan_create_user_idx" ON "contract_payment_plan"("create_user");

CREATE UNIQUE INDEX "contract_payment_record_field_resource_id_field_id_key" ON "contract_payment_record_field"("resource_id", "field_id");
CREATE INDEX "contract_payment_record_field_resource_id_field_id_field_value_idx" ON "contract_payment_record_field"("resource_id", "field_id", "field_value");
CREATE UNIQUE INDEX "contract_payment_record_field_blob_resource_id_field_id_key" ON "contract_payment_record_field_blob"("resource_id", "field_id");
CREATE INDEX "contract_payment_record_field_blob_resource_id_idx" ON "contract_payment_record_field_blob"("resource_id");
CREATE INDEX "contract_payment_record_contract_id_idx" ON "contract_payment_record"("contract_id");
CREATE INDEX "contract_payment_record_payment_plan_id_idx" ON "contract_payment_record"("payment_plan_id");
CREATE INDEX "contract_payment_record_owner_idx" ON "contract_payment_record"("owner");
CREATE INDEX "contract_payment_record_organization_id_idx" ON "contract_payment_record"("organization_id");
CREATE INDEX "contract_payment_record_create_user_idx" ON "contract_payment_record"("create_user");

ALTER TABLE "contract_payment_plan"
  ADD CONSTRAINT "contract_payment_plan_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_payment_plan_field"
  ADD CONSTRAINT "contract_payment_plan_field_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "contract_payment_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_payment_plan_field_blob"
  ADD CONSTRAINT "contract_payment_plan_field_blob_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "contract_payment_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_payment_record"
  ADD CONSTRAINT "contract_payment_record_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_payment_record"
  ADD CONSTRAINT "contract_payment_record_payment_plan_id_fkey"
  FOREIGN KEY ("payment_plan_id") REFERENCES "contract_payment_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contract_payment_record_field"
  ADD CONSTRAINT "contract_payment_record_field_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "contract_payment_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_payment_record_field_blob"
  ADD CONSTRAINT "contract_payment_record_field_blob_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "contract_payment_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

