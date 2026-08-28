CREATE TABLE "user_key" (
    "id" TEXT NOT NULL,
    "create_user" TEXT NOT NULL,
    "access_key" TEXT NOT NULL,
    "secret_key" TEXT NOT NULL,
    "create_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "forever" BOOLEAN NOT NULL DEFAULT true,
    "expire_time" TIMESTAMP(3),
    "description" TEXT,

    CONSTRAINT "user_key_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_key_access_key_key" ON "user_key"("access_key");
CREATE INDEX "user_key_create_user_idx" ON "user_key"("create_user");

ALTER TABLE "user_key"
ADD CONSTRAINT "user_key_create_user_fkey"
FOREIGN KEY ("create_user") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
