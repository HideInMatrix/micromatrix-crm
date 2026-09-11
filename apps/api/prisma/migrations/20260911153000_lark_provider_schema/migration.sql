-- Lark provider schema additions must live in an incremental migration.
-- The baseline migration may already be recorded as applied on existing databases
-- and therefore must not be modified to carry later schema changes.

ALTER TYPE "ExternalOAuthFlow" ADD VALUE 'QR_LARK';
ALTER TYPE "ExternalOAuthFlow" ADD VALUE 'LARK';
ALTER TYPE "ExternalOAuthFlow" ADD VALUE 'LARK_MOBILE';

ALTER TABLE "enterprise_integrations"
ADD COLUMN "redirectUrl" TEXT;

ALTER TABLE "message_task_settings"
ADD COLUMN "larkEnabled" BOOLEAN NOT NULL DEFAULT false;
