ALTER TABLE "leads"
ADD COLUMN "transitionType" TEXT,
ADD COLUMN "transitionId" TEXT;

UPDATE "leads"
SET
  "transitionType" = 'CUSTOMER',
  "transitionId" = "convertedCustomerId"
WHERE "convertedCustomerId" IS NOT NULL;

ALTER TABLE "leads"
DROP COLUMN "convertedCustomerId";

CREATE INDEX "leads_tenantId_transitionType_transitionId_idx"
ON "leads"("tenantId", "transitionType", "transitionId");
