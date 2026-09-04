-- LOG-001: support global retention scans without relying on the tenantId index prefix.
CREATE INDEX "operation_logs_createdAt_idx" ON "operation_logs"("createdAt");
