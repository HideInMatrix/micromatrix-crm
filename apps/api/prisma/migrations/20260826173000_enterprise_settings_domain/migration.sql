-- Enterprise settings are first-class domain tables. Do not fold them into system_settings.
CREATE TABLE "enterprise_ui_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'default',
    "customTheme" TEXT NOT NULL DEFAULT '#008d91',
    "style" TEXT NOT NULL DEFAULT 'default',
    "customStyle" TEXT NOT NULL DEFAULT '#f9fbfb',
    "title" TEXT NOT NULL DEFAULT 'MicroMatrix CRM',
    "slogan" TEXT NOT NULL DEFAULT '让客户关系更清晰，让销售协作更高效',
    "helpDoc" TEXT NOT NULL DEFAULT '',
    "iconAttachmentId" TEXT,
    "loginLogoAttachmentId" TEXT,
    "loginImageAttachmentId" TEXT,
    "platformLogoAttachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_ui_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enterprise_mail_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "account" TEXT NOT NULL,
    "passwordCiphertext" TEXT,
    "passwordIv" TEXT,
    "passwordAuthTag" TEXT,
    "passwordKeyVersion" INTEGER,
    "fromAddress" TEXT NOT NULL DEFAULT '',
    "recipient" TEXT NOT NULL DEFAULT '',
    "ssl" BOOLEAN NOT NULL DEFAULT false,
    "tls" BOOLEAN NOT NULL DEFAULT false,
    "lastTestSucceeded" BOOLEAN,
    "lastTestMessage" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_mail_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enterprise_ai_models" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT,
    "apiKeyIv" TEXT,
    "apiKeyAuthTag" TEXT,
    "apiKeyKeyVersion" INTEGER,
    "enable" BOOLEAN NOT NULL DEFAULT false,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 2048,
    "topP" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "globalDailyLimit" INTEGER,
    "userDailyLimit" INTEGER,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_ai_models_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enterprise_ai_model_routes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_ai_model_routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enterprise_term_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_term_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enterprise_terms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "standardTerm" TEXT NOT NULL,
    "alsoCalled" TEXT NOT NULL DEFAULT '',
    "avoidThese" TEXT NOT NULL DEFAULT '',
    "useCase" TEXT NOT NULL DEFAULT '',
    "systemReference" TEXT NOT NULL DEFAULT '',
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_terms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enterprise_term_discoveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "discovered" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "context" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adoptedTermId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_term_discoveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enterprise_global_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'manual',
    "executionCondition" TEXT NOT NULL DEFAULT '',
    "executionAction" TEXT NOT NULL DEFAULT '',
    "confirmationLevel" TEXT NOT NULL DEFAULT 'ask',
    "applicableModelId" TEXT,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_global_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enterprise_global_task_executions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_global_task_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "enterprise_ui_settings_tenantId_key" ON "enterprise_ui_settings"("tenantId");
CREATE UNIQUE INDEX "enterprise_mail_settings_tenantId_key" ON "enterprise_mail_settings"("tenantId");
CREATE UNIQUE INDEX "enterprise_ai_models_tenantId_displayName_key" ON "enterprise_ai_models"("tenantId", "displayName");
CREATE INDEX "enterprise_ai_models_tenantId_enable_idx" ON "enterprise_ai_models"("tenantId", "enable");
CREATE UNIQUE INDEX "enterprise_ai_model_routes_tenantId_modelId_key" ON "enterprise_ai_model_routes"("tenantId", "modelId");
CREATE UNIQUE INDEX "enterprise_ai_model_routes_tenantId_sort_key" ON "enterprise_ai_model_routes"("tenantId", "sort");
CREATE INDEX "enterprise_ai_model_routes_tenantId_idx" ON "enterprise_ai_model_routes"("tenantId");
CREATE UNIQUE INDEX "enterprise_term_categories_tenantId_name_key" ON "enterprise_term_categories"("tenantId", "name");
CREATE INDEX "enterprise_term_categories_tenantId_sort_idx" ON "enterprise_term_categories"("tenantId", "sort");
CREATE UNIQUE INDEX "enterprise_terms_tenantId_categoryId_standardTerm_key" ON "enterprise_terms"("tenantId", "categoryId", "standardTerm");
CREATE INDEX "enterprise_terms_tenantId_enable_idx" ON "enterprise_terms"("tenantId", "enable");
CREATE INDEX "enterprise_terms_categoryId_idx" ON "enterprise_terms"("categoryId");
CREATE INDEX "enterprise_term_discoveries_tenantId_status_idx" ON "enterprise_term_discoveries"("tenantId", "status");
CREATE UNIQUE INDEX "enterprise_global_tasks_tenantId_name_key" ON "enterprise_global_tasks"("tenantId", "name");
CREATE INDEX "enterprise_global_tasks_tenantId_enable_idx" ON "enterprise_global_tasks"("tenantId", "enable");
CREATE INDEX "enterprise_global_tasks_applicableModelId_idx" ON "enterprise_global_tasks"("applicableModelId");
CREATE INDEX "enterprise_global_task_executions_tenantId_createdAt_idx" ON "enterprise_global_task_executions"("tenantId", "createdAt");
CREATE INDEX "enterprise_global_task_executions_taskId_createdAt_idx" ON "enterprise_global_task_executions"("taskId", "createdAt");

ALTER TABLE "enterprise_ui_settings" ADD CONSTRAINT "enterprise_ui_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_mail_settings" ADD CONSTRAINT "enterprise_mail_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_ai_models" ADD CONSTRAINT "enterprise_ai_models_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_ai_model_routes" ADD CONSTRAINT "enterprise_ai_model_routes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_term_categories" ADD CONSTRAINT "enterprise_term_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_terms" ADD CONSTRAINT "enterprise_terms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_terms" ADD CONSTRAINT "enterprise_terms_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "enterprise_term_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_term_discoveries" ADD CONSTRAINT "enterprise_term_discoveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_global_tasks" ADD CONSTRAINT "enterprise_global_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_global_tasks" ADD CONSTRAINT "enterprise_global_tasks_applicableModelId_fkey" FOREIGN KEY ("applicableModelId") REFERENCES "enterprise_ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enterprise_global_task_executions" ADD CONSTRAINT "enterprise_global_task_executions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_global_task_executions" ADD CONSTRAINT "enterprise_global_task_executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "enterprise_global_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
