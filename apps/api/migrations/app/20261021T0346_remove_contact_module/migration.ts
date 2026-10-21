#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2c88c1204a08768aebd1ea09c360f4f4eaf0a4fc1f68daf4c3e73474faf6f68c/contract';
import endContract from '../../snapshots/2c88c1204a08768aebd1ea09c360f4f4eaf0a4fc1f68daf4c3e73474faf6f68c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/82e73dd2065611c8a2ada7ed77659018c2bb89809a0a0ae9f224e2189fc8da79/contract';
import startContract from '../../snapshots/82e73dd2065611c8a2ada7ed77659018c2bb89809a0a0ae9f224e2189fc8da79/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      rawSql({
        id: 'contact-module.cleanup-legacy-metadata',
        label: 'Remove legacy contact module metadata and permissions',
        operationClass: 'data',
        target: {
          id: 'public.sys_module_form',
          details: { schema: 'public', objectType: 'table', name: 'sys_module_form' },
        },
        precheck: [],
        execute: [
          {
            description: 'Delete saved views for the removed contact resource',
            sql: `DELETE FROM "public"."sys_user_view" WHERE "resource_type" IN ('CUSTOMER_CONTACT', 'CONTACT', 'contact')`,
          },
          {
            description: 'Delete the removed contact form and its field metadata',
            sql: `DELETE FROM "public"."sys_module_form" WHERE "form_key" = 'contact'`,
          },
          {
            description: 'Delete stale contact module configuration',
            sql: `DELETE FROM "public"."module_configs" WHERE "key" = 'contact'`,
          },
          {
            description: 'Delete stale contact top navigation configuration',
            sql: `DELETE FROM "public"."top_navigation_configs" WHERE "key" = 'contact'`,
          },
          {
            description: 'Delete contact notification settings',
            sql: `DELETE FROM "public"."message_task_settings" WHERE "module" = 'contact'`,
          },
          {
            description: 'Remove contact permissions from existing roles',
            sql: `UPDATE "public"."roles" SET "permissions" = ARRAY(SELECT p.permission FROM unnest("permissions") AS p(permission) WHERE p.permission NOT LIKE 'contact:%') WHERE "permissions" IS NOT NULL AND EXISTS (SELECT 1 FROM unnest("permissions") AS p(permission) WHERE p.permission LIKE 'contact:%')`,
          },
        ],
        postcheck: [],
      }),
      this.dropTable({ schema: 'public', table: 'customer_contact_field' }),
      this.dropTable({ schema: 'public', table: 'customer_contact_field_blob' }),
      this.dropTable({ schema: 'public', table: 'customer_contact' }),
      this.dropColumn({ schema: 'public', table: 'follow_up_plans', column: 'contactId' }),
      this.dropColumn({ schema: 'public', table: 'follow_up_records', column: 'contactId' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
