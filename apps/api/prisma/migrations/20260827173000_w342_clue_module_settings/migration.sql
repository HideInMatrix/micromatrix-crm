CREATE TABLE "sys_dict" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "module" VARCHAR(20) NOT NULL,
    "type" VARCHAR(10) NOT NULL DEFAULT 'TEXT',
    "pos" BIGINT NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "create_time" BIGINT NOT NULL,
    "update_time" BIGINT NOT NULL,
    "create_user" VARCHAR(32) NOT NULL,
    "update_user" VARCHAR(32) NOT NULL,
    CONSTRAINT "sys_dict_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sys_dict_organization_id_module_pos_idx"
    ON "sys_dict"("organization_id", "module", "pos");
CREATE INDEX "sys_dict_organization_id_name_idx"
    ON "sys_dict"("organization_id", "name");

CREATE TABLE "sys_dict_config" (
    "module" VARCHAR(20) NOT NULL,
    "organization_id" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "sys_dict_config_pkey" PRIMARY KEY ("module", "organization_id")
);
