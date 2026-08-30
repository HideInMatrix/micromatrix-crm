-- W3.6.5 6.2A: replace the legacy MicroMatrix `orders` model with the
-- Cordys `sales_order` direct model while preserving existing order ids and
-- business references. The order stage is configuration data, not a fixed DB
-- enum. Existing legacy statuses are mapped to the closest Cordys default
-- stage so this migration can safely replay against non-empty databases.

CREATE TABLE "sales_order_stage_config" (
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
    CONSTRAINT "sales_order_stage_config_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sales_order_stage_config_organization_id_pos_idx"
  ON "sales_order_stage_config"("organization_id", "pos");

-- Cordys default order flow. Stage ids are deterministic and organization
-- scoped because MicroMatrix stores all organizations in one database.
WITH organizations AS (
  SELECT DISTINCT "tenantId" AS id FROM "orders"
  UNION
  SELECT DISTINCT "organization_id" AS id FROM "sys_module_form" WHERE "form_key" = 'order'
), defaults(code, name, type, pos) AS (
  VALUES
    ('CREATE', '新建', 'AFOOT', 1::bigint),
    ('PENDING_SHIPMENT', '待发货', 'AFOOT', 2::bigint),
    ('PARTIALLY_SHIPPED', '部分发货', 'AFOOT', 3::bigint),
    ('SHIPPED', '已发货', 'AFOOT', 4::bigint),
    ('PENDING_ACCEPTANCE', '待验收', 'AFOOT', 5::bigint),
    ('COMPLETED', '已完成', 'END', 6::bigint),
    ('VOIDED', '已作废', 'END', 7::bigint)
)
INSERT INTO "sales_order_stage_config" (
  "id", "name", "type", "afoot_roll_back", "end_roll_back", "pos",
  "organization_id", "circulation_type", "create_time", "update_time",
  "create_user", "update_user"
)
SELECT
  md5(org.id || ':order-stage:' || d.code),
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

ALTER TABLE "orders" RENAME TO "sales_order";

DROP INDEX IF EXISTS "orders_tenantId_code_key";
DROP INDEX IF EXISTS "orders_tenantId_contractId_idx";
DROP INDEX IF EXISTS "orders_tenantId_deptId_idx";

ALTER TABLE "sales_order" DROP CONSTRAINT IF EXISTS "orders_contractId_fkey";

ALTER TABLE "sales_order" RENAME COLUMN "tenantId" TO "organization_id";
ALTER TABLE "sales_order" RENAME COLUMN "code" TO "number";
ALTER TABLE "sales_order" RENAME COLUMN "contractId" TO "contract_id";
ALTER TABLE "sales_order" RENAME COLUMN "ownerId" TO "owner";
ALTER TABLE "sales_order" RENAME COLUMN "approvalStatus" TO "approval_status";

ALTER TABLE "sales_order"
  ADD COLUMN "customer_id" VARCHAR(32),
  ADD COLUMN "stage_new" VARCHAR(50),
  ADD COLUMN "pos" BIGINT,
  ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "create_time" BIGINT,
  ADD COLUMN "update_time" BIGINT,
  ADD COLUMN "create_user" VARCHAR(32),
  ADD COLUMN "update_user" VARCHAR(32);

UPDATE "sales_order" o
SET
  "customer_id" = c."customer_id",
  "stage_new" = md5(o."organization_id" || ':order-stage:' || CASE o."status"::text
    WHEN 'DELIVERING' THEN 'PARTIALLY_SHIPPED'
    WHEN 'ACCEPTED' THEN 'PENDING_ACCEPTANCE'
    WHEN 'COMPLETED' THEN 'COMPLETED'
    WHEN 'CANCELED' THEN 'VOIDED'
    ELSE 'PENDING_SHIPMENT'
  END),
  "approved" = o."approval_status" = 'APPROVED',
  "create_time" = (EXTRACT(EPOCH FROM o."createdAt") * 1000)::BIGINT,
  "update_time" = (EXTRACT(EPOCH FROM o."updatedAt") * 1000)::BIGINT,
  "create_user" = COALESCE(
    o."owner",
    (SELECT u."id" FROM "users" u WHERE u."tenantId" = o."organization_id" ORDER BY u."createdAt" ASC LIMIT 1),
    'system'
  ),
  "update_user" = COALESCE(
    o."owner",
    (SELECT u."id" FROM "users" u WHERE u."tenantId" = o."organization_id" ORDER BY u."createdAt" ASC LIMIT 1),
    'system'
  )
FROM "contract" c
WHERE c."id" = o."contract_id";

-- Defensive fallback for databases with historically inconsistent contract
-- references. The target DDL allows customer_id/contract_id/owner to be null,
-- but stage/audit fields must always be valid.
UPDATE "sales_order" o
SET
  "stage_new" = COALESCE(
    o."stage_new",
    md5(o."organization_id" || ':order-stage:' || CASE o."status"::text
      WHEN 'DELIVERING' THEN 'PARTIALLY_SHIPPED'
      WHEN 'ACCEPTED' THEN 'PENDING_ACCEPTANCE'
      WHEN 'COMPLETED' THEN 'COMPLETED'
      WHEN 'CANCELED' THEN 'VOIDED'
      ELSE 'PENDING_SHIPMENT'
    END)
  ),
  "create_time" = COALESCE(o."create_time", (EXTRACT(EPOCH FROM o."createdAt") * 1000)::BIGINT),
  "update_time" = COALESCE(o."update_time", (EXTRACT(EPOCH FROM o."updatedAt") * 1000)::BIGINT),
  "create_user" = COALESCE(
    o."create_user",
    o."owner",
    (SELECT u."id" FROM "users" u WHERE u."tenantId" = o."organization_id" ORDER BY u."createdAt" ASC LIMIT 1),
    'system'
  ),
  "update_user" = COALESCE(
    o."update_user",
    o."owner",
    (SELECT u."id" FROM "users" u WHERE u."tenantId" = o."organization_id" ORDER BY u."createdAt" ASC LIMIT 1),
    'system'
  );

UPDATE "sales_order"
SET "approval_status" = CASE "approval_status"
  WHEN 'PENDING' THEN 'APPROVING'
  WHEN 'REJECTED' THEN 'UNAPPROVED'
  ELSE "approval_status"
END;

ALTER TABLE "sales_order"
  ALTER COLUMN "id" TYPE VARCHAR(32),
  ALTER COLUMN "number" TYPE VARCHAR(50),
  ALTER COLUMN "name" TYPE VARCHAR(255),
  ALTER COLUMN "contract_id" TYPE VARCHAR(32),
  ALTER COLUMN "owner" TYPE VARCHAR(32),
  ALTER COLUMN "amount" TYPE DECIMAL(20,10),
  ALTER COLUMN "approval_status" TYPE VARCHAR(50),
  ALTER COLUMN "organization_id" TYPE VARCHAR(32),
  ALTER COLUMN "stage_new" SET NOT NULL,
  ALTER COLUMN "create_time" SET NOT NULL,
  ALTER COLUMN "update_time" SET NOT NULL,
  ALTER COLUMN "create_user" SET NOT NULL,
  ALTER COLUMN "update_user" SET NOT NULL;

CREATE TABLE "sales_order_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,
    "ref_sub_id" VARCHAR(32),
    "row_id" VARCHAR(32),
    "biz_id" VARCHAR(32),
    CONSTRAINT "sales_order_field_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_order_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,
    "ref_sub_id" VARCHAR(32),
    "row_id" VARCHAR(32),
    "biz_id" VARCHAR(32),
    CONSTRAINT "sales_order_field_blob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_order_snapshot" (
    "id" VARCHAR(32) NOT NULL,
    "order_id" VARCHAR(32) NOT NULL,
    "order_prop" TEXT,
    "order_value" TEXT,
    CONSTRAINT "sales_order_snapshot_pkey" PRIMARY KEY ("id")
);

-- Normalize the legacy order module form to Cordys direct system fields. User
-- custom fields stay untouched and their legacy customData values are migrated
-- below before the JSON column is removed.
DELETE FROM "sys_module_field" field
USING "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'order'
  AND field."internal_key" IN ('remark', 'status', 'deliveredAt', 'acceptedAt', 'deptId');

UPDATE "sys_module_field" field
SET "internal_key" = 'owner', "name" = '负责人', "type" = 'member'
FROM "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'order'
  AND field."internal_key" = 'ownerId';

WITH templates(internal_key, name, type, pos, prop) AS (
  VALUES
    ('name', '订单名称', 'text', 0::bigint, '{"key":"name","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":200}'::text),
    ('number', '订单编号', 'text', 1::bigint, '{"key":"number","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":160}'::text),
    ('customerId', '关联客户', 'text', 2::bigint, '{"key":"customerId","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":180}'::text),
    ('contractId', '关联合同', 'text', 3::bigint, '{"key":"contractId","required":false,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":180}'::text),
    ('owner', '负责人', 'member', 4::bigint, '{"key":"owner","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":120}'::text),
    ('amount', '订单金额', 'currency', 5::bigint, '{"key":"amount","required":true,"system":true,"hidden":false,"options":null,"config":{"precision":2},"span":12,"showInList":true,"listWidth":140}'::text)
)
INSERT INTO "sys_module_field" (
  "id", "form_id", "internal_key", "name", "type", "mobile", "pos",
  "create_user", "create_time", "update_user", "update_time"
)
SELECT
  md5(form."id" || ':order:' || t.internal_key),
  form."id",
  t.internal_key,
  t.name,
  t.type,
  true,
  t.pos,
  form."create_user",
  form."create_time",
  form."update_user",
  (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
FROM "sys_module_form" form
CROSS JOIN templates t
WHERE form."form_key" = 'order'
  AND NOT EXISTS (
    SELECT 1 FROM "sys_module_field" existing
    WHERE existing."form_id" = form."id" AND existing."internal_key" = t.internal_key
  );

WITH templates(internal_key, prop) AS (
  VALUES
    ('name', '{"key":"name","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":200}'::text),
    ('number', '{"key":"number","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":160}'::text),
    ('customerId', '{"key":"customerId","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":180}'::text),
    ('contractId', '{"key":"contractId","required":false,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":180}'::text),
    ('owner', '{"key":"owner","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":120}'::text),
    ('amount', '{"key":"amount","required":true,"system":true,"hidden":false,"options":null,"config":{"precision":2},"span":12,"showInList":true,"listWidth":140}'::text)
)
INSERT INTO "sys_module_field_blob" ("id", "prop")
SELECT field."id", t.prop
FROM "sys_module_form" form
JOIN "sys_module_field" field ON field."form_id" = form."id"
JOIN templates t ON t.internal_key = field."internal_key"
WHERE form."form_key" = 'order'
ON CONFLICT ("id") DO UPDATE SET "prop" = EXCLUDED."prop";

-- Preserve user-created legacy order customData in the direct field tables.
INSERT INTO "sales_order_field" (
  "id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id"
)
SELECT
  md5('order:' || o."id" || ':' || f."id"),
  o."id",
  f."id",
  LEFT(o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key"), 255),
  NULL,
  NULL,
  NULL
FROM "sales_order" o
JOIN "sys_module_form" form
  ON form."organization_id" = o."organization_id" AND form."form_key" = 'order'
JOIN "sys_module_field" f ON f."form_id" = form."id"
LEFT JOIN "sys_module_field_blob" fb ON fb."id" = f."id"
WHERE o."customData" IS NOT NULL
  AND COALESCE((fb."prop"::jsonb ->> 'system')::boolean, false) = false
  AND COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND o."customData" ? COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")
  AND o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND f."type" NOT IN ('textarea', 'multiselect', 'checkbox', 'picture')
  AND length(o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")) <= 255;

INSERT INTO "sales_order_field_blob" (
  "id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id"
)
SELECT
  md5('order-blob:' || o."id" || ':' || f."id"),
  o."id",
  f."id",
  o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key"),
  NULL,
  NULL,
  NULL
FROM "sales_order" o
JOIN "sys_module_form" form
  ON form."organization_id" = o."organization_id" AND form."form_key" = 'order'
JOIN "sys_module_field" f ON f."form_id" = form."id"
LEFT JOIN "sys_module_field_blob" fb ON fb."id" = f."id"
WHERE o."customData" IS NOT NULL
  AND COALESCE((fb."prop"::jsonb ->> 'system')::boolean, false) = false
  AND COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND o."customData" ? COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")
  AND o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND (f."type" IN ('textarea', 'multiselect', 'checkbox', 'picture')
       OR length(o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")) > 255);

ALTER TABLE "sales_order"
  DROP COLUMN "status",
  DROP COLUMN "deliveredAt",
  DROP COLUMN "acceptedAt",
  DROP COLUMN "remark",
  DROP COLUMN "deptId",
  DROP COLUMN "customData",
  DROP COLUMN "createdAt",
  DROP COLUMN "updatedAt";

ALTER TABLE "sales_order" RENAME COLUMN "stage_new" TO "stage";

DROP TYPE IF EXISTS "OrderStatus";

ALTER TABLE "sales_order"
  ADD CONSTRAINT "sales_order_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_order_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_order_field"
  ADD CONSTRAINT "sales_order_field_resource_id_fkey"
    FOREIGN KEY ("resource_id") REFERENCES "sales_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_order_field_blob"
  ADD CONSTRAINT "sales_order_field_blob_resource_id_fkey"
    FOREIGN KEY ("resource_id") REFERENCES "sales_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_order_snapshot"
  ADD CONSTRAINT "sales_order_snapshot_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uk_order_field_cell"
  ON "sales_order_field"("resource_id", "ref_sub_id", "row_id", "field_id");
CREATE INDEX "sales_order_field_resource_id_idx" ON "sales_order_field"("resource_id");
CREATE INDEX "sales_order_field_ref_sub_id_idx" ON "sales_order_field"("ref_sub_id");

CREATE UNIQUE INDEX "uk_order_field_blob_cell"
  ON "sales_order_field_blob"("resource_id", "ref_sub_id", "row_id", "field_id");
CREATE INDEX "sales_order_field_blob_resource_id_idx" ON "sales_order_field_blob"("resource_id");
CREATE INDEX "sales_order_field_blob_ref_sub_id_idx" ON "sales_order_field_blob"("ref_sub_id");

CREATE INDEX "sales_order_snapshot_order_id_idx" ON "sales_order_snapshot"("order_id");
CREATE INDEX "sales_order_customer_id_idx" ON "sales_order"("customer_id");
CREATE INDEX "sales_order_contract_id_idx" ON "sales_order"("contract_id");
CREATE INDEX "sales_order_owner_idx" ON "sales_order"("owner");
CREATE INDEX "sales_order_name_idx" ON "sales_order"("name");
CREATE INDEX "sales_order_number_idx" ON "sales_order"("number");
CREATE INDEX "sales_order_organization_id_idx" ON "sales_order"("organization_id");
CREATE INDEX "sales_order_approval_status_idx" ON "sales_order"("approval_status");
CREATE INDEX "sales_order_stage_idx" ON "sales_order"("stage");
CREATE INDEX "sales_order_create_user_idx" ON "sales_order"("create_user");
