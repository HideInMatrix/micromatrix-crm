CREATE TYPE "FollowUpPlanStatus" AS ENUM ('PREPARED', 'UNDERWAY', 'COMPLETED', 'CANCELLED');

CREATE TABLE "follow_up_plans" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "contactId" TEXT,
  "content" TEXT NOT NULL,
  "method" TEXT,
  "estimatedAt" TIMESTAMP(3),
  "status" "FollowUpPlanStatus" NOT NULL DEFAULT 'PREPARED',
  "converted" BOOLEAN NOT NULL DEFAULT false,
  "convertedRecordId" TEXT,
  "ownerId" TEXT NOT NULL,
  "deptId" TEXT,
  "createdById" TEXT NOT NULL,
  "dueNotifiedAt" TIMESTAMP(3),
  "customData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "follow_up_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "follow_up_plans_tenantId_targetType_targetId_idx"
  ON "follow_up_plans"("tenantId", "targetType", "targetId");
CREATE INDEX "follow_up_plans_tenantId_ownerId_status_idx"
  ON "follow_up_plans"("tenantId", "ownerId", "status");
CREATE INDEX "follow_up_plans_tenantId_estimatedAt_status_idx"
  ON "follow_up_plans"("tenantId", "estimatedAt", "status");
