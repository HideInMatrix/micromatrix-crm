-- W3.6.2: replace the legacy MicroMatrix `quotes` / `quote_items` model with
-- Cordys `opportunity_quotation` direct tables. Legacy rows without a valid
-- Opportunity cannot satisfy the Cordys NOT NULL opportunity relation and are
-- intentionally discarded rather than fabricating a business relation.

CREATE TABLE "opportunity_quotation" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "opportunity_id" VARCHAR(32) NOT NULL,
    "until_time" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approval_status" VARCHAR(50) NOT NULL DEFAULT 'NONE',
    "invalid" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "opportunity_quotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opportunity_quotation_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,
    "ref_sub_id" VARCHAR(32),
    "row_id" VARCHAR(32),
    "biz_id" VARCHAR(32),
    CONSTRAINT "opportunity_quotation_field_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opportunity_quotation_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,
    "ref_sub_id" VARCHAR(32),
    "row_id" VARCHAR(32),
    "biz_id" VARCHAR(32),
    CONSTRAINT "opportunity_quotation_field_blob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opportunity_quotation_snapshot" (
    "id" VARCHAR(32) NOT NULL,
    "quotation_id" VARCHAR(32) NOT NULL,
    "quotation_prop" TEXT,
    "quotation_value" TEXT,
    CONSTRAINT "opportunity_quotation_snapshot_pkey" PRIMARY KEY ("id")
);

-- Preserve only legacy rows that already have a valid Cordys Opportunity in
-- the same organization. The old validUntil was optional; Cordys makes it
-- required, so an empty legacy value deterministically falls back to the
-- record's own creation timestamp rather than inventing a new validity period.
INSERT INTO "opportunity_quotation" (
    "id", "name", "opportunity_id", "until_time", "amount",
    "approval_status", "invalid", "organization_id", "create_time", "update_time",
    "create_user", "update_user", "approved"
)
SELECT
    q."id",
    LEFT(q."name", 255),
    q."opportunityId",
    (EXTRACT(EPOCH FROM COALESCE(q."validUntil", q."createdAt")) * 1000)::BIGINT,
    q."totalAmount"::DECIMAL(14,2),
    CASE q."approvalStatus"
      WHEN 'PENDING' THEN 'APPROVING'
      WHEN 'REJECTED' THEN 'UNAPPROVED'
      ELSE q."approvalStatus"
    END,
    q."status"::text = 'VOID',
    q."tenantId",
    (EXTRACT(EPOCH FROM q."createdAt") * 1000)::BIGINT,
    (EXTRACT(EPOCH FROM q."updatedAt") * 1000)::BIGINT,
    COALESCE(
      q."ownerId",
      (SELECT u."id" FROM "users" u WHERE u."tenantId" = q."tenantId" ORDER BY u."createdAt" ASC LIMIT 1),
      'system'
    ),
    COALESCE(
      q."ownerId",
      (SELECT u."id" FROM "users" u WHERE u."tenantId" = q."tenantId" ORDER BY u."createdAt" ASC LIMIT 1),
      'system'
    ),
    q."approvalStatus" = 'APPROVED'
FROM "quotes" q
JOIN "opportunity" o
  ON o."id" = q."opportunityId"
 AND o."organization_id" = q."tenantId";

-- Preserve legacy customData only for user-defined quote fields that already
-- exist. System-field repair below is deliberately separate from this copy so
-- obsolete owner/remark definitions cannot become new direct-field truth.
INSERT INTO "opportunity_quotation_field" (
  "id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id"
)
SELECT
  md5('quote:' || q."id" || ':' || f."id"),
  q."id",
  f."id",
  LEFT(q."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key"), 255),
  NULL, NULL, NULL
FROM "quotes" q
JOIN "opportunity_quotation" nq ON nq."id" = q."id"
JOIN "sys_module_form" form
  ON form."organization_id" = q."tenantId" AND form."form_key" = 'quote'
JOIN "sys_module_field" f ON f."form_id" = form."id"
LEFT JOIN "sys_module_field_blob" fb ON fb."id" = f."id"
WHERE q."customData" IS NOT NULL
  AND COALESCE((fb."prop"::jsonb ->> 'system')::boolean, false) = false
  AND COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND q."customData" ? COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")
  AND q."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND f."type" NOT IN ('textarea', 'multiselect', 'checkbox', 'picture')
  AND length(q."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")) <= 255;

INSERT INTO "opportunity_quotation_field_blob" (
  "id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id"
)
SELECT
  md5('quote-blob:' || q."id" || ':' || f."id"),
  q."id",
  f."id",
  q."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key"),
  NULL, NULL, NULL
FROM "quotes" q
JOIN "opportunity_quotation" nq ON nq."id" = q."id"
JOIN "sys_module_form" form
  ON form."organization_id" = q."tenantId" AND form."form_key" = 'quote'
JOIN "sys_module_field" f ON f."form_id" = form."id"
LEFT JOIN "sys_module_field_blob" fb ON fb."id" = f."id"
WHERE q."customData" IS NOT NULL
  AND COALESCE((fb."prop"::jsonb ->> 'system')::boolean, false) = false
  AND COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND q."customData" ? COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")
  AND q."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND (
    f."type" IN ('textarea', 'multiselect', 'checkbox', 'picture')
    OR length(q."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")) > 255
  );

-- Repair already-initialized quote forms from the legacy MicroMatrix fields to
-- the Cordys quotation business fields. User-created custom fields are kept.
DELETE FROM "sys_module_field" field
USING "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'quote'
  AND field."internal_key" IN ('ownerId', 'remark');

UPDATE "sys_module_field" field
SET "internal_key" = 'untilTime',
    "name" = '有效期至',
    "type" = 'date',
    "pos" = 4,
    "update_time" = (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
FROM "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'quote'
  AND field."internal_key" = 'validUntil';

UPDATE "sys_module_field" field
SET "name" = '报价',
    "type" = 'text',
    "pos" = 0,
    "update_time" = (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
FROM "sys_module_form" form
WHERE field."form_id" = form."id"
  AND form."form_key" = 'quote'
  AND field."internal_key" = 'name';

-- Create missing Cordys quotation fields for forms that already exist. IDs are
-- deterministic per form so this migration is replay-safe on clean databases.
WITH templates(internal_key, name, type, pos, prop) AS (
  VALUES
    ('opportunityId', '商机', 'text', 1::bigint, '{"key":"opportunityId","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":180}'::text),
    ('contactId', '联系人', 'text', 2::bigint, '{"key":"contactId","required":false,"system":false,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":140}'::text),
    ('quotationTime', '报价日期', 'date', 3::bigint, '{"key":"quotationTime","required":false,"system":false,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":120}'::text),
    ('products', '报价产品', 'textarea', 5::bigint, '{"key":"products","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":24,"showInList":false,"listWidth":null}'::text),
    ('product', '产品', 'text', 6::bigint, '{"key":"product","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('priceId', '价格表', 'text', 7::bigint, '{"key":"priceId","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('productAmount', '产品定价', 'currency', 8::bigint, '{"key":"productAmount","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('discount', '折扣', 'number', 9::bigint, '{"key":"discount","required":false,"system":true,"hidden":true,"options":null,"config":{"defaultValue":100,"precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('tax', '税点', 'percent', 10::bigint, '{"key":"tax","required":false,"system":true,"hidden":true,"options":null,"config":{"precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('lineAmount', '金额', 'formula', 11::bigint, '{"key":"lineAmount","required":false,"system":true,"hidden":true,"options":null,"config":{"formula":"productAmount * discount / 100","precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('amount', '累计金额', 'formula', 12::bigint, '{"key":"amount","required":true,"system":true,"hidden":false,"options":null,"config":{"precision":2},"span":12,"showInList":true,"listWidth":120}'::text)
)
INSERT INTO "sys_module_field" (
  "id", "form_id", "internal_key", "name", "type", "mobile", "pos",
  "create_user", "create_time", "update_user", "update_time"
)
SELECT
  md5(form."id" || ':quotation:' || t.internal_key),
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
WHERE form."form_key" = 'quote'
  AND NOT EXISTS (
    SELECT 1 FROM "sys_module_field" existing
    WHERE existing."form_id" = form."id" AND existing."internal_key" = t.internal_key
  );

WITH templates(internal_key, prop) AS (
  VALUES
    ('name', '{"key":"name","required":true,"system":true,"hidden":false,"options":null,"config":{"unique":true},"span":12,"showInList":true,"listWidth":200}'::text),
    ('opportunityId', '{"key":"opportunityId","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":180}'::text),
    ('contactId', '{"key":"contactId","required":false,"system":false,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":140}'::text),
    ('quotationTime', '{"key":"quotationTime","required":false,"system":false,"hidden":false,"options":null,"config":null,"span":12,"showInList":false,"listWidth":120}'::text),
    ('untilTime', '{"key":"untilTime","required":true,"system":true,"hidden":false,"options":null,"config":null,"span":12,"showInList":true,"listWidth":120}'::text),
    ('products', '{"key":"products","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":24,"showInList":false,"listWidth":null}'::text),
    ('product', '{"key":"product","required":true,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('priceId', '{"key":"priceId","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('productAmount', '{"key":"productAmount","required":false,"system":true,"hidden":true,"options":null,"config":null,"span":12,"showInList":false,"listWidth":null}'::text),
    ('discount', '{"key":"discount","required":false,"system":true,"hidden":true,"options":null,"config":{"defaultValue":100,"precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('tax', '{"key":"tax","required":false,"system":true,"hidden":true,"options":null,"config":{"precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('lineAmount', '{"key":"lineAmount","required":false,"system":true,"hidden":true,"options":null,"config":{"formula":"productAmount * discount / 100","precision":2},"span":12,"showInList":false,"listWidth":null}'::text),
    ('amount', '{"key":"amount","required":true,"system":true,"hidden":false,"options":null,"config":{"precision":2},"span":12,"showInList":true,"listWidth":120}'::text)
)
INSERT INTO "sys_module_field_blob" ("id", "prop")
SELECT field."id", t.prop
FROM "sys_module_form" form
JOIN "sys_module_field" field ON field."form_id" = form."id"
JOIN templates t ON t.internal_key = field."internal_key"
WHERE form."form_key" = 'quote'
ON CONFLICT ("id") DO UPDATE SET "prop" = EXCLUDED."prop";

-- Convert legacy QuoteItem rows into the quotation products sub-table when the
-- row references an existing Cordys Product. Unit/quantity are legacy-only and
-- intentionally not carried forward; price/discount/line amount map directly.
INSERT INTO "opportunity_quotation_field" (
  "id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id"
)
SELECT
  md5('quotation-product:' || i."id"),
  i."quoteId",
  product_field."id",
  i."productId",
  parent_field."id",
  md5('quotation-row:' || i."id"),
  md5('quotation-biz:' || i."id")
FROM "quote_items" i
JOIN "opportunity_quotation" q ON q."id" = i."quoteId"
JOIN "product" p ON p."id" = i."productId" AND p."organization_id" = q."organization_id"
JOIN "sys_module_form" form ON form."organization_id" = q."organization_id" AND form."form_key" = 'quote'
JOIN "sys_module_field" parent_field ON parent_field."form_id" = form."id" AND parent_field."internal_key" = 'products'
JOIN "sys_module_field" product_field ON product_field."form_id" = form."id" AND product_field."internal_key" = 'product'
WHERE i."productId" IS NOT NULL;

INSERT INTO "opportunity_quotation_field" (
  "id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id"
)
SELECT md5('quotation-product-amount:' || i."id"), i."quoteId", field."id", i."unitPrice"::text,
       parent."id", md5('quotation-row:' || i."id"), md5('quotation-biz:' || i."id")
FROM "quote_items" i
JOIN "opportunity_quotation" q ON q."id" = i."quoteId"
JOIN "sys_module_form" form ON form."organization_id" = q."organization_id" AND form."form_key" = 'quote'
JOIN "sys_module_field" parent ON parent."form_id" = form."id" AND parent."internal_key" = 'products'
JOIN "sys_module_field" field ON field."form_id" = form."id" AND field."internal_key" = 'productAmount';

INSERT INTO "opportunity_quotation_field" (
  "id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id"
)
SELECT md5('quotation-discount:' || i."id"), i."quoteId", field."id", i."discount"::text,
       parent."id", md5('quotation-row:' || i."id"), md5('quotation-biz:' || i."id")
FROM "quote_items" i
JOIN "opportunity_quotation" q ON q."id" = i."quoteId"
JOIN "sys_module_form" form ON form."organization_id" = q."organization_id" AND form."form_key" = 'quote'
JOIN "sys_module_field" parent ON parent."form_id" = form."id" AND parent."internal_key" = 'products'
JOIN "sys_module_field" field ON field."form_id" = form."id" AND field."internal_key" = 'discount';

INSERT INTO "opportunity_quotation_field" (
  "id", "resource_id", "field_id", "field_value", "ref_sub_id", "row_id", "biz_id"
)
SELECT md5('quotation-line-amount:' || i."id"), i."quoteId", field."id", i."amount"::text,
       parent."id", md5('quotation-row:' || i."id"), md5('quotation-biz:' || i."id")
FROM "quote_items" i
JOIN "opportunity_quotation" q ON q."id" = i."quoteId"
JOIN "sys_module_form" form ON form."organization_id" = q."organization_id" AND form."form_key" = 'quote'
JOIN "sys_module_field" parent ON parent."form_id" = form."id" AND parent."internal_key" = 'products'
JOIN "sys_module_field" field ON field."form_id" = form."id" AND field."internal_key" = 'lineAmount';

DROP TABLE "quote_items";
DROP TABLE "quotes";

CREATE INDEX "opportunity_quotation_opportunity_id_idx" ON "opportunity_quotation"("opportunity_id");
CREATE INDEX "opportunity_quotation_organization_id_idx" ON "opportunity_quotation"("organization_id");
CREATE INDEX "opportunity_quotation_approval_status_idx" ON "opportunity_quotation"("approval_status");
CREATE INDEX "opportunity_quotation_create_user_idx" ON "opportunity_quotation"("create_user");
CREATE UNIQUE INDEX "uk_opp_quotation_field_cell" ON "opportunity_quotation_field"("resource_id", "ref_sub_id", "row_id", "field_id");
CREATE INDEX "opportunity_quotation_field_resource_id_idx" ON "opportunity_quotation_field"("resource_id");
CREATE INDEX "opportunity_quotation_field_ref_sub_id_idx" ON "opportunity_quotation_field"("ref_sub_id");
CREATE UNIQUE INDEX "uk_opp_quotation_field_blob_cell" ON "opportunity_quotation_field_blob"("resource_id", "ref_sub_id", "row_id", "field_id");
CREATE INDEX "opportunity_quotation_field_blob_resource_id_idx" ON "opportunity_quotation_field_blob"("resource_id");
CREATE INDEX "opportunity_quotation_field_blob_ref_sub_id_idx" ON "opportunity_quotation_field_blob"("ref_sub_id");
CREATE INDEX "opportunity_quotation_snapshot_quotation_id_idx" ON "opportunity_quotation_snapshot"("quotation_id");

ALTER TABLE "opportunity_quotation"
ADD CONSTRAINT "opportunity_quotation_opportunity_id_fkey"
FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opportunity_quotation_field"
ADD CONSTRAINT "opportunity_quotation_field_resource_id_fkey"
FOREIGN KEY ("resource_id") REFERENCES "opportunity_quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "opportunity_quotation_field_blob"
ADD CONSTRAINT "opportunity_quotation_field_blob_resource_id_fkey"
FOREIGN KEY ("resource_id") REFERENCES "opportunity_quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "opportunity_quotation_snapshot"
ADD CONSTRAINT "opportunity_quotation_snapshot_quotation_id_fkey"
FOREIGN KEY ("quotation_id") REFERENCES "opportunity_quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
