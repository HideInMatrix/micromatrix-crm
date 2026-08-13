/*
  Warnings:

  - You are about to drop the column `customFields` on the `customers` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "customers" DROP COLUMN "customFields",
ADD COLUMN     "customData" JSONB;

-- CreateTable
CREATE TABLE "field_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "config" JSONB,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "span" INTEGER NOT NULL DEFAULT 12,
    "showInList" BOOLEAN NOT NULL DEFAULT true,
    "listWidth" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "field_definitions_tenantId_module_idx" ON "field_definitions"("tenantId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "field_definitions_tenantId_module_key_key" ON "field_definitions"("tenantId", "module", "key");
