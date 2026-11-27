#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4a68c767b49167c5bb54dd466f46873a34b71e93b3fe1e248a8bfd7f84daf50c/contract';
import endContract from '../../snapshots/4a68c767b49167c5bb54dd466f46873a34b71e93b3fe1e248a8bfd7f84daf50c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b98e2e0095b5b2eda78eb91d8c1ae761c47e917e169f38c9f66f583bd250d100/contract';
import startContract from '../../snapshots/b98e2e0095b5b2eda78eb91d8c1ae761c47e917e169f38c9f66f583bd250d100/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'notification_batches',
        columns: [
          col('aggregation_group', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('aggregation_mode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('category', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('credential_version', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('external_subject', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integration_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('item_count', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('language', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('output_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('priority', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('recipient_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scope_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sealed_at', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('shard', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('tenant_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('window_end', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('window_start', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'notification_batches_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'notification_items',
        columns: [
          col('batch_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('content', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('event', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('link', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('link_label', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('occurred_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('source_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('source_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source_type', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'notification_items_pkey' })],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_batches',
        index: 'notification_batches_channel_output_key',
        columns: ['channel', 'output_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_batches',
        index: 'notification_batches_due_idx',
        columns: ['sealed_at', 'window_end', 'id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_batches',
        index: 'notification_batches_recipient_idx',
        columns: ['tenant_id', 'recipient_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_batches',
        index: 'notification_batches_scope_shard_key',
        columns: ['scope_key', 'shard'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_items',
        index: 'notification_items_batch_page_idx',
        columns: ['batch_id', 'created_at', 'id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_items',
        index: 'notification_items_source_key',
        columns: ['source_key'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'notification_items',
        foreignKey: {
          name: 'notification_items_batch_id_fkey',
          columns: ['batch_id'],
          references: { schema: 'public', table: 'notification_batches', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
