CREATE TABLE "export_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "fileSize" INTEGER,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "export_tasks_tenantId_userId_createdAt_idx"
ON "export_tasks"("tenantId", "userId", "createdAt");

CREATE INDEX "export_tasks_expiresAt_idx"
ON "export_tasks"("expiresAt");
