-- W3.6.5 final permission upgrade: preserve existing role capabilities while
-- retiring the legacy lowercase order action codes. New import/export/download
-- permissions are intentionally not granted unless they already come from Seed
-- or explicit role administration.

UPDATE "roles"
SET "permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(
    "permissions"
    || CASE WHEN 'menu:order' = ANY("permissions") THEN ARRAY['ORDER:READ']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN 'order:create' = ANY("permissions") THEN ARRAY['ORDER:ADD']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN 'order:update' = ANY("permissions") THEN ARRAY['ORDER:UPDATE']::text[] ELSE ARRAY[]::text[] END
    || CASE WHEN 'order:delete' = ANY("permissions") THEN ARRAY['ORDER:DELETE']::text[] ELSE ARRAY[]::text[] END
  ) AS permission
  WHERE permission NOT IN ('order:create', 'order:update', 'order:delete')
)
WHERE
  'menu:order' = ANY("permissions")
  OR 'order:create' = ANY("permissions")
  OR 'order:update' = ANY("permissions")
  OR 'order:delete' = ANY("permissions");
