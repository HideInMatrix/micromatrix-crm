-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "EnterpriseIntegrationProvider" AS ENUM ('WECOM', 'DINGTALK', 'LARK');

-- CreateEnum
CREATE TYPE "ExternalIdentityStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ExternalOAuthFlow" AS ENUM ('QR_WECOM', 'WECOM');

-- CreateEnum
CREATE TYPE "MessageDeliveryChannel" AS ENUM ('WECOM', 'DINGTALK', 'LARK', 'EMAIL');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "OrganizationSyncStatus" AS ENUM ('FETCHING', 'PREVIEW_READY', 'APPLYING', 'SUCCEEDED', 'FAILED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "OrganizationSyncResourceType" AS ENUM ('DEPARTMENT', 'USER');

-- CreateEnum
CREATE TYPE "OrganizationSyncAction" AS ENUM ('CREATE', 'UPDATE', 'DISABLE', 'UNCHANGED', 'CONFLICT', 'SKIP');

-- CreateEnum
CREATE TYPE "OrganizationSyncItemResult" AS ENUM ('PENDING', 'RESOLVED', 'APPLIED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrganizationSyncResolution" AS ENUM ('BIND', 'SKIP');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('ALL', 'DEPT_AND_CHILD', 'DEPT', 'SELF', 'CUSTOM');

-- CreateEnum
CREATE TYPE "OperationLogCleanupSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "FollowUpPlanStatus" AS ENUM ('PREPARED', 'UNDERWAY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('USER', 'ROLE', 'DEPT_LEADER', 'DIRECT_LEADER', 'MULTIPLE_DEPT_LEADER', 'MULTIPLE_DIRECT_LEADER');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('ALL', 'ANY');

-- CreateEnum
CREATE TYPE "EmptyApproverAction" AS ENUM ('AUTO_PASS', 'ASSIGN_SPECIFIC', 'ASSIGN_ADMIN');

-- CreateEnum
CREATE TYPE "SameSubmitterAction" AS ENUM ('SKIP', 'ALLOW', 'ASSIGN_SUPERIOR');

-- CreateEnum
CREATE TYPE "ApproverDirection" AS ENUM ('BOTTOM_UP', 'TOP_DOWN');

-- CreateEnum
CREATE TYPE "ApprovalFormType" AS ENUM ('QUOTATION', 'CONTRACT', 'INVOICE', 'ORDER', 'RECEIVABLE_RECORD_LEGACY');

-- CreateEnum
CREATE TYPE "ApprovalExecuteTiming" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "ApprovalNodeType" AS ENUM ('START', 'APPROVER', 'CONDITION', 'DEFAULT', 'END');

-- CreateEnum
CREATE TYPE "DuplicateApproverRule" AS ENUM ('FIRST_ONLY', 'SEQUENTIAL_ALL', 'EACH');

-- CreateEnum
CREATE TYPE "ApprovalInstanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ApprovalTaskStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApprovalTaskType" AS ENUM ('APPROVAL', 'CC', 'SIGN', 'BACK');

-- CreateEnum
CREATE TYPE "ApprovalTaskAction" AS ENUM ('APPROVE', 'REJECT', 'SIGN', 'BACK');

-- CreateEnum
CREATE TYPE "ApprovalAddSignType" AS ENUM ('BEFORE', 'AFTER');

-- CreateEnum
CREATE TYPE "ApprovalWebhookDeliverySource" AS ENUM ('TEST', 'RUNTIME');

-- CreateEnum
CREATE TYPE "ApprovalWebhookDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "leaderId" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "deptId" TEXT,
    "leaderId" TEXT,
    "position" TEXT,
    "phone" TEXT,
    "gender" BOOLEAN NOT NULL DEFAULT false,
    "passwordLoginEnabled" BOOLEAN NOT NULL DEFAULT true,
    "default_pwd" BOOLEAN NOT NULL DEFAULT false,
    "auth_version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_key" (
    "id" TEXT NOT NULL,
    "create_user" TEXT NOT NULL,
    "access_key" TEXT NOT NULL,
    "secret_key" TEXT NOT NULL,
    "create_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "forever" BOOLEAN NOT NULL DEFAULT true,
    "expire_time" TIMESTAMP(3),
    "description" TEXT,

    CONSTRAINT "user_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_extensions" (
    "id" TEXT NOT NULL,
    "avatar" TEXT,
    "platformInfo" BYTEA,

    CONSTRAINT "user_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataScope" "DataScope" NOT NULL DEFAULT 'SELF',
    "scopeDeptIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "sys_dict" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "module" VARCHAR(20) NOT NULL,
    "type" VARCHAR(10) NOT NULL DEFAULT 'TEXT',
    "pos" BIGINT NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "sys_dict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_dict_config" (
    "module" VARCHAR(20) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sys_dict_config_pkey" PRIMARY KEY ("module","organization_id")
);

-- CreateTable
CREATE TABLE "follow_up_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "nextFollowAt" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "contactId" TEXT,
    "content" TEXT NOT NULL,
    "method" TEXT,
    "estimatedAt" TIMESTAMP(3),
    "status" "FollowUpPlanStatus" NOT NULL DEFAULT 'PREPARED',
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "convertedRecordId" TEXT,
    "ownerId" TEXT NOT NULL,
    "deptId" TEXT,
    "createdById" TEXT NOT NULL,
    "dueNotifiedAt" TIMESTAMP(3),
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_plan_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" TEXT NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "follow_up_plan_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_plan_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" TEXT NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "follow_up_plan_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "opportunity_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "opportunity_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "opportunity_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "product_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "product_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "product_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "opportunity_quotation_snapshot" (
    "id" VARCHAR(32) NOT NULL,
    "quotation_id" VARCHAR(32) NOT NULL,
    "quotation_prop" TEXT,
    "quotation_value" TEXT,

    CONSTRAINT "opportunity_quotation_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "customer_id" VARCHAR(32) NOT NULL,
    "owner" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "number" VARCHAR(50) NOT NULL,
    "approval_status" VARCHAR(50) NOT NULL DEFAULT 'NONE',
    "stage" VARCHAR(32) NOT NULL,
    "start_time" BIGINT,
    "end_time" BIGINT,
    "void_reason" VARCHAR(255),
    "organization_id" VARCHAR(32) NOT NULL,
    "pos" BIGINT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "contract_snapshot" (
    "id" VARCHAR(32) NOT NULL,
    "contract_id" VARCHAR(32) NOT NULL,
    "contract_prop" TEXT,
    "contract_value" TEXT,

    CONSTRAINT "contract_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "contract_payment_plan_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "contract_payment_plan_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_payment_plan_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "contract_payment_plan_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "contract_payment_record_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "contract_payment_record_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_payment_record_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "contract_payment_record_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "business_title_config" (
    "id" VARCHAR(32) NOT NULL,
    "field" VARCHAR(255) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "organization_id" VARCHAR(32) NOT NULL,

    CONSTRAINT "business_title_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "contract_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_invoice_field" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" VARCHAR(255) NOT NULL,

    CONSTRAINT "contract_invoice_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_invoice_field_blob" (
    "id" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(32) NOT NULL,
    "field_id" VARCHAR(32) NOT NULL,
    "field_value" TEXT NOT NULL,

    CONSTRAINT "contract_invoice_field_blob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_invoice_snapshot" (
    "id" VARCHAR(32) NOT NULL,
    "invoice_id" VARCHAR(32) NOT NULL,
    "invoice_prop" TEXT,
    "invoice_value" TEXT,

    CONSTRAINT "contract_invoice_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order" (
    "id" VARCHAR(32) NOT NULL,
    "number" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "customer_id" VARCHAR(32),
    "contract_id" VARCHAR(32),
    "owner" VARCHAR(32),
    "amount" DECIMAL(20,10),
    "stage" VARCHAR(50) NOT NULL,
    "approval_status" VARCHAR(50) NOT NULL DEFAULT 'NONE',
    "organization_id" VARCHAR(32) NOT NULL,
    "pos" BIGINT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "sales_order_snapshot" (
    "id" VARCHAR(32) NOT NULL,
    "order_id" VARCHAR(32) NOT NULL,
    "order_prop" TEXT,
    "order_value" TEXT,

    CONSTRAINT "sales_order_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "approval_flows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "formType" "ApprovalFormType" NOT NULL,
    "currentVersionId" TEXT,
    "name" TEXT NOT NULL,
    "createExecute" BOOLEAN NOT NULL DEFAULT true,
    "updateExecute" BOOLEAN NOT NULL DEFAULT false,
    "deleteExecute" BOOLEAN NOT NULL DEFAULT false,
    "submitterCanRevoke" BOOLEAN NOT NULL DEFAULT true,
    "allowBatchProcess" BOOLEAN NOT NULL DEFAULT false,
    "allowWithdraw" BOOLEAN NOT NULL DEFAULT false,
    "allowAddSign" BOOLEAN NOT NULL DEFAULT false,
    "duplicateApproverRule" "DuplicateApproverRule" NOT NULL DEFAULT 'FIRST_ONLY',
    "requireComment" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(1000),
    "condition" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_flow_number_counters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formType" "ApprovalFormType" NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_flow_number_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_flow_versions" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_nodes" (
    "id" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nodeType" "ApprovalNodeType" NOT NULL,
    "executeTiming" "ApprovalExecuteTiming" NOT NULL DEFAULT 'CREATE',
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "approval_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_node_approvers" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "approverType" "ApproverType" NOT NULL,
    "approverIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mode" "ApprovalMode" NOT NULL DEFAULT 'ANY',
    "empty_approver_action" "EmptyApproverAction" NOT NULL DEFAULT 'AUTO_PASS',
    "fallback_approver" TEXT,
    "same_submitter_action" "SameSubmitterAction" NOT NULL DEFAULT 'SKIP',
    "approver_direction" "ApproverDirection" NOT NULL DEFAULT 'BOTTOM_UP',
    "field_permissions" JSONB,
    "pass_post_config" JSONB,
    "reject_post_config" JSONB,

    CONSTRAINT "approval_node_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_node_conditions" (
    "id" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "condition_config" JSONB,

    CONSTRAINT "approval_node_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_node_links" (
    "id" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "approval_node_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_instances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "flowId" TEXT,
    "flowVersionId" TEXT,
    "executeTiming" "ApprovalExecuteTiming" NOT NULL DEFAULT 'CREATE',
    "module" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "summary" TEXT,
    "status" "ApprovalInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "currentNodeIndex" INTEGER NOT NULL DEFAULT 0,
    "nodesSnapshot" JSONB NOT NULL,
    "comment" TEXT,
    "update_fields" VARCHAR(2000),
    "submitterId" TEXT NOT NULL,
    "submitterName" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_resource_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formType" "ApprovalFormType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "snapshot_data" JSONB NOT NULL,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_resource_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "node_id" TEXT,
    "nodeIndex" INTEGER NOT NULL,
    "node_round" INTEGER NOT NULL DEFAULT 1,
    "nodeName" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "task_type" "ApprovalTaskType" NOT NULL DEFAULT 'APPROVAL',
    "status" "ApprovalTaskStatus" NOT NULL DEFAULT 'PENDING',
    "action" "ApprovalTaskAction",
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_add_sign_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "sign_task_id" TEXT NOT NULL,
    "type" "ApprovalAddSignType" NOT NULL,
    "root_task_id" TEXT NOT NULL,
    "sort" BIGINT NOT NULL,
    "comment" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_add_sign_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "taskId" TEXT,
    "node_id" TEXT,
    "node_round" INTEGER NOT NULL DEFAULT 1,
    "result" "ApprovalTaskAction" NOT NULL,
    "comment" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_return_back_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "return_to_node_id" TEXT NOT NULL,
    "return_reason" TEXT,
    "return_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_return_back_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_instance_attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "element_id" TEXT NOT NULL,
    "attachment_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_instance_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "instance_id" TEXT,
    "flow_id" TEXT,
    "flow_version_id" TEXT,
    "node_id" TEXT,
    "node_index" INTEGER,
    "action" TEXT,
    "source" "ApprovalWebhookDeliverySource" NOT NULL,
    "method" TEXT NOT NULL,
    "target_origin" TEXT NOT NULL,
    "target_path" TEXT NOT NULL,
    "status" "ApprovalWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "http_status" INTEGER,
    "response_bytes" INTEGER,
    "duration_ms" INTEGER,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(500),
    "created_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bidding_sources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credentials" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastFetchAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bidding_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bidding_keyword_subs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bidding_keyword_subs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bidding_infos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "region" TEXT,
    "buyer" TEXT,
    "budget" DECIMAL(16,2),
    "publishedAt" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "content" TEXT,
    "source" TEXT,
    "keyword" TEXT,
    "hash" TEXT NOT NULL,
    "convertedLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bidding_infos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maxUsers" INTEGER NOT NULL DEFAULT 10,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "operation_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "targetName" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_log_blobs" (
    "operationLogId" TEXT NOT NULL,
    "detail" JSONB NOT NULL,

    CONSTRAINT "operation_log_blobs_pkey" PRIMARY KEY ("operationLogId")
);

-- CreateTable
CREATE TABLE "operation_log_settings" (
    "tenantId" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "lastCleanupAt" TIMESTAMP(3),
    "lastCleanupDeleted" INTEGER NOT NULL DEFAULT 0,
    "lastCleanupSource" "OperationLogCleanupSource",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operation_log_settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "login_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'PASSWORD',
    "externalSubject" TEXT,
    "externalIdentityId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_task_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "systemEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weComEnabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_task_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_ui_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'default',
    "customTheme" TEXT NOT NULL DEFAULT '#008d91',
    "style" TEXT NOT NULL DEFAULT 'default',
    "customStyle" TEXT NOT NULL DEFAULT '#f9fbfb',
    "title" TEXT NOT NULL DEFAULT 'MicroMatrix CRM',
    "slogan" TEXT NOT NULL DEFAULT '让客户关系更清晰，让销售协作更高效',
    "helpDoc" TEXT NOT NULL DEFAULT '',
    "iconAttachmentId" TEXT,
    "loginLogoAttachmentId" TEXT,
    "loginImageAttachmentId" TEXT,
    "platformLogoAttachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_ui_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_mail_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "account" TEXT NOT NULL,
    "passwordCiphertext" TEXT,
    "passwordIv" TEXT,
    "passwordAuthTag" TEXT,
    "passwordKeyVersion" INTEGER,
    "fromAddress" TEXT NOT NULL DEFAULT '',
    "recipient" TEXT NOT NULL DEFAULT '',
    "ssl" BOOLEAN NOT NULL DEFAULT false,
    "tls" BOOLEAN NOT NULL DEFAULT false,
    "lastTestSucceeded" BOOLEAN,
    "lastTestMessage" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_mail_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_ai_models" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT,
    "apiKeyIv" TEXT,
    "apiKeyAuthTag" TEXT,
    "apiKeyKeyVersion" INTEGER,
    "enable" BOOLEAN NOT NULL DEFAULT false,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 2048,
    "topP" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "globalDailyLimit" INTEGER,
    "userDailyLimit" INTEGER,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_ai_model_routes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_ai_model_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_term_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_term_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_terms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "standardTerm" TEXT NOT NULL,
    "alsoCalled" TEXT NOT NULL DEFAULT '',
    "avoidThese" TEXT NOT NULL DEFAULT '',
    "useCase" TEXT NOT NULL DEFAULT '',
    "systemReference" TEXT NOT NULL DEFAULT '',
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_term_discoveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "discovered" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "context" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adoptedTermId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_term_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_global_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'manual',
    "executionCondition" TEXT NOT NULL DEFAULT '',
    "executionAction" TEXT NOT NULL DEFAULT '',
    "confirmationLevel" TEXT NOT NULL DEFAULT 'ask',
    "applicableModelId" TEXT,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_global_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_global_task_executions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_global_task_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_integrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "EnterpriseIntegrationProvider" NOT NULL,
    "corpId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "secretIv" TEXT NOT NULL,
    "secretAuthTag" TEXT NOT NULL,
    "secretKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncDefaultRoleId" TEXT,
    "lastTestSucceeded" BOOLEAN,
    "lastTestMessage" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastSyncStatus" "OrganizationSyncStatus",
    "lastSyncMessage" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_department_mappings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "EnterpriseIntegrationProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_department_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_user_mappings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "EnterpriseIntegrationProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_user_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_identities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "provider" "EnterpriseIntegrationProvider" NOT NULL,
    "externalSubject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ExternalIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "bindingSource" TEXT NOT NULL DEFAULT 'LOGIN',
    "boundById" TEXT,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_oauth_states" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "flow" "ExternalOAuthFlow" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "browserNonceHash" TEXT NOT NULL,
    "returnPath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT,
    "channel" "MessageDeliveryChannel" NOT NULL,
    "event" TEXT NOT NULL,
    "userId" TEXT,
    "externalSubject" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "link" TEXT,
    "status" "MessageDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_sync_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "provider" "EnterpriseIntegrationProvider" NOT NULL,
    "status" "OrganizationSyncStatus" NOT NULL,
    "targetDepartmentId" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "counts" JSONB NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "appliedById" TEXT,
    "fetchStartedAt" TIMESTAMP(3),
    "previewedAt" TIMESTAMP(3),
    "applyStartedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_sync_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "resourceType" "OrganizationSyncResourceType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "action" "OrganizationSyncAction" NOT NULL,
    "result" "OrganizationSyncItemResult" NOT NULL DEFAULT 'PENDING',
    "localId" TEXT,
    "parentExternalKey" TEXT,
    "sourceData" JSONB NOT NULL,
    "changes" JSONB,
    "conflictType" TEXT,
    "conflictMessage" TEXT,
    "resolution" "OrganizationSyncResolution",
    "resolvedLocalId" TEXT,
    "errorMessage" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_sync_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "module_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top_navigation_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "top_navigation_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uploaderId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "mime" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "fileSize" INTEGER,
    "errorMessage" TEXT,
    "payload" JSONB,
    "startedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "departments_tenantId_idx" ON "departments"("tenantId");

-- CreateIndex
CREATE INDEX "departments_tenantId_parentId_idx" ON "departments"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE INDEX "users_tenantId_deptId_idx" ON "users"("tenantId", "deptId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_key_access_key_key" ON "user_key"("access_key");

-- CreateIndex
CREATE INDEX "user_key_create_user_idx" ON "user_key"("create_user");

-- CreateIndex
CREATE INDEX "roles_tenantId_idx" ON "roles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_name_key" ON "roles"("tenantId", "name");

-- CreateIndex
CREATE INDEX "user_roles_tenantId_roleId_idx" ON "user_roles"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "user_roles_tenantId_userId_idx" ON "user_roles"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

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
CREATE INDEX "sys_dict_organization_id_module_pos_idx" ON "sys_dict"("organization_id", "module", "pos");

-- CreateIndex
CREATE INDEX "sys_dict_organization_id_name_idx" ON "sys_dict"("organization_id", "name");

-- CreateIndex
CREATE INDEX "follow_up_records_tenantId_targetType_targetId_idx" ON "follow_up_records"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "follow_up_plans_tenantId_targetType_targetId_idx" ON "follow_up_plans"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "follow_up_plans_tenantId_ownerId_status_idx" ON "follow_up_plans"("tenantId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "follow_up_plans_tenantId_estimatedAt_status_idx" ON "follow_up_plans"("tenantId", "estimatedAt", "status");

-- CreateIndex
CREATE INDEX "follow_up_plan_field_resource_id_field_id_field_value_idx" ON "follow_up_plan_field"("resource_id", "field_id", "field_value");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_plan_field_resource_id_field_id_key" ON "follow_up_plan_field"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "follow_up_plan_field_blob_resource_id_idx" ON "follow_up_plan_field_blob"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_plan_field_blob_resource_id_field_id_key" ON "follow_up_plan_field_blob"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "opportunity_stage_config_organization_id_idx" ON "opportunity_stage_config"("organization_id");

-- CreateIndex
CREATE INDEX "opportunity_stage_config_organization_id_pos_idx" ON "opportunity_stage_config"("organization_id", "pos");

-- CreateIndex
CREATE INDEX "opportunity_customer_id_idx" ON "opportunity"("customer_id");

-- CreateIndex
CREATE INDEX "opportunity_organization_id_idx" ON "opportunity"("organization_id");

-- CreateIndex
CREATE INDEX "opportunity_stage_idx" ON "opportunity"("stage");

-- CreateIndex
CREATE INDEX "opportunity_owner_idx" ON "opportunity"("owner");

-- CreateIndex
CREATE INDEX "opportunity_follower_idx" ON "opportunity"("follower");

-- CreateIndex
CREATE INDEX "opportunity_follow_time_idx" ON "opportunity"("follow_time");

-- CreateIndex
CREATE INDEX "opportunity_field_resource_id_field_id_field_value_idx" ON "opportunity_field"("resource_id", "field_id", "field_value");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_field_resource_id_field_id_key" ON "opportunity_field"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "opportunity_field_blob_resource_id_idx" ON "opportunity_field_blob"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_field_blob_resource_id_field_id_key" ON "opportunity_field_blob"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "opportunity_rule_organization_id_idx" ON "opportunity_rule"("organization_id");

-- CreateIndex
CREATE INDEX "product_organization_id_idx" ON "product"("organization_id");

-- CreateIndex
CREATE INDEX "product_name_idx" ON "product"("name");

-- CreateIndex
CREATE INDEX "product_organization_id_pos_idx" ON "product"("organization_id", "pos");

-- CreateIndex
CREATE INDEX "product_field_resource_id_field_id_field_value_idx" ON "product_field"("resource_id", "field_id", "field_value");

-- CreateIndex
CREATE UNIQUE INDEX "product_field_resource_id_field_id_key" ON "product_field"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "product_field_blob_resource_id_idx" ON "product_field_blob"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_field_blob_resource_id_field_id_key" ON "product_field_blob"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "product_price_organization_id_idx" ON "product_price"("organization_id");

-- CreateIndex
CREATE INDEX "product_price_status_idx" ON "product_price"("status");

-- CreateIndex
CREATE INDEX "product_price_organization_id_pos_idx" ON "product_price"("organization_id", "pos");

-- CreateIndex
CREATE INDEX "product_price_field_resource_id_idx" ON "product_price_field"("resource_id");

-- CreateIndex
CREATE INDEX "product_price_field_ref_sub_id_idx" ON "product_price_field"("ref_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_price_field_cell" ON "product_price_field"("resource_id", "ref_sub_id", "row_id", "field_id");

-- CreateIndex
CREATE INDEX "product_price_field_blob_resource_id_idx" ON "product_price_field_blob"("resource_id");

-- CreateIndex
CREATE INDEX "product_price_field_blob_ref_sub_id_idx" ON "product_price_field_blob"("ref_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_price_field_blob_cell" ON "product_price_field_blob"("resource_id", "ref_sub_id", "row_id", "field_id");

-- CreateIndex
CREATE INDEX "opportunity_quotation_opportunity_id_idx" ON "opportunity_quotation"("opportunity_id");

-- CreateIndex
CREATE INDEX "opportunity_quotation_organization_id_idx" ON "opportunity_quotation"("organization_id");

-- CreateIndex
CREATE INDEX "opportunity_quotation_approval_status_idx" ON "opportunity_quotation"("approval_status");

-- CreateIndex
CREATE INDEX "opportunity_quotation_create_user_idx" ON "opportunity_quotation"("create_user");

-- CreateIndex
CREATE INDEX "opportunity_quotation_field_resource_id_idx" ON "opportunity_quotation_field"("resource_id");

-- CreateIndex
CREATE INDEX "opportunity_quotation_field_ref_sub_id_idx" ON "opportunity_quotation_field"("ref_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_opp_quotation_field_cell" ON "opportunity_quotation_field"("resource_id", "ref_sub_id", "row_id", "field_id");

-- CreateIndex
CREATE INDEX "opportunity_quotation_field_blob_resource_id_idx" ON "opportunity_quotation_field_blob"("resource_id");

-- CreateIndex
CREATE INDEX "opportunity_quotation_field_blob_ref_sub_id_idx" ON "opportunity_quotation_field_blob"("ref_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_opp_quotation_field_blob_cell" ON "opportunity_quotation_field_blob"("resource_id", "ref_sub_id", "row_id", "field_id");

-- CreateIndex
CREATE INDEX "opportunity_quotation_snapshot_quotation_id_idx" ON "opportunity_quotation_snapshot"("quotation_id");

-- CreateIndex
CREATE INDEX "contract_name_idx" ON "contract"("name");

-- CreateIndex
CREATE INDEX "contract_customer_id_idx" ON "contract"("customer_id");

-- CreateIndex
CREATE INDEX "contract_owner_idx" ON "contract"("owner");

-- CreateIndex
CREATE INDEX "contract_number_idx" ON "contract"("number");

-- CreateIndex
CREATE INDEX "contract_organization_id_idx" ON "contract"("organization_id");

-- CreateIndex
CREATE INDEX "contract_approval_status_idx" ON "contract"("approval_status");

-- CreateIndex
CREATE INDEX "contract_stage_idx" ON "contract"("stage");

-- CreateIndex
CREATE INDEX "contract_create_user_idx" ON "contract"("create_user");

-- CreateIndex
CREATE INDEX "contract_field_resource_id_idx" ON "contract_field"("resource_id");

-- CreateIndex
CREATE INDEX "contract_field_ref_sub_id_idx" ON "contract_field"("ref_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_contract_field_cell" ON "contract_field"("resource_id", "ref_sub_id", "row_id", "field_id");

-- CreateIndex
CREATE INDEX "contract_field_blob_resource_id_idx" ON "contract_field_blob"("resource_id");

-- CreateIndex
CREATE INDEX "contract_field_blob_ref_sub_id_idx" ON "contract_field_blob"("ref_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_contract_field_blob_cell" ON "contract_field_blob"("resource_id", "ref_sub_id", "row_id", "field_id");

-- CreateIndex
CREATE INDEX "contract_snapshot_contract_id_idx" ON "contract_snapshot"("contract_id");

-- CreateIndex
CREATE INDEX "contract_stage_config_organization_id_pos_idx" ON "contract_stage_config"("organization_id", "pos");

-- CreateIndex
CREATE INDEX "idx_stage_advanced_type" ON "stage_advanced_config"("module_type");

-- CreateIndex
CREATE INDEX "stage_advanced_config_organization_id_module_type_idx" ON "stage_advanced_config"("organization_id", "module_type");

-- CreateIndex
CREATE UNIQUE INDEX "uk_stage_advanced_transition" ON "stage_advanced_config"("organization_id", "module_type", "origin_id", "target_id");

-- CreateIndex
CREATE INDEX "contract_payment_plan_contract_id_idx" ON "contract_payment_plan"("contract_id");

-- CreateIndex
CREATE INDEX "contract_payment_plan_owner_idx" ON "contract_payment_plan"("owner");

-- CreateIndex
CREATE INDEX "contract_payment_plan_organization_id_idx" ON "contract_payment_plan"("organization_id");

-- CreateIndex
CREATE INDEX "contract_payment_plan_plan_end_time_idx" ON "contract_payment_plan"("plan_end_time");

-- CreateIndex
CREATE INDEX "contract_payment_plan_create_user_idx" ON "contract_payment_plan"("create_user");

-- CreateIndex
CREATE INDEX "contract_payment_plan_field_resource_id_field_id_field_valu_idx" ON "contract_payment_plan_field"("resource_id", "field_id", "field_value");

-- CreateIndex
CREATE UNIQUE INDEX "contract_payment_plan_field_resource_id_field_id_key" ON "contract_payment_plan_field"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "contract_payment_plan_field_blob_resource_id_idx" ON "contract_payment_plan_field_blob"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_payment_plan_field_blob_resource_id_field_id_key" ON "contract_payment_plan_field_blob"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "contract_payment_record_contract_id_idx" ON "contract_payment_record"("contract_id");

-- CreateIndex
CREATE INDEX "contract_payment_record_payment_plan_id_idx" ON "contract_payment_record"("payment_plan_id");

-- CreateIndex
CREATE INDEX "contract_payment_record_owner_idx" ON "contract_payment_record"("owner");

-- CreateIndex
CREATE INDEX "contract_payment_record_organization_id_idx" ON "contract_payment_record"("organization_id");

-- CreateIndex
CREATE INDEX "contract_payment_record_create_user_idx" ON "contract_payment_record"("create_user");

-- CreateIndex
CREATE INDEX "contract_payment_record_field_resource_id_field_id_field_va_idx" ON "contract_payment_record_field"("resource_id", "field_id", "field_value");

-- CreateIndex
CREATE UNIQUE INDEX "contract_payment_record_field_resource_id_field_id_key" ON "contract_payment_record_field"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "contract_payment_record_field_blob_resource_id_idx" ON "contract_payment_record_field_blob"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_payment_record_field_blob_resource_id_field_id_key" ON "contract_payment_record_field_blob"("resource_id", "field_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_title_company_number_key" ON "business_title"("company_number");

-- CreateIndex
CREATE INDEX "business_title_organization_id_idx" ON "business_title"("organization_id");

-- CreateIndex
CREATE INDEX "business_title_name_idx" ON "business_title"("name");

-- CreateIndex
CREATE INDEX "business_title_config_organization_id_idx" ON "business_title_config"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_title_config_organization_id_field_key" ON "business_title_config"("organization_id", "field");

-- CreateIndex
CREATE INDEX "contract_invoice_contract_id_idx" ON "contract_invoice"("contract_id");

-- CreateIndex
CREATE INDEX "contract_invoice_owner_idx" ON "contract_invoice"("owner");

-- CreateIndex
CREATE INDEX "contract_invoice_organization_id_idx" ON "contract_invoice"("organization_id");

-- CreateIndex
CREATE INDEX "contract_invoice_approval_status_idx" ON "contract_invoice"("approval_status");

-- CreateIndex
CREATE INDEX "contract_invoice_create_user_idx" ON "contract_invoice"("create_user");

-- CreateIndex
CREATE INDEX "contract_invoice_field_resource_id_field_id_field_value_idx" ON "contract_invoice_field"("resource_id", "field_id", "field_value");

-- CreateIndex
CREATE UNIQUE INDEX "contract_invoice_field_resource_id_field_id_key" ON "contract_invoice_field"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "contract_invoice_field_blob_resource_id_idx" ON "contract_invoice_field_blob"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_invoice_field_blob_resource_id_field_id_key" ON "contract_invoice_field_blob"("resource_id", "field_id");

-- CreateIndex
CREATE INDEX "contract_invoice_snapshot_invoice_id_idx" ON "contract_invoice_snapshot"("invoice_id");

-- CreateIndex
CREATE INDEX "sales_order_customer_id_idx" ON "sales_order"("customer_id");

-- CreateIndex
CREATE INDEX "sales_order_contract_id_idx" ON "sales_order"("contract_id");

-- CreateIndex
CREATE INDEX "sales_order_owner_idx" ON "sales_order"("owner");

-- CreateIndex
CREATE INDEX "sales_order_name_idx" ON "sales_order"("name");

-- CreateIndex
CREATE INDEX "sales_order_number_idx" ON "sales_order"("number");

-- CreateIndex
CREATE INDEX "sales_order_organization_id_idx" ON "sales_order"("organization_id");

-- CreateIndex
CREATE INDEX "sales_order_approval_status_idx" ON "sales_order"("approval_status");

-- CreateIndex
CREATE INDEX "sales_order_stage_idx" ON "sales_order"("stage");

-- CreateIndex
CREATE INDEX "sales_order_create_user_idx" ON "sales_order"("create_user");

-- CreateIndex
CREATE INDEX "sales_order_field_resource_id_idx" ON "sales_order_field"("resource_id");

-- CreateIndex
CREATE INDEX "sales_order_field_ref_sub_id_idx" ON "sales_order_field"("ref_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_order_field_cell" ON "sales_order_field"("resource_id", "ref_sub_id", "row_id", "field_id");

-- CreateIndex
CREATE INDEX "sales_order_field_blob_resource_id_idx" ON "sales_order_field_blob"("resource_id");

-- CreateIndex
CREATE INDEX "sales_order_field_blob_ref_sub_id_idx" ON "sales_order_field_blob"("ref_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "uk_order_field_blob_cell" ON "sales_order_field_blob"("resource_id", "ref_sub_id", "row_id", "field_id");

-- CreateIndex
CREATE INDEX "sales_order_snapshot_order_id_idx" ON "sales_order_snapshot"("order_id");

-- CreateIndex
CREATE INDEX "sales_order_stage_config_organization_id_pos_idx" ON "sales_order_stage_config"("organization_id", "pos");

-- CreateIndex
CREATE INDEX "approval_flows_tenantId_formType_deletedAt_idx" ON "approval_flows"("tenantId", "formType", "deletedAt");

-- CreateIndex
CREATE INDEX "approval_flows_tenantId_enabled_deletedAt_idx" ON "approval_flows"("tenantId", "enabled", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "approval_flows_tenantId_number_key" ON "approval_flows"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "approval_flow_number_counters_tenantId_formType_key" ON "approval_flow_number_counters"("tenantId", "formType");

-- CreateIndex
CREATE INDEX "approval_flow_versions_tenantId_flowId_idx" ON "approval_flow_versions"("tenantId", "flowId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_flow_versions_flowId_version_key" ON "approval_flow_versions"("flowId", "version");

-- CreateIndex
CREATE INDEX "approval_nodes_flowVersionId_executeTiming_sort_idx" ON "approval_nodes"("flowVersionId", "executeTiming", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "approval_nodes_flowVersionId_number_key" ON "approval_nodes"("flowVersionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "approval_node_approvers_nodeId_key" ON "approval_node_approvers"("nodeId");

-- CreateIndex
CREATE INDEX "approval_node_conditions_flowVersionId_idx" ON "approval_node_conditions"("flowVersionId");

-- CreateIndex
CREATE INDEX "approval_node_links_flowVersionId_sort_idx" ON "approval_node_links"("flowVersionId", "sort");

-- CreateIndex
CREATE INDEX "approval_node_links_fromNodeId_idx" ON "approval_node_links"("fromNodeId");

-- CreateIndex
CREATE INDEX "approval_node_links_toNodeId_idx" ON "approval_node_links"("toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_node_links_flowVersionId_fromNodeId_toNodeId_key" ON "approval_node_links"("flowVersionId", "fromNodeId", "toNodeId");

-- CreateIndex
CREATE INDEX "approval_instances_tenantId_status_idx" ON "approval_instances"("tenantId", "status");

-- CreateIndex
CREATE INDEX "approval_instances_tenantId_module_targetId_idx" ON "approval_instances"("tenantId", "module", "targetId");

-- CreateIndex
CREATE INDEX "approval_instances_tenantId_submitterId_idx" ON "approval_instances"("tenantId", "submitterId");

-- CreateIndex
CREATE INDEX "approval_instances_flowId_status_idx" ON "approval_instances"("flowId", "status");

-- CreateIndex
CREATE INDEX "approval_instances_flowVersionId_idx" ON "approval_instances"("flowVersionId");

-- CreateIndex
CREATE INDEX "approval_resource_snapshots_tenantId_formType_idx" ON "approval_resource_snapshots"("tenantId", "formType");

-- CreateIndex
CREATE UNIQUE INDEX "approval_resource_snapshots_tenantId_formType_resourceId_key" ON "approval_resource_snapshots"("tenantId", "formType", "resourceId");

-- CreateIndex
CREATE INDEX "approval_tasks_tenantId_approverId_status_idx" ON "approval_tasks"("tenantId", "approverId", "status");

-- CreateIndex
CREATE INDEX "approval_tasks_tenantId_approverId_task_type_status_idx" ON "approval_tasks"("tenantId", "approverId", "task_type", "status");

-- CreateIndex
CREATE INDEX "approval_tasks_instanceId_idx" ON "approval_tasks"("instanceId");

-- CreateIndex
CREATE INDEX "approval_tasks_instanceId_nodeIndex_node_round_idx" ON "approval_tasks"("instanceId", "nodeIndex", "node_round");

-- CreateIndex
CREATE UNIQUE INDEX "approval_add_sign_tasks_task_id_key" ON "approval_add_sign_tasks"("task_id");

-- CreateIndex
CREATE INDEX "approval_add_sign_tasks_tenantId_instanceId_idx" ON "approval_add_sign_tasks"("tenantId", "instanceId");

-- CreateIndex
CREATE INDEX "approval_add_sign_tasks_root_task_id_sort_idx" ON "approval_add_sign_tasks"("root_task_id", "sort");

-- CreateIndex
CREATE INDEX "approval_add_sign_tasks_sign_task_id_idx" ON "approval_add_sign_tasks"("sign_task_id");

-- CreateIndex
CREATE INDEX "approval_records_tenantId_instanceId_created_at_idx" ON "approval_records"("tenantId", "instanceId", "created_at");

-- CreateIndex
CREATE INDEX "approval_records_taskId_idx" ON "approval_records"("taskId");

-- CreateIndex
CREATE INDEX "approval_return_back_records_tenantId_instance_id_created_a_idx" ON "approval_return_back_records"("tenantId", "instance_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_return_back_records_task_id_idx" ON "approval_return_back_records"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_return_back_records_instance_id_return_to_node_id_key" ON "approval_return_back_records"("instance_id", "return_to_node_id");

-- CreateIndex
CREATE INDEX "approval_instance_attachments_tenantId_instance_id_created__idx" ON "approval_instance_attachments"("tenantId", "instance_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_instance_attachments_element_id_idx" ON "approval_instance_attachments"("element_id");

-- CreateIndex
CREATE INDEX "approval_instance_attachments_attachment_id_idx" ON "approval_instance_attachments"("attachment_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instance_attachments_instance_id_element_id_attach_key" ON "approval_instance_attachments"("instance_id", "element_id", "attachment_id");

-- CreateIndex
CREATE INDEX "approval_webhook_deliveries_tenant_id_status_created_at_idx" ON "approval_webhook_deliveries"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approval_webhook_deliveries_tenant_id_instance_id_created_a_idx" ON "approval_webhook_deliveries"("tenant_id", "instance_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_webhook_deliveries_tenant_id_flow_id_created_at_idx" ON "approval_webhook_deliveries"("tenant_id", "flow_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bidding_sources_tenantId_provider_key" ON "bidding_sources"("tenantId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "bidding_keyword_subs_tenantId_keyword_key" ON "bidding_keyword_subs"("tenantId", "keyword");

-- CreateIndex
CREATE INDEX "bidding_infos_tenantId_publishedAt_idx" ON "bidding_infos"("tenantId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bidding_infos_tenantId_hash_key" ON "bidding_infos"("tenantId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "subscriptions_tenantId_idx" ON "subscriptions"("tenantId");

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

-- CreateIndex
CREATE INDEX "operation_logs_createdAt_idx" ON "operation_logs"("createdAt");

-- CreateIndex
CREATE INDEX "operation_logs_tenantId_createdAt_idx" ON "operation_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "operation_logs_tenantId_module_idx" ON "operation_logs"("tenantId", "module");

-- CreateIndex
CREATE INDEX "login_logs_tenantId_createdAt_idx" ON "login_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "login_logs_tenantId_authType_createdAt_idx" ON "login_logs"("tenantId", "authType", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_readAt_idx" ON "notifications"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "message_task_settings_tenantId_module_idx" ON "message_task_settings"("tenantId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "message_task_settings_tenantId_module_event_key" ON "message_task_settings"("tenantId", "module", "event");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_ui_settings_tenantId_key" ON "enterprise_ui_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_mail_settings_tenantId_key" ON "enterprise_mail_settings"("tenantId");

-- CreateIndex
CREATE INDEX "enterprise_ai_models_tenantId_enable_idx" ON "enterprise_ai_models"("tenantId", "enable");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_ai_models_tenantId_displayName_key" ON "enterprise_ai_models"("tenantId", "displayName");

-- CreateIndex
CREATE INDEX "enterprise_ai_model_routes_tenantId_idx" ON "enterprise_ai_model_routes"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_ai_model_routes_tenantId_modelId_key" ON "enterprise_ai_model_routes"("tenantId", "modelId");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_ai_model_routes_tenantId_sort_key" ON "enterprise_ai_model_routes"("tenantId", "sort");

-- CreateIndex
CREATE INDEX "enterprise_term_categories_tenantId_sort_idx" ON "enterprise_term_categories"("tenantId", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_term_categories_tenantId_name_key" ON "enterprise_term_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "enterprise_terms_tenantId_enable_idx" ON "enterprise_terms"("tenantId", "enable");

-- CreateIndex
CREATE INDEX "enterprise_terms_categoryId_idx" ON "enterprise_terms"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_terms_tenantId_categoryId_standardTerm_key" ON "enterprise_terms"("tenantId", "categoryId", "standardTerm");

-- CreateIndex
CREATE INDEX "enterprise_term_discoveries_tenantId_status_idx" ON "enterprise_term_discoveries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "enterprise_global_tasks_tenantId_enable_idx" ON "enterprise_global_tasks"("tenantId", "enable");

-- CreateIndex
CREATE INDEX "enterprise_global_tasks_applicableModelId_idx" ON "enterprise_global_tasks"("applicableModelId");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_global_tasks_tenantId_name_key" ON "enterprise_global_tasks"("tenantId", "name");

-- CreateIndex
CREATE INDEX "enterprise_global_task_executions_tenantId_createdAt_idx" ON "enterprise_global_task_executions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "enterprise_global_task_executions_taskId_createdAt_idx" ON "enterprise_global_task_executions"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "enterprise_integrations_tenantId_idx" ON "enterprise_integrations"("tenantId");

-- CreateIndex
CREATE INDEX "enterprise_integrations_syncDefaultRoleId_idx" ON "enterprise_integrations"("syncDefaultRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_integrations_tenantId_provider_key" ON "enterprise_integrations"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "external_department_mappings_tenantId_provider_active_idx" ON "external_department_mappings"("tenantId", "provider", "active");

-- CreateIndex
CREATE INDEX "external_department_mappings_lastSeenBatchId_idx" ON "external_department_mappings"("lastSeenBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "external_department_mappings_tenantId_provider_externalKey_key" ON "external_department_mappings"("tenantId", "provider", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "external_department_mappings_tenantId_provider_departmentId_key" ON "external_department_mappings"("tenantId", "provider", "departmentId");

-- CreateIndex
CREATE INDEX "external_user_mappings_tenantId_provider_active_idx" ON "external_user_mappings"("tenantId", "provider", "active");

-- CreateIndex
CREATE INDEX "external_user_mappings_lastSeenBatchId_idx" ON "external_user_mappings"("lastSeenBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "external_user_mappings_tenantId_provider_externalKey_key" ON "external_user_mappings"("tenantId", "provider", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "external_user_mappings_tenantId_provider_userId_key" ON "external_user_mappings"("tenantId", "provider", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_mappingId_key" ON "external_identities"("mappingId");

-- CreateIndex
CREATE INDEX "external_identities_tenantId_provider_status_idx" ON "external_identities"("tenantId", "provider", "status");

-- CreateIndex
CREATE INDEX "external_identities_integrationId_idx" ON "external_identities"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_tenantId_provider_externalSubject_key" ON "external_identities"("tenantId", "provider", "externalSubject");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_tenantId_provider_userId_key" ON "external_identities"("tenantId", "provider", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "external_oauth_states_stateHash_key" ON "external_oauth_states"("stateHash");

-- CreateIndex
CREATE INDEX "external_oauth_states_tenantId_flow_expiresAt_idx" ON "external_oauth_states"("tenantId", "flow", "expiresAt");

-- CreateIndex
CREATE INDEX "external_oauth_states_expiresAt_consumedAt_idx" ON "external_oauth_states"("expiresAt", "consumedAt");

-- CreateIndex
CREATE INDEX "message_deliveries_tenantId_status_nextAttemptAt_idx" ON "message_deliveries"("tenantId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "message_deliveries_tenantId_event_createdAt_idx" ON "message_deliveries"("tenantId", "event", "createdAt");

-- CreateIndex
CREATE INDEX "message_deliveries_tenantId_userId_createdAt_idx" ON "message_deliveries"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "organization_sync_batches_tenantId_provider_createdAt_idx" ON "organization_sync_batches"("tenantId", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "organization_sync_batches_tenantId_targetDepartmentId_creat_idx" ON "organization_sync_batches"("tenantId", "targetDepartmentId", "createdAt");

-- CreateIndex
CREATE INDEX "organization_sync_batches_integrationId_status_idx" ON "organization_sync_batches"("integrationId", "status");

-- CreateIndex
CREATE INDEX "organization_sync_items_tenantId_batchId_resourceType_actio_idx" ON "organization_sync_items"("tenantId", "batchId", "resourceType", "action");

-- CreateIndex
CREATE UNIQUE INDEX "organization_sync_items_batchId_resourceType_externalKey_key" ON "organization_sync_items"("batchId", "resourceType", "externalKey");

-- CreateIndex
CREATE INDEX "module_configs_tenantId_sort_idx" ON "module_configs"("tenantId", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "module_configs_tenantId_key_key" ON "module_configs"("tenantId", "key");

-- CreateIndex
CREATE INDEX "top_navigation_configs_tenantId_sort_idx" ON "top_navigation_configs"("tenantId", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "top_navigation_configs_tenantId_key_key" ON "top_navigation_configs"("tenantId", "key");

-- CreateIndex
CREATE INDEX "attachments_tenantId_targetType_targetId_idx" ON "attachments"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "export_tasks_tenantId_userId_createdAt_idx" ON "export_tasks"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "export_tasks_expiresAt_idx" ON "export_tasks"("expiresAt");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_key" ADD CONSTRAINT "user_key_create_user_fkey" FOREIGN KEY ("create_user") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_extensions" ADD CONSTRAINT "user_extensions_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "follow_up_plan_field" ADD CONSTRAINT "follow_up_plan_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "follow_up_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_plan_field_blob" ADD CONSTRAINT "follow_up_plan_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "follow_up_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "customer_contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_stage_fkey" FOREIGN KEY ("stage") REFERENCES "opportunity_stage_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_field" ADD CONSTRAINT "opportunity_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_field_blob" ADD CONSTRAINT "opportunity_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_field" ADD CONSTRAINT "product_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_field_blob" ADD CONSTRAINT "product_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_field" ADD CONSTRAINT "product_price_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "product_price"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_field_blob" ADD CONSTRAINT "product_price_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "product_price"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_quotation" ADD CONSTRAINT "opportunity_quotation_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_quotation_field" ADD CONSTRAINT "opportunity_quotation_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "opportunity_quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_quotation_field_blob" ADD CONSTRAINT "opportunity_quotation_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "opportunity_quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_quotation_snapshot" ADD CONSTRAINT "opportunity_quotation_snapshot_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "opportunity_quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_field" ADD CONSTRAINT "contract_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_field_blob" ADD CONSTRAINT "contract_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_snapshot" ADD CONSTRAINT "contract_snapshot_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payment_plan" ADD CONSTRAINT "contract_payment_plan_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payment_plan_field" ADD CONSTRAINT "contract_payment_plan_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "contract_payment_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payment_plan_field_blob" ADD CONSTRAINT "contract_payment_plan_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "contract_payment_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payment_record" ADD CONSTRAINT "contract_payment_record_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payment_record" ADD CONSTRAINT "contract_payment_record_payment_plan_id_fkey" FOREIGN KEY ("payment_plan_id") REFERENCES "contract_payment_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payment_record_field" ADD CONSTRAINT "contract_payment_record_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "contract_payment_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payment_record_field_blob" ADD CONSTRAINT "contract_payment_record_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "contract_payment_record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_invoice" ADD CONSTRAINT "contract_invoice_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_invoice" ADD CONSTRAINT "contract_invoice_business_title_id_fkey" FOREIGN KEY ("business_title_id") REFERENCES "business_title"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_invoice_field" ADD CONSTRAINT "contract_invoice_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "contract_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_invoice_field_blob" ADD CONSTRAINT "contract_invoice_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "contract_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_invoice_snapshot" ADD CONSTRAINT "contract_invoice_snapshot_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "contract_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_field" ADD CONSTRAINT "sales_order_field_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "sales_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_field_blob" ADD CONSTRAINT "sales_order_field_blob_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "sales_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_snapshot" ADD CONSTRAINT "sales_order_snapshot_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flows" ADD CONSTRAINT "approval_flows_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flow_versions" ADD CONSTRAINT "approval_flow_versions_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "approval_flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_nodes" ADD CONSTRAINT "approval_nodes_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_node_approvers" ADD CONSTRAINT "approval_node_approvers_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "approval_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_node_conditions" ADD CONSTRAINT "approval_node_conditions_id_fkey" FOREIGN KEY ("id") REFERENCES "approval_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_node_conditions" ADD CONSTRAINT "approval_node_conditions_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_node_links" ADD CONSTRAINT "approval_node_links_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_node_links" ADD CONSTRAINT "approval_node_links_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "approval_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_node_links" ADD CONSTRAINT "approval_node_links_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "approval_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "approval_flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "approval_flow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_add_sign_tasks" ADD CONSTRAINT "approval_add_sign_tasks_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_add_sign_tasks" ADD CONSTRAINT "approval_add_sign_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "approval_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_add_sign_tasks" ADD CONSTRAINT "approval_add_sign_tasks_sign_task_id_fkey" FOREIGN KEY ("sign_task_id") REFERENCES "approval_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "approval_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_return_back_records" ADD CONSTRAINT "approval_return_back_records_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_return_back_records" ADD CONSTRAINT "approval_return_back_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "approval_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance_attachments" ADD CONSTRAINT "approval_instance_attachments_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance_attachments" ADD CONSTRAINT "approval_instance_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_webhook_deliveries" ADD CONSTRAINT "approval_webhook_deliveries_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "operation_log_blobs" ADD CONSTRAINT "operation_log_blobs_operationLogId_fkey" FOREIGN KEY ("operationLogId") REFERENCES "operation_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_log_settings" ADD CONSTRAINT "operation_log_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_task_settings" ADD CONSTRAINT "message_task_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_ui_settings" ADD CONSTRAINT "enterprise_ui_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_mail_settings" ADD CONSTRAINT "enterprise_mail_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_ai_models" ADD CONSTRAINT "enterprise_ai_models_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_ai_model_routes" ADD CONSTRAINT "enterprise_ai_model_routes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_term_categories" ADD CONSTRAINT "enterprise_term_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_terms" ADD CONSTRAINT "enterprise_terms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_terms" ADD CONSTRAINT "enterprise_terms_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "enterprise_term_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_term_discoveries" ADD CONSTRAINT "enterprise_term_discoveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_global_tasks" ADD CONSTRAINT "enterprise_global_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_global_tasks" ADD CONSTRAINT "enterprise_global_tasks_applicableModelId_fkey" FOREIGN KEY ("applicableModelId") REFERENCES "enterprise_ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_global_task_executions" ADD CONSTRAINT "enterprise_global_task_executions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_global_task_executions" ADD CONSTRAINT "enterprise_global_task_executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "enterprise_global_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_integrations" ADD CONSTRAINT "enterprise_integrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_integrations" ADD CONSTRAINT "enterprise_integrations_syncDefaultRoleId_fkey" FOREIGN KEY ("syncDefaultRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_department_mappings" ADD CONSTRAINT "external_department_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_department_mappings" ADD CONSTRAINT "external_department_mappings_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_department_mappings" ADD CONSTRAINT "external_department_mappings_lastSeenBatchId_fkey" FOREIGN KEY ("lastSeenBatchId") REFERENCES "organization_sync_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_user_mappings" ADD CONSTRAINT "external_user_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_user_mappings" ADD CONSTRAINT "external_user_mappings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_user_mappings" ADD CONSTRAINT "external_user_mappings_lastSeenBatchId_fkey" FOREIGN KEY ("lastSeenBatchId") REFERENCES "organization_sync_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "enterprise_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "external_user_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_oauth_states" ADD CONSTRAINT "external_oauth_states_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_oauth_states" ADD CONSTRAINT "external_oauth_states_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "enterprise_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "enterprise_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_deliveries" ADD CONSTRAINT "message_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_sync_batches" ADD CONSTRAINT "organization_sync_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_sync_batches" ADD CONSTRAINT "organization_sync_batches_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "enterprise_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_sync_items" ADD CONSTRAINT "organization_sync_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "organization_sync_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_configs" ADD CONSTRAINT "module_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "top_navigation_configs" ADD CONSTRAINT "top_navigation_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MicroMatrix baseline custom indexes
-- Prisma schema cannot express these PostgreSQL partial unique indexes.
CREATE UNIQUE INDEX "approval_flows_active_form_type_key"
ON "approval_flows"("tenantId", "formType")
WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "organization_sync_batches_active_key"
ON "organization_sync_batches"("tenantId", "provider")
WHERE "status" IN ('FETCHING', 'APPLYING');
