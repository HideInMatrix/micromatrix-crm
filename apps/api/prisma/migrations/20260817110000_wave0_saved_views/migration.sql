-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fixed" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "searchMode" TEXT NOT NULL DEFAULT 'AND',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_view_conditions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" JSONB,
    "fieldType" TEXT,
    "multipleValue" BOOLEAN NOT NULL DEFAULT false,
    "containChildIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_view_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_tenantId_userId_module_name_key"
ON "saved_views"("tenantId", "userId", "module", "name");

-- CreateIndex
CREATE INDEX "saved_views_tenantId_userId_module_enabled_sort_idx"
ON "saved_views"("tenantId", "userId", "module", "enabled", "sort");

-- CreateIndex
CREATE INDEX "saved_view_conditions_tenantId_viewId_sort_idx"
ON "saved_view_conditions"("tenantId", "viewId", "sort");

-- AddForeignKey
ALTER TABLE "saved_view_conditions"
ADD CONSTRAINT "saved_view_conditions_viewId_fkey"
FOREIGN KEY ("viewId") REFERENCES "saved_views"("id") ON DELETE CASCADE ON UPDATE CASCADE;
