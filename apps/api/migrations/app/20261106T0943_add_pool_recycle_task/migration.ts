#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/53f2de2363c0f079fbeffa0cec23330fe675854e5682a47eb88207af861418e1/contract';
import startContract from '../../snapshots/53f2de2363c0f079fbeffa0cec23330fe675854e5682a47eb88207af861418e1/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d2d7af91a22e92b04dbaaedaf249b774fec861bcd37d27fede68afb44a2613c9/contract';
import endContract from '../../snapshots/d2d7af91a22e92b04dbaaedaf249b774fec861bcd37d27fede68afb44a2613c9/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'pool_recycle_task',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('due_at', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('expected_collection_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('expected_create_time', 'int8', {
            notNull: true,
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('expected_follow_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('expected_owner_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('generation', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('last_error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('locked_until', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('organization_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pool_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resource_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resource_type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rule_fingerprint', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'pool_recycle_task_pkey' }),
          checkExpression('text_len_pool_recycle_task_id_3d66fb56', 'char_length("id") <= 32'),
          checkExpression(
            'text_len_pool_recycle_task_org_0ac99d67',
            'char_length("organization_id") <= 32',
          ),
          checkExpression(
            'text_len_pool_recycle_task_owner_35358913',
            'char_length("expected_owner_id") <= 32',
          ),
          checkExpression(
            'text_len_pool_recycle_task_pool_1f2f1db5',
            'char_length("pool_id") <= 32',
          ),
          checkExpression(
            'text_len_pool_recycle_task_resource_a5ef2b02',
            'char_length("resource_id") <= 32',
          ),
          checkExpression(
            'text_len_pool_recycle_task_type_84f90d67',
            'char_length("resource_type") <= 16',
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'pool_recycle_task',
        index: 'pool_recycle_task_org_status_due_at_idx',
        columns: ['organization_id', 'status', 'due_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'pool_recycle_task',
        index: 'pool_recycle_task_resource_key',
        columns: ['organization_id', 'resource_type', 'resource_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'pool_recycle_task',
        index: 'pool_recycle_task_status_due_at_idx',
        columns: ['status', 'due_at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
