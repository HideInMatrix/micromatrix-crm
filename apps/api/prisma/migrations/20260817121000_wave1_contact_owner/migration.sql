-- Cordys CustomerContact has its own owner. Existing rows intentionally stay NULL:
-- normal customer data-scope users can still read them, while collaboration-only users
-- do not inherit historical contacts that were never explicitly owned by them.
ALTER TABLE "contacts"
ADD COLUMN "ownerId" TEXT,
ADD COLUMN "deptId" TEXT;

CREATE INDEX "contacts_tenantId_ownerId_idx" ON "contacts"("tenantId", "ownerId");
CREATE INDEX "contacts_tenantId_deptId_idx" ON "contacts"("tenantId", "deptId");

ALTER TABLE "contacts"
ADD CONSTRAINT "contacts_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
