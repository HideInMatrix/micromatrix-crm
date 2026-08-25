-- W3.4.0 Cordys direct-model replacement.
-- The project is unpublished: legacy sales/pool/view/metadata data is intentionally discarded.
-- Do not add compatibility views, backfill columns, dual-write triggers, or legacy aliases here.

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_customerId_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_customerId_fkey";

-- DropForeignKey
ALTER TABLE "customer_team_members" DROP CONSTRAINT "customer_team_members_customerId_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_contactId_fkey";

-- DropForeignKey
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_customerId_fkey";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_customerId_fkey";

-- DropForeignKey
ALTER TABLE "resource_pool_pick_rules" DROP CONSTRAINT "resource_pool_pick_rules_poolId_fkey";

-- DropForeignKey
ALTER TABLE "resource_pool_recycle_rules" DROP CONSTRAINT "resource_pool_recycle_rules_poolId_fkey";

-- DropForeignKey
ALTER TABLE "saved_view_conditions" DROP CONSTRAINT "saved_view_conditions_viewId_fkey";

-- DropTable
DROP TABLE "contacts";

-- DropTable
DROP TABLE "customer_relations";

-- DropTable
DROP TABLE "customer_team_members";

-- DropTable
DROP TABLE "customers";

-- DropTable
DROP TABLE "field_definitions";

-- DropTable
DROP TABLE "leads";

-- DropTable
DROP TABLE "pool_rules";

-- DropTable
DROP TABLE "resource_capacities";

-- DropTable
DROP TABLE "resource_owner_histories";

-- DropTable
DROP TABLE "resource_pool_pick_rules";

-- DropTable
DROP TABLE "resource_pool_recycle_rules";

-- DropTable
DROP TABLE "resource_pools";

-- DropTable
DROP TABLE "saved_view_conditions";

-- DropTable
DROP TABLE "saved_views";

-- DropEnum
DROP TYPE "LeadStatus";

-- CreateTable
CREATE TABLE "customer" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "owner" VARCHAR(32),
    "collection_time" BIGINT,
    "pool_id" VARCHAR(32),
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    "in_shared_pool" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" VARCHAR(32) NOT NULL,
    "follower" VARCHAR(32),
    "follow_time" BIGINT,
    "reason_id" VARCHAR(32),

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "customer_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "customer_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_owner" (
    "id" VARCHAR(32) NOT NULL,
    "customer_id" VARCHAR(32) NOT NULL,
    "owner" VARCHAR(32) NOT NULL,
    "collection_time" BIGINT NOT NULL,
    "end_time" BIGINT NOT NULL,
    "operator" VARCHAR(32) NOT NULL,
    "reason_id" VARCHAR(32),

    CONSTRAINT "customer_owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact" (
    "id" VARCHAR(32) NOT NULL,
    "customer_id" VARCHAR(32),
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(30),
    "owner" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    "enable" BOOLEAN NOT NULL DEFAULT false,
    "disable_reason" VARCHAR(255),
    "organization_id" VARCHAR(32) NOT NULL,

    CONSTRAINT "customer_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "customer_contact_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "customer_contact_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_collaboration" (
    "id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "customer_id" VARCHAR(32) NOT NULL,
    "collaboration_type" VARCHAR(50) NOT NULL,

    CONSTRAINT "customer_collaboration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_relation" (
    "id" VARCHAR(32) NOT NULL,
    "source_customer_id" VARCHAR(32) NOT NULL,
    "target_customer_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,

    CONSTRAINT "customer_relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_pool" (
    "id" VARCHAR(32) NOT NULL,
    "scope_id" TEXT NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "owner_id" TEXT NOT NULL,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "customer_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_pool_hidden_field" (
    "pool_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,

    CONSTRAINT "customer_pool_hidden_field_pkey" PRIMARY KEY ("pool_id","field_id")
);

-- CreateTable
CREATE TABLE "customer_pool_pick_rule" (
    "id" VARCHAR(32) NOT NULL,
    "pool_id" VARCHAR(32) NOT NULL,
    "limit_on_number" BOOLEAN NOT NULL DEFAULT true,
    "pick_number" INTEGER,
    "limit_pre_owner" BOOLEAN NOT NULL DEFAULT true,
    "pick_interval_days" INTEGER,
    "limit_new" BOOLEAN NOT NULL DEFAULT false,
    "new_pick_interval" INTEGER,
    "create_user" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    "update_time" BIGINT NOT NULL,

    CONSTRAINT "customer_pool_pick_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_pool_recycle_rule" (
    "id" VARCHAR(32) NOT NULL,
    "pool_id" VARCHAR(32) NOT NULL,
    "operator" VARCHAR(10),
    "condition" TEXT,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "customer_pool_recycle_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_capacity" (
    "id" VARCHAR(32) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "scope_id" TEXT NOT NULL,
    "capacity" INTEGER,
    "filter" TEXT,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "customer_capacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clue" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "owner" VARCHAR(32),
    "last_stage" VARCHAR(30),
    "stage" VARCHAR(30) NOT NULL,
    "collection_time" BIGINT,
    "contact" VARCHAR(255),
    "phone" VARCHAR(255),
    "products" VARCHAR(1000),
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    "transition_type" VARCHAR(30) DEFAULT 'NONE',
    "transition_id" VARCHAR(32),
    "in_shared_pool" BOOLEAN NOT NULL DEFAULT false,
    "follower" VARCHAR(32),
    "follow_time" BIGINT,
    "pool_id" VARCHAR(32),
    "reason_id" VARCHAR(32),

    CONSTRAINT "clue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clue_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "clue_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clue_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "clue_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clue_owner" (
    "id" VARCHAR(32) NOT NULL,
    "clue_id" VARCHAR(32) NOT NULL,
    "owner" VARCHAR(32) NOT NULL,
    "collection_time" BIGINT NOT NULL,
    "end_time" BIGINT NOT NULL,
    "operator" VARCHAR(32) NOT NULL,
    "reason_id" VARCHAR(32),

    CONSTRAINT "clue_owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clue_pool" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "scope_id" TEXT NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "owner_id" TEXT NOT NULL,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "clue_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clue_pool_hidden_field" (
    "pool_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(255) NOT NULL,

    CONSTRAINT "clue_pool_hidden_field_pkey" PRIMARY KEY ("pool_id","field_id")
);

-- CreateTable
CREATE TABLE "clue_pool_pick_rule" (
    "id" VARCHAR(32) NOT NULL,
    "pool_id" VARCHAR(32) NOT NULL,
    "limit_on_number" BOOLEAN NOT NULL DEFAULT true,
    "pick_number" INTEGER,
    "limit_pre_owner" BOOLEAN NOT NULL DEFAULT true,
    "pick_interval_days" INTEGER,
    "limit_new" BOOLEAN NOT NULL DEFAULT false,
    "new_pick_interval" INTEGER,
    "create_user" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    "update_time" BIGINT NOT NULL,

    CONSTRAINT "clue_pool_pick_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clue_pool_recycle_rule" (
    "id" VARCHAR(32) NOT NULL,
    "pool_id" VARCHAR(32) NOT NULL,
    "operator" VARCHAR(10),
    "condition" TEXT,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "clue_pool_recycle_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clue_capacity" (
    "id" VARCHAR(32) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "scope_id" TEXT NOT NULL,
    "capacity" INTEGER,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "clue_capacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_module_form" (
    "id" VARCHAR(32) NOT NULL,
    "form_key" VARCHAR(50) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "sys_module_form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_module_form_blob" (
    "id" VARCHAR(32) NOT NULL,
    "prop" TEXT,

    CONSTRAINT "sys_module_form_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_module_field" (
    "id" VARCHAR(32) NOT NULL,
    "form_id" VARCHAR(32) NOT NULL,
    "internal_key" VARCHAR(255),
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "mobile" BOOLEAN NOT NULL DEFAULT false,
    "pos" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    "update_time" BIGINT NOT NULL,

    CONSTRAINT "sys_module_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_module_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "prop" TEXT,

    CONSTRAINT "sys_module_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_user_view" (
    "id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "fixed" BOOLEAN NOT NULL DEFAULT false,
    "resource_type" VARCHAR(50) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "pos" BIGINT NOT NULL,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "search_mode" VARCHAR(10) NOT NULL DEFAULT 'AND',
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "sys_user_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_user_view_condition" (
    "id" VARCHAR(32) NOT NULL,
    "sys_user_view_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "value" TEXT,
    "value_type" TEXT,
    "type" VARCHAR(20),
    "multiple_value" BOOLEAN NOT NULL DEFAULT false,
    "operator" VARCHAR(20),
    "children_value" TEXT,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "sys_user_view_condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_module" (
    "id" VARCHAR(32) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "parent_id" VARCHAR(32) NOT NULL DEFAULT 'NONE',
    "pos" BIGINT NOT NULL DEFAULT 0,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "dashboard_module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "resource_url" VARCHAR(500) NOT NULL,
    "dashboard_module_id" VARCHAR(32) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "pos" BIGINT NOT NULL DEFAULT 0,
    "scope_id" TEXT NOT NULL,
    "description" VARCHAR(1000),
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_collection" (
    "id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "dashboard_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "dashboard_collection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_organization_id_idx" ON "customer"("organization_id");

-- CreateIndex
CREATE INDEX "customer_pool_id_idx" ON "customer"("pool_id");

-- CreateIndex
CREATE INDEX "customer_follower_idx" ON "customer"("follower");

-- CreateIndex
CREATE INDEX "customer_follow_time_idx" ON "customer"("follow_time");

-- CreateIndex
CREATE INDEX "customer_reason_id_idx" ON "customer"("reason_id");

-- CreateIndex
CREATE INDEX "customer_field_resource_id_field_id_field_value_idx" ON "customer_field"("resource_id", "field_id", "field_value");

-- CreateIndex
CREATE UNIQUE INDEX "customer_field_resource_id_field_id_key" ON "customer_field"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "customer_field_blob_resource_id_idx" ON "customer_field_blob"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_field_blob_resource_id_field_id_key" ON "customer_field_blob"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "customer_owner_customer_id_idx" ON "customer_owner"("customer_id");

-- CreateIndex
CREATE INDEX "customer_contact_customer_id_idx" ON "customer_contact"("customer_id");

-- CreateIndex
CREATE INDEX "customer_contact_organization_id_idx" ON "customer_contact"("organization_id");

-- CreateIndex
CREATE INDEX "customer_contact_phone_idx" ON "customer_contact"("phone");

-- CreateIndex
CREATE INDEX "customer_contact_field_resource_id_field_id_field_value_idx" ON "customer_contact_field"("resource_id", "field_id", "field_value");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contact_field_resource_id_field_id_key" ON "customer_contact_field"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "customer_contact_field_blob_resource_id_idx" ON "customer_contact_field_blob"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contact_field_blob_resource_id_field_id_key" ON "customer_contact_field_blob"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "customer_collaboration_customer_id_idx" ON "customer_collaboration"("customer_id");

-- CreateIndex
CREATE INDEX "customer_collaboration_user_id_idx" ON "customer_collaboration"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_collaboration_customer_id_user_id_key" ON "customer_collaboration"("customer_id", "user_id");

-- CreateIndex
CREATE INDEX "customer_relation_source_customer_id_idx" ON "customer_relation"("source_customer_id");

-- CreateIndex
CREATE INDEX "customer_relation_target_customer_id_idx" ON "customer_relation"("target_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_relation_source_customer_id_target_customer_id_key" ON "customer_relation"("source_customer_id", "target_customer_id");

-- CreateIndex
CREATE INDEX "customer_pool_organization_id_idx" ON "customer_pool"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_pool_pick_rule_pool_id_key" ON "customer_pool_pick_rule"("pool_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_pool_recycle_rule_pool_id_key" ON "customer_pool_recycle_rule"("pool_id");

-- CreateIndex
CREATE INDEX "customer_capacity_organization_id_idx" ON "customer_capacity"("organization_id");

-- CreateIndex
CREATE INDEX "clue_organization_id_idx" ON "clue"("organization_id");

-- CreateIndex
CREATE INDEX "clue_pool_id_idx" ON "clue"("pool_id");

-- CreateIndex
CREATE INDEX "clue_follower_idx" ON "clue"("follower");

-- CreateIndex
CREATE INDEX "clue_follow_time_idx" ON "clue"("follow_time");

-- CreateIndex
CREATE INDEX "clue_phone_idx" ON "clue"("phone");

-- CreateIndex
CREATE INDEX "clue_reason_id_idx" ON "clue"("reason_id");

-- CreateIndex
CREATE INDEX "clue_field_resource_id_field_id_field_value_idx" ON "clue_field"("resource_id", "field_id", "field_value");

-- CreateIndex
CREATE UNIQUE INDEX "clue_field_resource_id_field_id_key" ON "clue_field"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "clue_field_blob_resource_id_idx" ON "clue_field_blob"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "clue_field_blob_resource_id_field_id_key" ON "clue_field_blob"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "clue_owner_clue_id_idx" ON "clue_owner"("clue_id");

-- CreateIndex
CREATE INDEX "clue_pool_organization_id_idx" ON "clue_pool"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "clue_pool_pick_rule_pool_id_key" ON "clue_pool_pick_rule"("pool_id");

-- CreateIndex
CREATE UNIQUE INDEX "clue_pool_recycle_rule_pool_id_key" ON "clue_pool_recycle_rule"("pool_id");

-- CreateIndex
CREATE INDEX "clue_capacity_organization_id_idx" ON "clue_capacity"("organization_id");

-- CreateIndex
CREATE INDEX "sys_module_form_organization_id_idx" ON "sys_module_form"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_module_form_organization_id_form_key_key" ON "sys_module_form"("organization_id", "form_key");

-- CreateIndex
CREATE INDEX "sys_module_field_form_id_internal_key_idx" ON "sys_module_field"("form_id", "internal_key");

-- CreateIndex
CREATE INDEX "sys_module_field_mobile_idx" ON "sys_module_field"("mobile");

-- CreateIndex
CREATE INDEX "sys_user_view_user_id_idx" ON "sys_user_view"("user_id");

-- CreateIndex
CREATE INDEX "sys_user_view_name_idx" ON "sys_user_view"("name");

-- CreateIndex
CREATE INDEX "sys_user_view_resource_type_idx" ON "sys_user_view"("resource_type");

-- CreateIndex
CREATE INDEX "sys_user_view_organization_id_idx" ON "sys_user_view"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_view_organization_id_user_id_resource_type_name_key" ON "sys_user_view"("organization_id", "user_id", "resource_type", "name");

-- CreateIndex
CREATE INDEX "sys_user_view_condition_sys_user_view_id_idx" ON "sys_user_view_condition"("sys_user_view_id");

-- CreateIndex
CREATE INDEX "dashboard_module_organization_id_idx" ON "dashboard_module"("organization_id");

-- CreateIndex
CREATE INDEX "dashboard_module_name_idx" ON "dashboard_module"("name");

-- CreateIndex
CREATE INDEX "dashboard_module_pos_idx" ON "dashboard_module"("pos");

-- CreateIndex
CREATE INDEX "dashboard_module_parent_id_idx" ON "dashboard_module"("parent_id");

-- CreateIndex
CREATE INDEX "dashboard_name_idx" ON "dashboard"("name");

-- CreateIndex
CREATE INDEX "dashboard_dashboard_module_id_idx" ON "dashboard"("dashboard_module_id");

-- CreateIndex
CREATE INDEX "dashboard_organization_id_idx" ON "dashboard"("organization_id");

-- CreateIndex
CREATE INDEX "dashboard_collection_user_id_idx" ON "dashboard_collection"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_collection_user_id_dashboard_id_key" ON "dashboard_collection"("user_id", "dashboard_id");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "customer_pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_field" ADD CONSTRAINT "customer_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_field_blob" ADD CONSTRAINT "customer_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_owner" ADD CONSTRAINT "customer_owner_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact" ADD CONSTRAINT "customer_contact_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_field" ADD CONSTRAINT "customer_contact_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "customer_contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact_field_blob" ADD CONSTRAINT "customer_contact_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "customer_contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_collaboration" ADD CONSTRAINT "customer_collaboration_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_relation" ADD CONSTRAINT "customer_relation_source_customer_id_fkey" FOREIGN KEY ("source_customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_relation" ADD CONSTRAINT "customer_relation_target_customer_id_fkey" FOREIGN KEY ("target_customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pool_hidden_field" ADD CONSTRAINT "customer_pool_hidden_field_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "customer_pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pool_pick_rule" ADD CONSTRAINT "customer_pool_pick_rule_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "customer_pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pool_recycle_rule" ADD CONSTRAINT "customer_pool_recycle_rule_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "customer_pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clue" ADD CONSTRAINT "clue_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "clue_pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clue_field" ADD CONSTRAINT "clue_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "clue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clue_field_blob" ADD CONSTRAINT "clue_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "clue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clue_owner" ADD CONSTRAINT "clue_owner_clue_id_fkey" FOREIGN KEY ("clue_id") REFERENCES "clue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clue_pool_hidden_field" ADD CONSTRAINT "clue_pool_hidden_field_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "clue_pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clue_pool_pick_rule" ADD CONSTRAINT "clue_pool_pick_rule_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "clue_pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clue_pool_recycle_rule" ADD CONSTRAINT "clue_pool_recycle_rule_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "clue_pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "customer_contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_module_form_blob" ADD CONSTRAINT "sys_module_form_blob_id_fkey" FOREIGN KEY ("id") REFERENCES "sys_module_form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_module_field" ADD CONSTRAINT "sys_module_field_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "sys_module_form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_module_field_blob" ADD CONSTRAINT "sys_module_field_blob_id_fkey" FOREIGN KEY ("id") REFERENCES "sys_module_field"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_user_view_condition" ADD CONSTRAINT "sys_user_view_condition_sys_user_view_id_fkey" FOREIGN KEY ("sys_user_view_id") REFERENCES "sys_user_view"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_dashboard_module_id_fkey" FOREIGN KEY ("dashboard_module_id") REFERENCES "dashboard_module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_collection" ADD CONSTRAINT "dashboard_collection_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
