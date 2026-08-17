ALTER TABLE "contacts"
ADD COLUMN "enable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "disableReason" TEXT,
ADD COLUMN "customData" JSONB;

ALTER TABLE "opportunities"
ADD COLUMN "contactId" TEXT;

CREATE INDEX "contacts_tenantId_enable_idx"
ON "contacts"("tenantId", "enable");

CREATE INDEX "opportunities_tenantId_contactId_idx"
ON "opportunities"("tenantId", "contactId");

ALTER TABLE "opportunities"
ADD CONSTRAINT "opportunities_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
