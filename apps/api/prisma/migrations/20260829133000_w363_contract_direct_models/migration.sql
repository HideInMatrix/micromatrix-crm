-- W3.6.3: replace the legacy MicroMatrix `contracts` / `contract_items`
-- truth source with Cordys `contract` direct tables. Existing contract ids are
-- preserved so payment/invoice/order foreign keys continue to reference the
-- same business resource after the table rename.

CREATE TABLE "contract_stage_config" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "afoot_roll_back" BOOLEAN NOT NULL DEFAULT true,
    "end_roll_back" BOOLEAN NOT NULL DEFAULT false,
    "pos" BIGINT NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "circulation_type" VARCHAR(50) NOT NULL DEFAULT 'NORMAL',
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    CONSTRAINT "contract_stage_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stage_advanced_config" (
    "id" VARCHAR(32) NOT NULL,
    "origin_id" VARCHAR(32) NOT NULL,
    "target_id" VARCHAR(32) NOT NULL,
    "enable" BOOLEAN NOT NULL DEFAULT false,
    "field_config" TEXT,
    "module_type" VARCHAR(20) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    CONSTRAINT "stage_advanced_config_pkey" PRIMARY KEY ("id")
);

-- Cordys default contract flow. Stage ids are organization-scoped deterministic
-- ids because MicroMatrix supports multiple organizations in one database.
WITH organizations AS (
  SELECT DISTINCT "tenantId" AS id FROM "contracts"
  UNION
  SELECT DISTINCT "organization_id" AS id FROM "sys_module_form" WHERE "form_key" = 'contract'
), defaults(code, name, type, pos) AS (
  VALUES
    ('PENDING_SIGNING', '待签署', 'AFOOT', 1::bigint),
    ('SIGNED', '已签署', 'AFOOT', 2::bigint),
    ('CHANGE', '合同变更', 'AFOOT', 3::bigint),
    ('IN_PROGRESS', '履行中', 'AFOOT', 4::bigint),
    ('COMPLETED_PERFORMANCE', '履行完毕', 'AFOOT', 5::bigint),
    ('ARCHIVED', '合同完结', 'END', 6::bigint),
    ('VOID', '作废', 'END', 7::bigint)
)
INSERT INTO "contract_stage_config" (
  "id", "name", "type", "afoot_roll_back", "end_roll_back", "pos",
  "organization_id", "circulation_type", "create_time", "update_time",
  "create_user", "update_user"
)
SELECT
  md5(org.id || ':contract-stage:' || d.code),
  d.name,
  d.type,
  true,
  false,
  d.pos,
  org.id,
  'NORMAL',
  (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT,
  (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT,
  COALESCE((SELECT u."id" FROM "users" u WHERE u."tenantId" = org.id ORDER BY u."createdAt" ASC LIMIT 1), 'system'),
  COALESCE((SELECT u."id" FROM "users" u WHERE u."tenantId" = org.id ORDER BY u."createdAt" ASC LIMIT 1), 'system')
FROM organizations org
CROSS JOIN defaults d;

ALTER TABLE "contracts" RENAME TO "contract";

DROP INDEX IF EXISTS "contracts_tenantId_code_key";
DROP INDEX IF EXISTS "contracts_tenantId_customerId_idx";
DROP INDEX IF EXISTS "contracts_tenantId_deptId_idx";

ALTER TABLE "contract" RENAME COLUMN "tenantId" TO "organization_id";
ALTER TABLE "contract" RENAME COLUMN "code" TO "number";
ALTER TABLE "contract" RENAME COLUMN "ownerId" TO "owner";
ALTER TABLE "contract" RENAME COLUMN "approvalStatus" TO "approval_status";

ALTER TABLE "contract"
  ADD COLUMN "stage_new" VARCHAR(32),
  ADD COLUMN "start_time" BIGINT,
  ADD COLUMN "end_time" BIGINT,
  ADD COLUMN "void_reason" VARCHAR(255),
  ADD COLUMN "pos" BIGINT,
  ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "create_time" BIGINT,
  ADD COLUMN "update_time" BIGINT,
  ADD COLUMN "create_user" VARCHAR(32),
  ADD COLUMN "update_user" VARCHAR(32);

UPDATE "contract" c
SET
  "owner" = COALESCE(
    c."owner",
    (SELECT u."id" FROM "users" u WHERE u."tenantId" = c."organization_id" ORDER BY u."createdAt" ASC LIMIT 1),
    'system'
  ),
  "stage_new" = md5(c."organization_id" || ':contract-stage:' || CASE c."status"::text
    WHEN 'EXECUTING' THEN 'IN_PROGRESS'
    WHEN 'COMPLETED' THEN 'COMPLETED_PERFORMANCE'
    WHEN 'TERMINATED' THEN 'VOID'
    ELSE 'PENDING_SIGNING'
  END),
  "start_time" = CASE WHEN c."startAt" IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM c."startAt") * 1000)::BIGINT END,
  "end_time" = CASE WHEN c."endAt" IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM c."endAt") * 1000)::BIGINT END,
  "approved" = c."approval_status" = 'APPROVED',
  "create_time" = (EXTRACT(EPOCH FROM c."createdAt") * 1000)::BIGINT,
  "update_time" = (EXTRACT(EPOCH FROM c."updatedAt") * 1000)::BIGINT,
  "create_user" = COALESCE(
    c."owner",
    (SELECT u."id" FROM "users" u WHERE u."tenantId" = c."organization_id" ORDER BY u."createdAt" ASC LIMIT 1),
    'system'
  ),
  "update_user" = COALESCE(
    c."owner",
    (SELECT u."id" FROM "users" u WHERE u."tenantId" = c."organization_id" ORDER BY u."createdAt" ASC LIMIT 1),
    'system'
  );

UPDATE "contract"
SET "approval_status" = CASE "approval_status"
  WHEN 'PENDING' THEN 'APPROVING'
  WHEN 'REJECTED' THEN 'UNAPPROVED'
  ELSE "approval_status"
END;

ALTER TABLE "contract"
  ALTER COLUMN "id" TYPE VARCHAR(32),
  ALTER COLUMN "name" TYPE VARCHAR(255),
  ALTER COLUMN "customerId" TYPE VARCHAR(32),
  ALTER COLUMN "owner" TYPE VARCHAR(32),
  ALTER COLUMN "owner" SET NOT NULL,
  ALTER COLUMN "number" TYPE VARCHAR(50),
  ALTER COLUMN "approval_status" TYPE VARCHAR(50),
  ALTER COLUMN "organization_id" TYPE VARCHAR(32),
  ALTER COLUMN "stage_new" SET NOT NULL,
  ALTER COLUMN "create_time" SET NOT NULL,
  ALTER COLUMN "update_time" SET NOT NULL,
  ALTER COLUMN "create_user" SET NOT NULL,
  ALTER COLUMN "update_user" SET NOT NULL;

ALTER TABLE "contract" RENAME COLUMN "customerId" TO "customer_id";

CREATE TABLE "contract_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,
    "ref_sub_id" VARCHAR(32),
    "row_id" VARCHAR(32),
    "biz_id" VARCHAR(32),
    CONSTRAINT "contract_field_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,
    "ref_sub_id" VARCHAR(32),
    "row_id" VARCHAR(32),
    "biz_id" VARCHAR(32),
    CONSTRAINT "contract_field_blob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_snapshot" (
    "id" VARCHAR(32) NOT NULL,
    "contract_id" VARCHAR(32) NOT NULL,
    "contract_prop" TEXT,
    "contract_value" TEXT,
    CONSTRAINT "contract_snapshot_pkey" PRIMARY KEY ("id")
);

-- Normalize legacy contract form system fields and create the Cordys products
-- sub-table fields. User-created fields remain untouched.
DELETE FROM "sys_module_field" field
USING "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'contract'
  AND field."internal_key" IN ('status', 'signedAt', 'remark', 'deptId', 'opportunityId', 'quoteId');

UPDATE "sys_module_field" field
SET "internal_key" = 'owner', "name" = '负责人', "type" = 'member'
FROM "sys_module_form" form
WHERE field."form_id" = form."id" AND form."form_key" = 'contract' AND field."internal_key" = 'ownerId';

UPDATE "sys_module_field" field
SET "internal_key" = 'number', "name" = '合同编号', "type" = 'text'
FROM "sys_module_form" form
WHERE field."form_id" = form."id" AND form."form_key" = 'contract' AND field."internal_key" = 'code';

UPDATE "sys_module_field" field
SET "internal_key" = 'startTime', "name" = '合同开始时间', "type" = 'date'
FROM "sys_module_form" form
WHERE field."form_id" = form."id" AND form."form_key" = 'contract' AND field."internal_key" = 'startAt';

UPDATE "sys_module_field" field
SET "internal_key" = 'endTime', "name" = '合同结束时间', "type" = 'date'
FROM "sys_module_form" form
WHERE field."form_id" = form."id" AND form."form_key" = 'contract' AND field."internal_key" = 'endAt';

WITH templates(internal_key, name, type, pos, prop) AS (
  VALUES
    ('name', '合同名称', 'text', 0::bigint, '{"key":"name","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":200}'::text),
    ('customerId', '客户', 'text', 1::bigint, '{"key":"customerId","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":180}'::text),
    ('owner', '负责人', 'member', 2::bigint, '{"key":"owner","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":140}'::text),
    ('amount', '合同金额', 'currency', 3::bigint, '{"key":"amount","required":false,"system":true,"hidden":false,"options":null,"config":{"precision":2},"span":12,"showInList":true,"listWidth":120}'::text),
    ('number', '合同编号', 'text', 4::bigint, '{"key":"number","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":160}'::text),
    ('startTime', '合同开始时间', 'date', 5::bigint, '{"key":"startTime","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":120}'::text),
    ('endTime', '合同结束时间', 'date', 6::bigint, '{"key":"endTime","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":120}'::text),
    ('products', '产品信息', 'textarea', 7::bigint, '{"key":"products","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":24,"showInList":false,"listWidth":null}'::text),
    ('product', '产品', 'text', 8::bigint, '{"key":"product","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('productAmount', '产品单价', 'currency', 9::bigint, '{"key":"productAmount","required":true,"system":true,"hidden":true,"options":null,"config":{"precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('productNumber', '数量', 'number', 10::bigint, '{"key":"productNumber","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('sumAmount', '金额', 'formula', 11::bigint, '{"key":"sumAmount","required":false,"system":true,"hidden":true,"options":null,"config":{"formula":"productAmount * productNumber","precision":2},"span":12,"showInList":false,"listWidth":null}'::text)
)
INSERT INTO "sys_module_field" (
  "id", "form_id", "internal_key", "name", "type", "mobile", "pos",
  "create_user", "create_time", "update_user", "update_time"
)
SELECT
  md5(form."id" || ':contract:' || t.internal_key), form."id", t.internal_key,
  t.name, t.type, true, t.pos, form."create_user", form."create_time",
  form."update_user", (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
FROM "sys_module_form" form
CROSS JOIN templates t
WHERE form."form_key" = 'contract'
  AND NOT EXISTS (
    SELECT 1 FROM "sys_module_field" existing
    WHERE existing."form_id" = form."id" AND existing."internal_key" = t.internal_key
  );

WITH templates(internal_key, prop) AS (
  VALUES
    ('name', '{"key":"name","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":200}'::text),
    ('customerId', '{"key":"customerId","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":180}'::text),
    ('owner', '{"key":"owner","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":140}'::text),
    ('amount', '{"key":"amount","required":false,"system":true,"hidden":false,"options":null,"config":{"precision":2},"span":12,"showInList":true,"listWidth":120}'::text),
    ('number', '{"key":"number","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":160}'::text),
    ('startTime', '{"key":"startTime","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":120}'::text),
    ('endTime', '{"key":"endTime","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":120}'::text),
    ('products', '{"key":"products","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":24,"showInList":false,"listWidth":null}'::text),
    ('product', '{"key":"product","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('productAmount', '{"key":"productAmount","required":true,"system":true,"hidden":true,"options":null,"config":{"precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('productNumber', '{"key":"productNumber","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('sumAmount', '{"key":"sumAmount","required":false,"system":true,"hidden":true,"options":null,"config":{"formula":"productAmount * productNumber","precision":2},"span":12,"showInList":false,"listWidth":null}'::text)
)
INSERT INTO "sys_module_field_blob" ("id", "prop")
SELECT field."id", t.prop
FROM "sys_module_form" form
JOIN "sys_module_field" field ON field."form_id" = form."id"
JOIN templates t ON t.internal_key = field."internal_key"
WHERE form."form_key" = 'contract'
ON CONFLICT ("id") DO UPDATE SET "prop" = EXCLUDED."prop";

-- Preserve legacy user-defined contract customData in direct Field/Blob rows.
INSERT INTO "contract_field" ("id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id")
SELECT
  md5('contract:' || c."id" || ':' || f."id"), c."id", f."id",
  LEFT(c."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key"), 255),
  NULL, NULL, NULL
FROM "contract" c
JOIN "sys_module_form" form ON form."organization_id" = c."organization_id" AND form."form_key" = 'contract'
JOIN "sys_module_field" f ON f."form_id" = form."id"
LEFT JOIN "sys_module_field_blob" fb ON fb."id" = f."id"
WHERE c."customData" IS NOT NULL
  AND COALESCE((fb."prop"::jsonb ->> 'system')::boolean, false) = false
  AND COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND c."customData" ? COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")
  AND c."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND f."type" NOT IN ('textarea', 'multiselect', 'checkbox', 'picture')
  AND length(c."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")) <= 255;

INSERT INTO "contract_field_blob" ("id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id")
SELECT
  md5('contract-blob:' || c."id" || ':' || f."id"), c."id", f."id",
  c."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key"),
  NULL, NULL, NULL
FROM "contract" c
JOIN "sys_module_form" form ON form."organization_id" = c."organization_id" AND form."form_key" = 'contract'
JOIN "sys_module_field" f ON f."form_id" = form."id"
LEFT JOIN "sys_module_field_blob" fb ON fb."id" = f."id"
WHERE c."customData" IS NOT NULL
  AND COALESCE((fb."prop"::jsonb ->> 'system')::boolean, false) = false
  AND COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND c."customData" ? COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")
  AND c."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND (f."type" IN ('textarea', 'multiselect', 'checkbox', 'picture')
       OR length(c."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")) > 255);

-- Convert legacy ContractItem rows to the Cordys products sub-table. Rows
-- without a valid direct Product cannot satisfy the target reference and are
-- intentionally not fabricated.
INSERT INTO "contract_field" ("id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id")
SELECT md5('contract-product:' || i."id"), i."contractId", product_field."id", i."productId",
       parent."id", md5('contract-row:' || i."id"), md5('contract-biz:' || i."id")
FROM "contract_items" i
JOIN "contract" c ON c."id" = i."contractId"
JOIN "product" p ON p."id" = i."productId" AND p."organization_id" = c."organization_id"
JOIN "sys_module_form" form ON form."organization_id" = c."organization_id" AND form."form_key" = 'contract'
JOIN "sys_module_field" parent ON parent."form_id" = form."id" AND parent."internal_key" = 'products'
JOIN "sys_module_field" product_field ON product_field."form_id" = form."id" AND product_field."internal_key" = 'product'
WHERE i."productId" IS NOT NULL;

INSERT INTO "contract_field" ("id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id")
SELECT md5('contract-product-amount:' || i."id"), i."contractId", field."id", i."unitPrice"::text,
       parent."id", md5('contract-row:' || i."id"), md5('contract-biz:' || i."id")
FROM "contract_items" i
JOIN "contract" c ON c."id" = i."contractId"
JOIN "sys_module_form" form ON form."organization_id" = c."organization_id" AND form."form_key" = 'contract'
JOIN "sys_module_field" parent ON parent."form_id" = form."id" AND parent."internal_key" = 'products'
JOIN "sys_module_field" field ON field."form_id" = form."id" AND field."internal_key" = 'productAmount';

INSERT INTO "contract_field" ("id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id")
SELECT md5('contract-product-number:' || i."id"), i."contractId", field."id", i."quantity"::text,
       parent."id", md5('contract-row:' || i."id"), md5('contract-biz:' || i."id")
FROM "contract_items" i
JOIN "contract" c ON c."id" = i."contractId"
JOIN "sys_module_form" form ON form."organization_id" = c."organization_id" AND form."form_key" = 'contract'
JOIN "sys_module_field" parent ON parent."form_id" = form."id" AND parent."internal_key" = 'products'
JOIN "sys_module_field" field ON field."form_id" = form."id" AND field."internal_key" = 'productNumber';

INSERT INTO "contract_field" ("id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id")
SELECT md5('contract-sum-amount:' || i."id"), i."contractId", field."id", i."amount"::text,
       parent."id", md5('contract-row:' || i."id"), md5('contract-biz:' || i."id")
FROM "contract_items" i
JOIN "contract" c ON c."id" = i."contractId"
JOIN "sys_module_form" form ON form."organization_id" = c."organization_id" AND form."form_key" = 'contract'
JOIN "sys_module_field" parent ON parent."form_id" = form."id" AND parent."internal_key" = 'products'
JOIN "sys_module_field" field ON field."form_id" = form."id" AND field."internal_key" = 'sumAmount';

-- One baseline snapshot for migrated rows. Runtime updates replace this with a
-- full module-form snapshot once the contract service is switched to direct mode.
INSERT INTO "contract_snapshot" ("id", "contract_id", "contract_prop", "contract_value")
SELECT
  md5('contract-snapshot:' || c."id"),
  c."id",
  '{}'::text,
  jsonb_build_object(
    'id', c."id", 'name', c."name", 'customerId', c."customer_id",
    'owner', c."owner", 'amount', c."amount", 'number', c."number",
    'approvalStatus', c."approval_status", 'stage', c."stage_new",
    'startTime', c."start_time", 'endTime', c."end_time", 'approved', c."approved",
    'products', '[]'::jsonb, 'moduleFields', '[]'::jsonb
  )::text
FROM "contract" c;

DROP TABLE "contract_items";

ALTER TABLE "contract"
  DROP COLUMN "status",
  DROP COLUMN "signedAt",
  DROP COLUMN "startAt",
  DROP COLUMN "endAt",
  DROP COLUMN "remark",
  DROP COLUMN "deptId",
  DROP COLUMN "customData",
  DROP COLUMN "opportunityId",
  DROP COLUMN "quoteId",
  DROP COLUMN "createdAt",
  DROP COLUMN "updatedAt";

ALTER TABLE "contract" RENAME COLUMN "stage_new" TO "stage";

DROP TYPE IF EXISTS "ContractStatus";

CREATE INDEX "contract_name_idx" ON "contract"("name");
CREATE INDEX "contract_customer_id_idx" ON "contract"("customer_id");
CREATE INDEX "contract_owner_idx" ON "contract"("owner");
CREATE INDEX "contract_number_idx" ON "contract"("number");
CREATE INDEX "contract_organization_id_idx" ON "contract"("organization_id");
CREATE INDEX "contract_approval_status_idx" ON "contract"("approval_status");
CREATE INDEX "contract_stage_idx" ON "contract"("stage");
CREATE INDEX "contract_create_user_idx" ON "contract"("create_user");
CREATE INDEX "contract_stage_config_organization_id_pos_idx" ON "contract_stage_config"("organization_id", "pos");
CREATE UNIQUE INDEX "uk_stage_advanced_transition" ON "stage_advanced_config"("organization_id", "module_type", "origin_id", "target_id");
CREATE INDEX "idx_stage_advanced_type" ON "stage_advanced_config"("module_type");
CREATE INDEX "stage_advanced_config_organization_id_module_type_idx" ON "stage_advanced_config"("organization_id", "module_type");
CREATE UNIQUE INDEX "uk_contract_field_cell" ON "contract_field"("resource_id", "ref_sub_id", "row_id", "field_id");
CREATE INDEX "contract_field_resource_id_idx" ON "contract_field"("resource_id");
CREATE INDEX "contract_field_ref_sub_id_idx" ON "contract_field"("ref_sub_id");
CREATE UNIQUE INDEX "uk_contract_field_blob_cell" ON "contract_field_blob"("resource_id", "ref_sub_id", "row_id", "field_id");
CREATE INDEX "contract_field_blob_resource_id_idx" ON "contract_field_blob"("resource_id");
CREATE INDEX "contract_field_blob_ref_sub_id_idx" ON "contract_field_blob"("ref_sub_id");
CREATE INDEX "contract_snapshot_contract_id_idx" ON "contract_snapshot"("contract_id");

ALTER TABLE "contract_field"
ADD CONSTRAINT "contract_field_resource_id_fkey"
FOREIGN KEY ("resource_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_field_blob"
ADD CONSTRAINT "contract_field_blob_resource_id_fkey"
FOREIGN KEY ("resource_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_snapshot"
ADD CONSTRAINT "contract_snapshot_contract_id_fkey"
FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
