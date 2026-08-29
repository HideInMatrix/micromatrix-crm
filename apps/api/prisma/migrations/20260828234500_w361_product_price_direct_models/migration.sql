-- W3.6.1: align Product / ProductPrice with Cordys direct models.
-- Old `products` is a MicroMatrix-only model. It is used only as a one-time migration source
-- and is removed after the Cordys `product` table is populated. No compatibility view or dual write.

CREATE TABLE "product" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "price" DECIMAL(14,4),
    "status" VARCHAR(32) NOT NULL,
    "pos" BIGINT NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_organization_id_idx" ON "product"("organization_id");
CREATE INDEX "product_name_idx" ON "product"("name");
CREATE INDEX "product_organization_id_pos_idx" ON "product"("organization_id", "pos");

CREATE TABLE "product_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,
    CONSTRAINT "product_field_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_field_resource_id_field_id_key" ON "product_field"("resource_id", "field_id");
CREATE INDEX "product_field_resource_id_field_id_field_value_idx" ON "product_field"("resource_id", "field_id", "field_value");
ALTER TABLE "product_field" ADD CONSTRAINT "product_field_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "product_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,
    CONSTRAINT "product_field_blob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_field_blob_resource_id_field_id_key" ON "product_field_blob"("resource_id", "field_id");
CREATE INDEX "product_field_blob_resource_id_idx" ON "product_field_blob"("resource_id");
ALTER TABLE "product_field_blob" ADD CONSTRAINT "product_field_blob_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "product_price" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "pos" BIGINT NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    CONSTRAINT "product_price_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_price_organization_id_idx" ON "product_price"("organization_id");
CREATE INDEX "product_price_status_idx" ON "product_price"("status");
CREATE INDEX "product_price_organization_id_pos_idx" ON "product_price"("organization_id", "pos");

CREATE TABLE "product_price_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,
    "ref_sub_id" VARCHAR(32),
    "row_id" VARCHAR(32),
    "biz_id" VARCHAR(32),
    CONSTRAINT "product_price_field_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_price_field_cell" ON "product_price_field"("resource_id", "ref_sub_id", "row_id", "field_id");
CREATE INDEX "product_price_field_resource_id_idx" ON "product_price_field"("resource_id");
CREATE INDEX "product_price_field_ref_sub_id_idx" ON "product_price_field"("ref_sub_id");
ALTER TABLE "product_price_field" ADD CONSTRAINT "product_price_field_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "product_price"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "product_price_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,
    "ref_sub_id" VARCHAR(32),
    "row_id" VARCHAR(32),
    "biz_id" VARCHAR(32),
    CONSTRAINT "product_price_field_blob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_price_field_blob_cell" ON "product_price_field_blob"("resource_id", "ref_sub_id", "row_id", "field_id");
CREATE INDEX "product_price_field_blob_resource_id_idx" ON "product_price_field_blob"("resource_id");
CREATE INDEX "product_price_field_blob_ref_sub_id_idx" ON "product_price_field_blob"("ref_sub_id");
ALTER TABLE "product_price_field_blob" ADD CONSTRAINT "product_price_field_blob_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "product_price"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve only fields that belong to the Cordys product main table.
-- Historical MicroMatrix rows use User IDs as ownerId; Cordys audit columns require a user ID.
-- For rows without ownerId, fall back to the oldest active organization member, then a stable
-- seed-compatible placeholder. Existing development data is not a compatibility contract.
INSERT INTO "product" (
  "id", "name", "price", "status", "pos", "organization_id",
  "create_time", "update_time", "create_user", "update_user"
)
SELECT
  p."id",
  LEFT(p."name", 255),
  p."price"::DECIMAL(14,4),
  CASE WHEN p."status"::text = 'OFF' THEN '2' ELSE '1' END,
  (ROW_NUMBER() OVER (PARTITION BY p."tenantId" ORDER BY p."createdAt", p."id") * 4096)::BIGINT,
  p."tenantId",
  (EXTRACT(EPOCH FROM p."createdAt") * 1000)::BIGINT,
  (EXTRACT(EPOCH FROM p."updatedAt") * 1000)::BIGINT,
  COALESCE(
    p."ownerId",
    (SELECT u."id" FROM "users" u WHERE u."tenantId" = p."tenantId" ORDER BY u."createdAt" ASC LIMIT 1),
    'system'
  ),
  COALESCE(
    p."ownerId",
    (SELECT u."id" FROM "users" u WHERE u."tenantId" = p."tenantId" ORDER BY u."createdAt" ASC LIMIT 1),
    'system'
  )
FROM "products" p;

DROP TABLE "products";
