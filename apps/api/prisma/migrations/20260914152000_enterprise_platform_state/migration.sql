-- Enterprise collaboration platform state must be added forward-only.
-- The published baseline and Lark provider migrations are immutable.

ALTER TABLE "tenants"
ADD COLUMN "enterpriseSyncResource" "EnterpriseIntegrationProvider" NOT NULL DEFAULT 'WECOM',
ADD COLUMN "enterpriseSynced" BOOLEAN NOT NULL DEFAULT false;
