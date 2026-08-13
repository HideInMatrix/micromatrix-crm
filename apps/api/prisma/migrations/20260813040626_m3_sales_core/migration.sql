-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('FOLLOWING', 'CONVERTED', 'INVALID');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "inSea" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastFollowedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "customer_team_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'FOLLOWING',
    "inPool" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "deptId" TEXT,
    "customData" JSONB,
    "convertedCustomerId" TEXT,
    "lastFollowedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "nextFollowAt" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_stages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "opportunity_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "amount" DECIMAL(14,2),
    "expectedCloseAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "remark" TEXT,
    "ownerId" TEXT,
    "deptId" TEXT,
    "customData" JSONB,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lastFollowedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_stage_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStageName" TEXT,
    "toStageName" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_stage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "recycleDays" INTEGER NOT NULL DEFAULT 30,
    "notifyDays" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "pool_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_team_members_tenantId_userId_idx" ON "customer_team_members"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_team_members_customerId_userId_key" ON "customer_team_members"("customerId", "userId");

-- CreateIndex
CREATE INDEX "leads_tenantId_inPool_idx" ON "leads"("tenantId", "inPool");

-- CreateIndex
CREATE INDEX "leads_tenantId_deptId_idx" ON "leads"("tenantId", "deptId");

-- CreateIndex
CREATE INDEX "leads_tenantId_status_idx" ON "leads"("tenantId", "status");

-- CreateIndex
CREATE INDEX "follow_up_records_tenantId_targetType_targetId_idx" ON "follow_up_records"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "opportunity_stages_tenantId_idx" ON "opportunity_stages"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_stages_tenantId_name_key" ON "opportunity_stages"("tenantId", "name");

-- CreateIndex
CREATE INDEX "opportunities_tenantId_stageId_idx" ON "opportunities"("tenantId", "stageId");

-- CreateIndex
CREATE INDEX "opportunities_tenantId_deptId_idx" ON "opportunities"("tenantId", "deptId");

-- CreateIndex
CREATE INDEX "opportunities_tenantId_customerId_idx" ON "opportunities"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "opportunity_stage_logs_opportunityId_idx" ON "opportunity_stage_logs"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "pool_rules_tenantId_module_key" ON "pool_rules"("tenantId", "module");

-- CreateIndex
CREATE INDEX "customers_tenantId_inSea_idx" ON "customers"("tenantId", "inSea");

-- AddForeignKey
ALTER TABLE "customer_team_members" ADD CONSTRAINT "customer_team_members_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "opportunity_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_stage_logs" ADD CONSTRAINT "opportunity_stage_logs_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
