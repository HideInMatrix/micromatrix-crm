-- W3.6.0 Cordys opportunity direct-model replacement.
-- Preserve convertible legacy opportunity data while replacing custom stage/items/json models.

CREATE TABLE "opportunity_stage_config" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(16) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "rate" VARCHAR(10) NOT NULL,
    "afoot_roll_back" BOOLEAN NOT NULL DEFAULT false,
    "end_roll_back" BOOLEAN NOT NULL DEFAULT false,
    "pos" BIGINT NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    CONSTRAINT "opportunity_stage_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "opportunity_stage_config" (
    "id", "name", "type", "rate", "afoot_roll_back", "end_roll_back", "pos",
    "organization_id", "create_time", "update_time", "create_user", "update_user"
)
SELECT
    s."id",
    LEFT(s."name", 16),
    CASE WHEN s."isWon" OR s."isLost" THEN 'END' ELSE 'AFOOT' END,
    s."probability"::text,
    true,
    false,
    s."sort"::bigint + 1,
    s."tenantId",
    (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint,
    (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::bigint,
    COALESCE((SELECT u."id" FROM "users" u WHERE u."tenantId" = s."tenantId" ORDER BY u."createdAt" LIMIT 1), 'system'),
    COALESCE((SELECT u."id" FROM "users" u WHERE u."tenantId" = s."tenantId" ORDER BY u."createdAt" LIMIT 1), 'system')
FROM "opportunity_stages" s;

CREATE TABLE "opportunity" (
    "id" VARCHAR(32) NOT NULL,
    "customer_id" VARCHAR(32),
    "name" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(20,10),
    "possible" DECIMAL(20,10),
    "products" VARCHAR(1000),
    "organization_id" VARCHAR(32) NOT NULL,
    "last_stage" VARCHAR(32),
    "stage" VARCHAR(32) NOT NULL,
    "contact_id" VARCHAR(32),
    "owner" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "follower" VARCHAR(32),
    "follow_time" BIGINT,
    "expected_end_time" BIGINT,
    "actual_end_time" BIGINT,
    "failure_reason" VARCHAR(50),
    "pos" BIGINT,
    CONSTRAINT "opportunity_pkey" PRIMARY KEY ("id")
);

WITH converted AS (
    SELECT
        o.*,
        s."probability" AS stage_probability,
        ROW_NUMBER() OVER (PARTITION BY o."tenantId", o."stageId" ORDER BY o."createdAt", o."id") AS stage_pos,
        COALESCE(
            o."ownerId",
            (SELECT u."id" FROM "users" u WHERE u."tenantId" = o."tenantId" ORDER BY u."createdAt" LIMIT 1),
            'system'
        ) AS effective_owner,
        (
            SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE jsonb_agg(i."productId" ORDER BY i."sort", i."id")::text END
            FROM "opportunity_items" i
            WHERE i."opportunityId" = o."id" AND i."productId" IS NOT NULL
        ) AS product_ids
    FROM "opportunities" o
    JOIN "opportunity_stages" s ON s."id" = o."stageId"
)
INSERT INTO "opportunity" (
    "id", "customer_id", "name", "amount", "possible", "products", "organization_id",
    "last_stage", "stage", "contact_id", "owner", "update_user", "create_time", "update_time",
    "create_user", "follower", "follow_time", "expected_end_time", "actual_end_time", "failure_reason", "pos"
)
SELECT
    c."id",
    CASE WHEN EXISTS (SELECT 1 FROM "customer" x WHERE x."id" = c."customerId") THEN c."customerId" ELSE NULL END,
    c."name",
    c."amount"::decimal(20,10),
    c.stage_probability::decimal(20,10),
    LEFT(c.product_ids, 1000),
    c."tenantId",
    NULL,
    c."stageId",
    CASE WHEN EXISTS (SELECT 1 FROM "customer_contact" x WHERE x."id" = c."contactId") THEN c."contactId" ELSE NULL END,
    c.effective_owner,
    c.effective_owner,
    (EXTRACT(EPOCH FROM c."createdAt") * 1000)::bigint,
    (EXTRACT(EPOCH FROM c."updatedAt") * 1000)::bigint,
    c.effective_owner,
    NULL,
    CASE WHEN c."lastFollowedAt" IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM c."lastFollowedAt") * 1000)::bigint END,
    CASE WHEN c."expectedCloseAt" IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM c."expectedCloseAt") * 1000)::bigint END,
    CASE
        WHEN c."wonAt" IS NOT NULL THEN (EXTRACT(EPOCH FROM c."wonAt") * 1000)::bigint
        WHEN c."lostAt" IS NOT NULL THEN (EXTRACT(EPOCH FROM c."lostAt") * 1000)::bigint
        ELSE NULL
    END,
    LEFT(c."lostReason", 50),
    c.stage_pos::bigint
FROM converted c;

CREATE TABLE "opportunity_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,
    CONSTRAINT "opportunity_field_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opportunity_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,
    CONSTRAINT "opportunity_field_blob_pkey" PRIMARY KEY ("id")
);

-- Preserve legacy customData values only when they map to an existing custom ModuleField.
-- W3.4 direct field metadata stores the public key/system flag inside sys_module_field_blob.prop;
-- storage routing must match ResourceFieldValueService (textarea/multiselect/checkbox always use blob).
INSERT INTO "opportunity_field" ("id", "resource_id", "field_id", "field_value")
SELECT
    md5(o."id" || ':' || f."id"),
    o."id",
    f."id",
    LEFT(o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key"), 255)
FROM "opportunities" o
JOIN "sys_module_form" form ON form."organization_id" = o."tenantId" AND form."form_key" = 'opportunity'
JOIN "sys_module_field" f ON f."form_id" = form."id"
LEFT JOIN "sys_module_field_blob" fb ON fb."id" = f."id"
WHERE o."customData" IS NOT NULL
  AND COALESCE((fb."prop"::jsonb ->> 'system')::boolean, false) = false
  AND COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND o."customData" ? COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")
  AND o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND f."type" NOT IN ('textarea', 'multiselect', 'checkbox')
  AND length(o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")) <= 255;

INSERT INTO "opportunity_field_blob" ("id", "resource_id", "field_id", "field_value")
SELECT
    md5('blob:' || o."id" || ':' || f."id"),
    o."id",
    f."id",
    o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")
FROM "opportunities" o
JOIN "sys_module_form" form ON form."organization_id" = o."tenantId" AND form."form_key" = 'opportunity'
JOIN "sys_module_field" f ON f."form_id" = form."id"
LEFT JOIN "sys_module_field_blob" fb ON fb."id" = f."id"
WHERE o."customData" IS NOT NULL
  AND COALESCE((fb."prop"::jsonb ->> 'system')::boolean, false) = false
  AND COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND o."customData" ? COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")
  AND o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key") IS NOT NULL
  AND (
    f."type" IN ('textarea', 'multiselect', 'checkbox')
    OR length(o."customData" ->> COALESCE(fb."prop"::jsonb ->> 'key', f."internal_key")) > 255
  );

CREATE TABLE "opportunity_rule" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "owner_id" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "operator" VARCHAR(10),
    "condition" TEXT,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    CONSTRAINT "opportunity_rule_pkey" PRIMARY KEY ("id")
);

DROP TABLE "opportunity_stage_logs";
DROP TABLE "opportunity_items";
DROP TABLE "opportunities";
DROP TABLE "opportunity_stages";

CREATE INDEX "opportunity_stage_config_organization_id_idx" ON "opportunity_stage_config"("organization_id");
CREATE INDEX "opportunity_stage_config_organization_id_pos_idx" ON "opportunity_stage_config"("organization_id", "pos");
CREATE INDEX "opportunity_customer_id_idx" ON "opportunity"("customer_id");
CREATE INDEX "opportunity_organization_id_idx" ON "opportunity"("organization_id");
CREATE INDEX "opportunity_stage_idx" ON "opportunity"("stage");
CREATE INDEX "opportunity_owner_idx" ON "opportunity"("owner");
CREATE INDEX "opportunity_follower_idx" ON "opportunity"("follower");
CREATE INDEX "opportunity_follow_time_idx" ON "opportunity"("follow_time");
CREATE UNIQUE INDEX "opportunity_field_resource_id_field_id_key" ON "opportunity_field"("resource_id", "field_id");
CREATE INDEX "opportunity_field_resource_id_field_id_field_value_idx" ON "opportunity_field"("resource_id", "field_id", "field_value");
CREATE UNIQUE INDEX "opportunity_field_blob_resource_id_field_id_key" ON "opportunity_field_blob"("resource_id", "field_id");
CREATE INDEX "opportunity_field_blob_resource_id_idx" ON "opportunity_field_blob"("resource_id");
CREATE INDEX "opportunity_rule_organization_id_idx" ON "opportunity_rule"("organization_id");

ALTER TABLE "opportunity"
ADD CONSTRAINT "opportunity_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "opportunity"
ADD CONSTRAINT "opportunity_contact_id_fkey"
FOREIGN KEY ("contact_id") REFERENCES "customer_contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "opportunity"
ADD CONSTRAINT "opportunity_stage_fkey"
FOREIGN KEY ("stage") REFERENCES "opportunity_stage_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opportunity_field"
ADD CONSTRAINT "opportunity_field_resource_id_fkey"
FOREIGN KEY ("resource_id") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "opportunity_field_blob"
ADD CONSTRAINT "opportunity_field_blob_resource_id_fkey"
FOREIGN KEY ("resource_id") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
