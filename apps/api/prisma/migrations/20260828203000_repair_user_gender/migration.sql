-- Repair historical schema drift: `gender` was added to the original init
-- migration after some development databases had already applied it.
-- Keep this as a forward-only, idempotent migration so existing databases
-- converge without rewriting migration history.
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "gender" BOOLEAN NOT NULL DEFAULT false;
