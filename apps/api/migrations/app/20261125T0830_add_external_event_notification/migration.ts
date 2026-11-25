#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b98e2e0095b5b2eda78eb91d8c1ae761c47e917e169f38c9f66f583bd250d100/contract';
import endContract from '../../snapshots/b98e2e0095b5b2eda78eb91d8c1ae761c47e917e169f38c9f66f583bd250d100/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d2d7af91a22e92b04dbaaedaf249b774fec861bcd37d27fede68afb44a2613c9/contract';
import startContract from '../../snapshots/d2d7af91a22e92b04dbaaedaf249b774fec861bcd37d27fede68afb44a2613c9/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'external_event_notification',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('created_at', 'timestamptz(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('event', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('inbox_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('link', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('next_attempt_at', 'timestamptz(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('operator_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recipient_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resource_name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenant_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'external_event_notification_pkey' })],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_event_notification',
        index: 'external_event_notification_due_idx',
        columns: ['next_attempt_at', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_event_notification',
        index: 'external_event_notification_inbox_event_key',
        columns: ['inbox_id', 'event'],
        extras: { unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
