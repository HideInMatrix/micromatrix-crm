CREATE TABLE "message_task_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "systemEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_task_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_task_settings_tenantId_module_event_key"
ON "message_task_settings"("tenantId", "module", "event");

CREATE INDEX "message_task_settings_tenantId_module_idx"
ON "message_task_settings"("tenantId", "module");

ALTER TABLE "message_task_settings"
ADD CONSTRAINT "message_task_settings_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
