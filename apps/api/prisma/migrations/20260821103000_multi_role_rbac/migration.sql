-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- Preserve existing assignments before removing the single-role column.
INSERT INTO "user_roles" ("id", "tenantId", "userId", "roleId", "createdAt", "updatedAt")
SELECT 'migrated_' || md5("id" || ':' || "roleId"), "tenantId", "id", "roleId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users"
WHERE "roleId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");
CREATE INDEX "user_roles_tenantId_roleId_idx" ON "user_roles"("tenantId", "roleId");
CREATE INDEX "user_roles_tenantId_userId_idx" ON "user_roles"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey / DropColumn
ALTER TABLE "users" DROP CONSTRAINT "users_roleId_fkey";
ALTER TABLE "users" DROP COLUMN "roleId";
