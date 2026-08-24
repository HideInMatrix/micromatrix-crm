CREATE TYPE "OrganizationSyncStatus" AS ENUM (
    'FETCHING',
    'PREVIEW_READY',
    'APPLYING',
    'SUCCEEDED',
    'FAILED',
    'INVALIDATED'
);

CREATE TYPE "OrganizationSyncResourceType" AS ENUM ('DEPARTMENT', 'USER');
CREATE TYPE "OrganizationSyncAction" AS ENUM (
    'CREATE',
    'UPDATE',
    'DISABLE',
    'UNCHANGED',
    'CONFLICT',
    'SKIP'
);
CREATE TYPE "OrganizationSyncItemResult" AS ENUM (
    'PENDING',
    'RESOLVED',
    'APPLIED',
    'SKIPPED',
    'FAILED'
);
CREATE TYPE "OrganizationSyncResolution" AS ENUM ('BIND', 'SKIP');

ALTER TABLE "users"
ADD COLUMN "passwordLoginEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "enterprise_integrations"
ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "syncDefaultRoleId" TEXT,
ADD COLUMN "lastSyncStatus" "OrganizationSyncStatus",
ADD COLUMN "lastSyncMessage" TEXT,
ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

CREATE TABLE "organization_sync_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "provider" "EnterpriseIntegrationProvider" NOT NULL,
    "status" "OrganizationSyncStatus" NOT NULL,
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

CREATE INDEX "enterprise_integrations_syncDefaultRoleId_idx"
ON "enterprise_integrations"("syncDefaultRoleId");

CREATE INDEX "organization_sync_batches_tenantId_provider_createdAt_idx"
ON "organization_sync_batches"("tenantId", "provider", "createdAt");

CREATE INDEX "organization_sync_batches_integrationId_status_idx"
ON "organization_sync_batches"("integrationId", "status");

CREATE UNIQUE INDEX "organization_sync_batches_active_key"
ON "organization_sync_batches"("tenantId", "provider")
WHERE "status" IN ('FETCHING', 'APPLYING');

CREATE UNIQUE INDEX "external_department_mappings_tenantId_provider_externalKey_key"
ON "external_department_mappings"("tenantId", "provider", "externalKey");

CREATE UNIQUE INDEX "external_department_mappings_tenantId_provider_departmentId_key"
ON "external_department_mappings"("tenantId", "provider", "departmentId");

CREATE INDEX "external_department_mappings_tenantId_provider_active_idx"
ON "external_department_mappings"("tenantId", "provider", "active");

CREATE INDEX "external_department_mappings_lastSeenBatchId_idx"
ON "external_department_mappings"("lastSeenBatchId");

CREATE UNIQUE INDEX "external_user_mappings_tenantId_provider_externalKey_key"
ON "external_user_mappings"("tenantId", "provider", "externalKey");

CREATE UNIQUE INDEX "external_user_mappings_tenantId_provider_userId_key"
ON "external_user_mappings"("tenantId", "provider", "userId");

CREATE INDEX "external_user_mappings_tenantId_provider_active_idx"
ON "external_user_mappings"("tenantId", "provider", "active");

CREATE INDEX "external_user_mappings_lastSeenBatchId_idx"
ON "external_user_mappings"("lastSeenBatchId");

CREATE UNIQUE INDEX "organization_sync_items_batchId_resourceType_externalKey_key"
ON "organization_sync_items"("batchId", "resourceType", "externalKey");

CREATE INDEX "organization_sync_items_tenantId_batchId_resourceType_action_idx"
ON "organization_sync_items"("tenantId", "batchId", "resourceType", "action");

ALTER TABLE "enterprise_integrations"
ADD CONSTRAINT "enterprise_integrations_syncDefaultRoleId_fkey"
FOREIGN KEY ("syncDefaultRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "organization_sync_batches"
ADD CONSTRAINT "organization_sync_batches_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_sync_batches"
ADD CONSTRAINT "organization_sync_batches_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "enterprise_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_department_mappings"
ADD CONSTRAINT "external_department_mappings_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_department_mappings"
ADD CONSTRAINT "external_department_mappings_departmentId_fkey"
FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_department_mappings"
ADD CONSTRAINT "external_department_mappings_lastSeenBatchId_fkey"
FOREIGN KEY ("lastSeenBatchId") REFERENCES "organization_sync_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "external_user_mappings"
ADD CONSTRAINT "external_user_mappings_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_user_mappings"
ADD CONSTRAINT "external_user_mappings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_user_mappings"
ADD CONSTRAINT "external_user_mappings_lastSeenBatchId_fkey"
FOREIGN KEY ("lastSeenBatchId") REFERENCES "organization_sync_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "organization_sync_items"
ADD CONSTRAINT "organization_sync_items_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "organization_sync_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 管理员使用 '*' 已自动获得新权限；显式组织管理员保留 Cordys 的同步能力。
UPDATE "roles"
SET "permissions" = array_append("permissions", 'system:dept:sync')
WHERE "isSystem" = true
  AND 'system:dept' = ANY("permissions")
  AND NOT ('*' = ANY("permissions"))
  AND NOT ('system:dept:sync' = ANY("permissions"));
