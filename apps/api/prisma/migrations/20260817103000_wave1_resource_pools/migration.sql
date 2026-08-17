-- AlterTable
ALTER TABLE "customers"
ADD COLUMN "poolId" TEXT,
ADD COLUMN "collectedAt" TIMESTAMP(3),
ADD COLUMN "poolEnteredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "leads"
ADD COLUMN "poolId" TEXT,
ADD COLUMN "collectedAt" TIMESTAMP(3),
ADD COLUMN "poolEnteredAt" TIMESTAMP(3);

-- Existing owned resources predate collection-time tracking; creation time is the safest compatibility baseline.
UPDATE "customers"
SET "collectedAt" = "createdAt"
WHERE "ownerId" IS NOT NULL AND "inSea" = false AND "collectedAt" IS NULL;

UPDATE "leads"
SET "collectedAt" = "createdAt"
WHERE "ownerId" IS NOT NULL AND "inPool" = false AND "collectedAt" IS NULL;

-- CreateTable
CREATE TABLE "resource_pools" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "managerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoRecycle" BOOLEAN NOT NULL DEFAULT false,
    "hiddenFieldIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_pool_pick_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "limitDailyPick" BOOLEAN NOT NULL DEFAULT false,
    "dailyPickLimit" INTEGER,
    "limitPreviousOwner" BOOLEAN NOT NULL DEFAULT false,
    "previousOwnerCooldownDays" INTEGER,
    "limitNewData" BOOLEAN NOT NULL DEFAULT false,
    "newDataCooldownDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_pool_pick_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_pool_recycle_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "operator" TEXT NOT NULL DEFAULT 'AND',
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_pool_recycle_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_capacities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "scopeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capacity" INTEGER NOT NULL,
    "filters" JSONB,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_capacities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_owner_histories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "operatorId" TEXT,
    "poolId" TEXT,
    "reasonId" TEXT,
    "collectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_owner_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenantId_poolId_idx" ON "customers"("tenantId", "poolId");

-- CreateIndex
CREATE INDEX "leads_tenantId_poolId_idx" ON "leads"("tenantId", "poolId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_pools_tenantId_module_name_key" ON "resource_pools"("tenantId", "module", "name");

-- CreateIndex
CREATE INDEX "resource_pools_tenantId_module_enabled_idx" ON "resource_pools"("tenantId", "module", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "resource_pool_pick_rules_poolId_key" ON "resource_pool_pick_rules"("poolId");

-- CreateIndex
CREATE INDEX "resource_pool_pick_rules_tenantId_idx" ON "resource_pool_pick_rules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_pool_recycle_rules_poolId_key" ON "resource_pool_recycle_rules"("poolId");

-- CreateIndex
CREATE INDEX "resource_pool_recycle_rules_tenantId_idx" ON "resource_pool_recycle_rules"("tenantId");

-- CreateIndex
CREATE INDEX "resource_capacities_tenantId_module_idx" ON "resource_capacities"("tenantId", "module");

-- CreateIndex
CREATE INDEX "resource_owner_histories_tenantId_module_resourceId_endedAt_idx"
ON "resource_owner_histories"("tenantId", "module", "resourceId", "endedAt");

-- CreateIndex
CREATE INDEX "resource_owner_histories_tenantId_ownerId_endedAt_idx"
ON "resource_owner_histories"("tenantId", "ownerId", "endedAt");

-- AddForeignKey
ALTER TABLE "resource_pool_pick_rules"
ADD CONSTRAINT "resource_pool_pick_rules_poolId_fkey"
FOREIGN KEY ("poolId") REFERENCES "resource_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_pool_recycle_rules"
ADD CONSTRAINT "resource_pool_recycle_rules_poolId_fkey"
FOREIGN KEY ("poolId") REFERENCES "resource_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
