#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/462205e1036c514a55adfc646f31732f48e0c543ad244006dd99f3f2492bd3ca/contract';
import startContract from '../../snapshots/462205e1036c514a55adfc646f31732f48e0c543ad244006dd99f3f2492bd3ca/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e7ff8583e9210f427e85001683c3508599467c5d9904b1c954cdd686b55379b1/contract';
import endContract from '../../snapshots/e7ff8583e9210f427e85001683c3508599467c5d9904b1c954cdd686b55379b1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'external_event_templates',
        columns: [
          col('api_key_user_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('config', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('created_at', 'timestamptz(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('enabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('event_type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenant_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('version', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'external_event_templates_pkey' })],
      }),
      this.addColumn({
        schema: 'public',
        table: 'external_event_inbox',
        column: col('event_type', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_event_templates',
        index: 'external_event_templates_tenant_event_key',
        columns: ['tenant_id', 'event_type'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_event_templates',
        index: 'external_event_templates_tenant_source_idx',
        columns: ['tenant_id', 'source', 'enabled'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
