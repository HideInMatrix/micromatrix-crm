CREATE TABLE "module_configs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort" INTEGER NOT NULL,
  CONSTRAINT "module_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "module_configs_tenantId_key_key" ON "module_configs"("tenantId", "key");
CREATE INDEX "module_configs_tenantId_sort_idx" ON "module_configs"("tenantId", "sort");

ALTER TABLE "module_configs"
  ADD CONSTRAINT "module_configs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
