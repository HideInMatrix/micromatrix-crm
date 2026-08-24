CREATE TYPE "EnterpriseIntegrationProvider" AS ENUM ('WECOM', 'DINGTALK', 'LARK');

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
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastTestSucceeded" BOOLEAN,
    "lastTestMessage" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "enterprise_integrations_tenantId_provider_key"
ON "enterprise_integrations"("tenantId", "provider");

CREATE INDEX "enterprise_integrations_tenantId_idx"
ON "enterprise_integrations"("tenantId");

ALTER TABLE "enterprise_integrations"
ADD CONSTRAINT "enterprise_integrations_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 企业设置过去只有一个读写合一权限。迁移后保留存量角色的原有写能力。
UPDATE "roles"
SET "permissions" = array_append("permissions", 'system:setting:update')
WHERE 'system:setting' = ANY("permissions")
  AND NOT ('system:setting:update' = ANY("permissions"));
