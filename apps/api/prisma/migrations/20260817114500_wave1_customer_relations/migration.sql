-- CreateTable
CREATE TABLE "customer_relations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceCustomerId" TEXT NOT NULL,
    "targetCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_relations_tenantId_sourceCustomerId_targetCustomerId_key"
ON "customer_relations"("tenantId", "sourceCustomerId", "targetCustomerId");

-- CreateIndex
CREATE INDEX "customer_relations_tenantId_sourceCustomerId_idx"
ON "customer_relations"("tenantId", "sourceCustomerId");

-- CreateIndex
CREATE INDEX "customer_relations_tenantId_targetCustomerId_idx"
ON "customer_relations"("tenantId", "targetCustomerId");
