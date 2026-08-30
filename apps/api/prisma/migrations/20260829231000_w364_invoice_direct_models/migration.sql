-- W3.6.4: introduce Cordys direct invoice/business-title models.
-- Legacy invoice_records/invoice_titles stay temporarily as upgrade sources.

CREATE TABLE "business_title" (
  "id" VARCHAR(32) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "type" VARCHAR(50),
  "identification_number" VARCHAR(255),
  "opening_bank" VARCHAR(255),
  "bank_account" VARCHAR(255),
  "registration_address" VARCHAR(255),
  "phone_number" VARCHAR(255),
  "registered_capital" VARCHAR(255),
  "company_size" VARCHAR(255),
  "registration_number" VARCHAR(255),
  "approval_status" VARCHAR(50),
  "unapproved_reason" VARCHAR(255),
  "organization_id" VARCHAR(50) NOT NULL,
  "province" VARCHAR(255),
  "city" VARCHAR(255),
  "scale" VARCHAR(255),
  "industry" VARCHAR(255),
  "remark" VARCHAR(255),
  "company_number" BIGSERIAL NOT NULL,
  "create_time" BIGINT NOT NULL,
  "update_time" BIGINT NOT NULL,
  "create_user" VARCHAR(32) NOT NULL,
  "update_user" VARCHAR(32) NOT NULL,
  CONSTRAINT "business_title_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_title_config" (
  "id" VARCHAR(32) NOT NULL,
  "field" VARCHAR(255) NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT TRUE,
  "organization_id" VARCHAR(32) NOT NULL,
  CONSTRAINT "business_title_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_invoice" (
  "id" VARCHAR(32) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "contract_id" VARCHAR(32) NOT NULL,
  "owner" VARCHAR(32) NOT NULL,
  "amount" DECIMAL(20,10),
  "invoice_type" VARCHAR(32),
  "tax_rate" DECIMAL(20,10),
  "approval_status" VARCHAR(32),
  "business_title_id" VARCHAR(32),
  "organization_id" VARCHAR(32) NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT FALSE,
  "create_time" BIGINT NOT NULL,
  "update_time" BIGINT NOT NULL,
  "create_user" VARCHAR(32) NOT NULL,
  "update_user" VARCHAR(32) NOT NULL,
  CONSTRAINT "contract_invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_invoice_field" (
  "id" VARCHAR(32) NOT NULL,
  "resource_id" VARCHAR(32) NOT NULL,
  "field_id" VARCHAR(32) NOT NULL,
  "field_value" VARCHAR(255) NOT NULL,
  CONSTRAINT "contract_invoice_field_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_invoice_field_blob" (
  "id" VARCHAR(32) NOT NULL,
  "resource_id" VARCHAR(32) NOT NULL,
  "field_id" VARCHAR(32) NOT NULL,
  "field_value" TEXT NOT NULL,
  CONSTRAINT "contract_invoice_field_blob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_invoice_snapshot" (
  "id" VARCHAR(32) NOT NULL,
  "invoice_id" VARCHAR(32) NOT NULL,
  "invoice_prop" TEXT,
  "invoice_value" TEXT,
  CONSTRAINT "contract_invoice_snapshot_pkey" PRIMARY KEY ("id")
);

INSERT INTO "business_title" (
  "id", "name", "type", "identification_number", "opening_bank",
  "bank_account", "registration_address", "phone_number",
  "registered_capital", "company_size", "registration_number",
  "approval_status", "unapproved_reason", "organization_id",
  "province", "city", "scale", "industry", "remark",
  "create_time", "update_time", "create_user", "update_user"
)
SELECT
  t."id", t."name", 'CUSTOM', NULLIF(t."taxNo", ''), NULLIF(t."bankName", ''),
  NULLIF(t."bankAccount", ''), NULLIF(t."address", ''), NULLIF(t."phone", ''),
  NULL, NULL, NULL, 'APPROVED', NULL, t."tenantId",
  NULL, NULL, NULL, NULL, NULL,
  (EXTRACT(EPOCH FROM t."createdAt") * 1000)::BIGINT,
  (EXTRACT(EPOCH FROM t."updatedAt") * 1000)::BIGINT,
  COALESCE(owner_user."id", first_user."id", 'system'),
  COALESCE(owner_user."id", first_user."id", 'system')
FROM "invoice_titles" t
LEFT JOIN LATERAL (
  SELECT ir."ownerId" AS "id" FROM "invoice_records" ir
  WHERE ir."titleId" = t."id" AND ir."ownerId" IS NOT NULL
  ORDER BY ir."createdAt" ASC, ir."id" ASC LIMIT 1
) owner_user ON true
LEFT JOIN LATERAL (
  SELECT u."id" FROM "users" u WHERE u."tenantId" = t."tenantId"
  ORDER BY u."createdAt" ASC, u."id" ASC LIMIT 1
) first_user ON true;

INSERT INTO "business_title_config" ("id", "field", "required", "organization_id")
SELECT md5(t."id" || ':business-title:' || cfg.field), cfg.field, cfg.required, t."id"
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('name', TRUE), ('identification_number', TRUE),
    ('opening_bank', FALSE), ('bank_account', FALSE),
    ('registration_address', FALSE), ('phone_number', FALSE),
    ('registered_capital', FALSE), ('company_size', FALSE),
    ('registration_number', FALSE), ('province', FALSE),
    ('city', FALSE), ('scale', FALSE), ('industry', FALSE), ('remark', FALSE)
) AS cfg(field, required);

-- Retire legacy InvoiceStatus as a business truth:
-- PENDING -> NONE, ISSUED -> APPROVED, VOID -> REVOKED.
INSERT INTO "contract_invoice" (
  "id", "name", "contract_id", "owner", "amount", "invoice_type",
  "tax_rate", "approval_status", "business_title_id", "organization_id",
  "approved", "create_time", "update_time", "create_user", "update_user"
)
SELECT
  ir."id",
  LEFT(COALESCE(
    NULLIF('发票 ' || ir."invoiceNo", '发票 '),
    NULLIF(bt."name" || ' 发票', ' 发票'),
    NULLIF(c."name" || ' 发票', ' 发票'),
    '迁移发票 ' || ir."id"
  ), 255),
  ir."contractId",
  COALESCE(ir."ownerId", c."owner", first_user."id", 'system'),
  ir."amount"::DECIMAL(20,10), ir."type", 0::DECIMAL(20,10),
  CASE ir."status"::text WHEN 'ISSUED' THEN 'APPROVED' WHEN 'VOID' THEN 'REVOKED' ELSE 'NONE' END,
  ir."titleId", ir."tenantId",
  CASE WHEN ir."status"::text = 'ISSUED' THEN TRUE ELSE FALSE END,
  (EXTRACT(EPOCH FROM ir."createdAt") * 1000)::BIGINT,
  (EXTRACT(EPOCH FROM ir."updatedAt") * 1000)::BIGINT,
  COALESCE(ir."ownerId", c."owner", first_user."id", 'system'),
  COALESCE(ir."ownerId", c."owner", first_user."id", 'system')
FROM "invoice_records" ir
JOIN "contract" c ON c."id" = ir."contractId"
LEFT JOIN "business_title" bt ON bt."id" = ir."titleId"
LEFT JOIN LATERAL (
  SELECT u."id" FROM "users" u WHERE u."tenantId" = ir."tenantId"
  ORDER BY u."createdAt" ASC, u."id" ASC LIMIT 1
) first_user ON true;

INSERT INTO "contract_invoice_snapshot" ("id", "invoice_id", "invoice_prop", "invoice_value")
SELECT
  md5(ir."id" || ':legacy-invoice-snapshot'), ir."id",
  json_build_object('migration', 'legacy_invoice_records', 'schemaVersion', 1)::text,
  json_build_object(
    'legacyStatus', ir."status"::text,
    'invoiceNo', ir."invoiceNo",
    'issuedAt', ir."issuedAt",
    'remark', ir."remark",
    'legacyTitleId', ir."titleId"
  )::text
FROM "invoice_records" ir
JOIN "contract_invoice" ci ON ci."id" = ir."id";

CREATE UNIQUE INDEX "business_title_company_number_key" ON "business_title"("company_number");
CREATE INDEX "business_title_organization_id_idx" ON "business_title"("organization_id");
CREATE INDEX "business_title_name_idx" ON "business_title"("name");
CREATE UNIQUE INDEX "business_title_config_organization_id_field_key" ON "business_title_config"("organization_id", "field");
CREATE INDEX "business_title_config_organization_id_idx" ON "business_title_config"("organization_id");
CREATE INDEX "contract_invoice_contract_id_idx" ON "contract_invoice"("contract_id");
CREATE INDEX "contract_invoice_owner_idx" ON "contract_invoice"("owner");
CREATE INDEX "contract_invoice_organization_id_idx" ON "contract_invoice"("organization_id");
CREATE INDEX "contract_invoice_approval_status_idx" ON "contract_invoice"("approval_status");
CREATE INDEX "contract_invoice_create_user_idx" ON "contract_invoice"("create_user");
CREATE UNIQUE INDEX "contract_invoice_field_resource_id_field_id_key" ON "contract_invoice_field"("resource_id", "field_id");
CREATE INDEX "contract_invoice_field_resource_id_field_id_field_value_idx" ON "contract_invoice_field"("resource_id", "field_id", "field_value");
CREATE UNIQUE INDEX "contract_invoice_field_blob_resource_id_field_id_key" ON "contract_invoice_field_blob"("resource_id", "field_id");
CREATE INDEX "contract_invoice_field_blob_resource_id_idx" ON "contract_invoice_field_blob"("resource_id");
CREATE INDEX "contract_invoice_snapshot_invoice_id_idx" ON "contract_invoice_snapshot"("invoice_id");

ALTER TABLE "contract_invoice" ADD CONSTRAINT "contract_invoice_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_invoice" ADD CONSTRAINT "contract_invoice_business_title_id_fkey"
  FOREIGN KEY ("business_title_id") REFERENCES "business_title"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contract_invoice_field" ADD CONSTRAINT "contract_invoice_field_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "contract_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_invoice_field_blob" ADD CONSTRAINT "contract_invoice_field_blob_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "contract_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_invoice_snapshot" ADD CONSTRAINT "contract_invoice_snapshot_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "contract_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
