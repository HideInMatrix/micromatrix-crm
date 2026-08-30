-- DB-021: add Cordys-style FollowUpPlan dynamic-field value tables.
-- Keep follow_up_plans.customData during 8.2/8.3 so upgrade data cannot be
-- silently lost before the runtime and compatibility audit are complete.

CREATE TABLE "follow_up_plan_field" (
  "id" VARCHAR(32) NOT NULL,
  "resource_id" TEXT NOT NULL,
  "field_id" VARCHAR(32) NOT NULL,
  "field_value" VARCHAR(255) NOT NULL,
  CONSTRAINT "follow_up_plan_field_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "follow_up_plan_field_resource_id_fkey"
    FOREIGN KEY ("resource_id") REFERENCES "follow_up_plans"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "follow_up_plan_field_resource_id_field_id_key"
  ON "follow_up_plan_field"("resource_id", "field_id");
CREATE INDEX "follow_up_plan_field_resource_id_field_id_field_value_idx"
  ON "follow_up_plan_field"("resource_id", "field_id", "field_value");

CREATE TABLE "follow_up_plan_field_blob" (
  "id" VARCHAR(32) NOT NULL,
  "resource_id" TEXT NOT NULL,
  "field_id" VARCHAR(32) NOT NULL,
  "field_value" TEXT NOT NULL,
  CONSTRAINT "follow_up_plan_field_blob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "follow_up_plan_field_blob_resource_id_fkey"
    FOREIGN KEY ("resource_id") REFERENCES "follow_up_plans"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "follow_up_plan_field_blob_resource_id_field_id_key"
  ON "follow_up_plan_field_blob"("resource_id", "field_id");
CREATE INDEX "follow_up_plan_field_blob_resource_id_idx"
  ON "follow_up_plan_field_blob"("resource_id");
