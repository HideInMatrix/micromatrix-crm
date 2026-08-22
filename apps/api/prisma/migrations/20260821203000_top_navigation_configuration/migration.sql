CREATE TABLE "top_navigation_configs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort" INTEGER NOT NULL,
  CONSTRAINT "top_navigation_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "top_navigation_configs_tenantId_key_key"
  ON "top_navigation_configs"("tenantId", "key");
CREATE INDEX "top_navigation_configs_tenantId_sort_idx"
  ON "top_navigation_configs"("tenantId", "sort");

ALTER TABLE "top_navigation_configs"
  ADD CONSTRAINT "top_navigation_configs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
