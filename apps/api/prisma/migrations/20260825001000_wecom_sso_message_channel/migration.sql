CREATE TYPE "ExternalIdentityStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "ExternalOAuthFlow" AS ENUM ('QR_WECOM');
CREATE TYPE "MessageDeliveryChannel" AS ENUM ('WECOM', 'DINGTALK', 'LARK', 'EMAIL');
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SUCCEEDED', 'FAILED', 'DEAD');

ALTER TABLE "login_logs"
ADD COLUMN "authType" TEXT NOT NULL DEFAULT 'PASSWORD',
ADD COLUMN "externalSubject" TEXT,
ADD COLUMN "externalIdentityId" TEXT;

ALTER TABLE "message_task_settings"
ADD COLUMN "weComEnabled" BOOLEAN NOT NULL DEFAULT false;

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

CREATE UNIQUE INDEX "external_identities_mappingId_key"
ON "external_identities"("mappingId");
CREATE UNIQUE INDEX "external_identities_tenantId_provider_externalSubject_key"
ON "external_identities"("tenantId", "provider", "externalSubject");
CREATE UNIQUE INDEX "external_identities_tenantId_provider_userId_key"
ON "external_identities"("tenantId", "provider", "userId");
CREATE INDEX "external_identities_tenantId_provider_status_idx"
ON "external_identities"("tenantId", "provider", "status");
CREATE INDEX "external_identities_integrationId_idx"
ON "external_identities"("integrationId");

CREATE UNIQUE INDEX "external_oauth_states_stateHash_key"
ON "external_oauth_states"("stateHash");
CREATE INDEX "external_oauth_states_tenantId_flow_expiresAt_idx"
ON "external_oauth_states"("tenantId", "flow", "expiresAt");
CREATE INDEX "external_oauth_states_expiresAt_consumedAt_idx"
ON "external_oauth_states"("expiresAt", "consumedAt");

CREATE INDEX "message_deliveries_tenantId_status_nextAttemptAt_idx"
ON "message_deliveries"("tenantId", "status", "nextAttemptAt");
CREATE INDEX "message_deliveries_tenantId_event_createdAt_idx"
ON "message_deliveries"("tenantId", "event", "createdAt");
CREATE INDEX "message_deliveries_tenantId_userId_createdAt_idx"
ON "message_deliveries"("tenantId", "userId", "createdAt");
CREATE INDEX "login_logs_tenantId_authType_createdAt_idx"
ON "login_logs"("tenantId", "authType", "createdAt");

ALTER TABLE "external_identities"
ADD CONSTRAINT "external_identities_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_identities"
ADD CONSTRAINT "external_identities_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "enterprise_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_identities"
ADD CONSTRAINT "external_identities_mappingId_fkey"
FOREIGN KEY ("mappingId") REFERENCES "external_user_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_identities"
ADD CONSTRAINT "external_identities_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_oauth_states"
ADD CONSTRAINT "external_oauth_states_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_oauth_states"
ADD CONSTRAINT "external_oauth_states_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "enterprise_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_deliveries"
ADD CONSTRAINT "message_deliveries_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_deliveries"
ADD CONSTRAINT "message_deliveries_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "enterprise_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "message_deliveries"
ADD CONSTRAINT "message_deliveries_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
