-- CreateTable
CREATE TABLE "bidding_sources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credentials" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastFetchAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bidding_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bidding_keyword_subs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bidding_keyword_subs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bidding_infos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "region" TEXT,
    "buyer" TEXT,
    "budget" DECIMAL(16,2),
    "publishedAt" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "content" TEXT,
    "source" TEXT,
    "keyword" TEXT,
    "hash" TEXT NOT NULL,
    "convertedLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bidding_infos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bidding_sources_tenantId_provider_key" ON "bidding_sources"("tenantId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "bidding_keyword_subs_tenantId_keyword_key" ON "bidding_keyword_subs"("tenantId", "keyword");

-- CreateIndex
CREATE INDEX "bidding_infos_tenantId_publishedAt_idx" ON "bidding_infos"("tenantId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bidding_infos_tenantId_hash_key" ON "bidding_infos"("tenantId", "hash");
