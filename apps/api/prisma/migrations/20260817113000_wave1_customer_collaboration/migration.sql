-- AlterTable
ALTER TABLE "customer_team_members"
ADD COLUMN "collaborationType" TEXT NOT NULL DEFAULT 'COLLABORATION',
ADD COLUMN "createdById" TEXT,
ADD COLUMN "updatedById" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Backfill update timestamp before making it required.
UPDATE "customer_team_members"
SET "updatedAt" = "createdAt"
WHERE "updatedAt" IS NULL;

ALTER TABLE "customer_team_members"
ALTER COLUMN "updatedAt" SET NOT NULL;
