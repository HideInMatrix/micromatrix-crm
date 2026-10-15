#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/36d0c17775db10dde420cf0b81754420eea1a93e54cf5ab5fdabeef4c8bdd88e/contract';
import startContract from '../../snapshots/36d0c17775db10dde420cf0b81754420eea1a93e54cf5ab5fdabeef4c8bdd88e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/82e73dd2065611c8a2ada7ed77659018c2bb89809a0a0ae9f224e2189fc8da79/contract';
import endContract from '../../snapshots/82e73dd2065611c8a2ada7ed77659018c2bb89809a0a0ae9f224e2189fc8da79/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      rawSql({
        id: 'log-policies.copy-legacy-retention',
        label: 'Preserve existing log retention values during split',
        operationClass: 'data',
        target: {
          id: 'public.operation_log_settings',
          details: { schema: 'public', objectType: 'table', name: 'operation_log_settings' },
        },
        precheck: [],
        execute: [{
          description: 'Copy existing per-tenant retention and permanent mode to login and event',
          sql: 'UPDATE "public"."operation_log_settings" SET "loginRetentionDays" = "retentionDays", "eventRetentionDays" = "retentionDays" WHERE "retentionDays" IS NOT NULL AND "loginRetentionDays" IS NULL AND "eventRetentionDays" IS NULL',
        }],
        postcheck: [],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'operation_log_settings',
        constraint: 'operation_log_settings_event_retention_rule_1680dd3c',
        expression:
          '"eventRetentionDays" IS NULL OR "eventRetentionDays" = 0 OR "eventRetentionDays" BETWEEN 30 AND 3650',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'operation_log_settings',
        constraint: 'operation_log_settings_login_retention_rule_62c3223d',
        expression:
          '"loginRetentionDays" IS NULL OR "loginRetentionDays" = 0 OR "loginRetentionDays" BETWEEN 30 AND 3650',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
