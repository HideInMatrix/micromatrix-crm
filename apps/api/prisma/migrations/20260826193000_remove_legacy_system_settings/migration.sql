-- Legacy generic key/value settings have no remaining consumers after the
-- enterprise settings page migrated to first-class domain models.
DROP TABLE IF EXISTS "system_settings";
