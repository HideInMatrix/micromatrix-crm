-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('USER', 'ROLE', 'DEPT_LEADER', 'DIRECT_LEADER');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('ALL', 'ANY');

-- CreateEnum
CREATE TYPE "ApprovalInstanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ApprovalTaskStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "receivable_records" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "approval_flows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "condition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_nodes" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "approverType" "ApproverType" NOT NULL,
    "approverIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mode" "ApprovalMode" NOT NULL DEFAULT 'ANY',

    CONSTRAINT "approval_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_instances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "summary" TEXT,
    "status" "ApprovalInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "currentNodeIndex" INTEGER NOT NULL DEFAULT 0,
    "nodesSnapshot" JSONB NOT NULL,
    "submitterId" TEXT NOT NULL,
    "submitterName" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeIndex" INTEGER NOT NULL,
    "nodeName" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "status" "ApprovalTaskStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_flows_tenantId_module_key" ON "approval_flows"("tenantId", "module");

-- CreateIndex
CREATE INDEX "approval_nodes_flowId_idx" ON "approval_nodes"("flowId");

-- CreateIndex
CREATE INDEX "approval_instances_tenantId_status_idx" ON "approval_instances"("tenantId", "status");

-- CreateIndex
CREATE INDEX "approval_instances_tenantId_module_targetId_idx" ON "approval_instances"("tenantId", "module", "targetId");

-- CreateIndex
CREATE INDEX "approval_instances_tenantId_submitterId_idx" ON "approval_instances"("tenantId", "submitterId");

-- CreateIndex
CREATE INDEX "approval_tasks_tenantId_approverId_status_idx" ON "approval_tasks"("tenantId", "approverId", "status");

-- CreateIndex
CREATE INDEX "approval_tasks_instanceId_idx" ON "approval_tasks"("instanceId");

-- AddForeignKey
ALTER TABLE "approval_nodes" ADD CONSTRAINT "approval_nodes_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "approval_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
