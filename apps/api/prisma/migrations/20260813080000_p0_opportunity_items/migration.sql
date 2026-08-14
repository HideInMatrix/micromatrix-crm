-- CreateTable
CREATE TABLE "opportunity_items" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(14,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "opportunity_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunity_items_opportunityId_idx" ON "opportunity_items"("opportunityId");

-- AddForeignKey
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
