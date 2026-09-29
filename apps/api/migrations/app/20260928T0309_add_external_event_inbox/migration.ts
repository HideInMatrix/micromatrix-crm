#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9d7edfaa09a05603882af604f7f566ac550540b03765f1a984fad2fe4625f3fc/contract';
import endContract from '../../snapshots/9d7edfaa09a05603882af604f7f566ac550540b03765f1a984fad2fe4625f3fc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d6d0c5805c50b5a9a192a7d16884c2ee18453b0836bb0ce35df65fec350e2d7c/contract';
import startContract from '../../snapshots/d6d0c5805c50b5a9a192a7d16884c2ee18453b0836bb0ce35df65fec350e2d7c/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
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
        table: 'external_event_inbox',
        columns: [
          col('api_key_user_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('attempts', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('completed_at', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('customer_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('error_code', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('error_message', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('external_event_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('organization_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('received_at', 'timestamptz(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('request_hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resolved_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolved_type', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('started_at', 'timestamptz(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('PROCESSING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updated_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'external_event_inbox_pkey' }),
          checkExpression(
            'eei_resolved_type_domain_rule_70bfae9d',
            '"resolved_type" IS NULL OR "resolved_type" IN (\'CUSTOMER\',\'LEAD\')',
          ),
          checkExpression(
            'eei_status_domain_rule_7683d47e',
            "\"status\" IN ('PROCESSING','SUCCESS','FAILED')",
          ),
          checkExpression(
            'external_event_inbox_api_key_user_id_len_4cd2417e',
            'char_length("api_key_user_id") <= 32',
          ),
          checkExpression(
            'external_event_inbox_customer_id_len_98c57c01',
            'char_length("customer_id") <= 32',
          ),
          checkExpression(
            'external_event_inbox_error_code_len_b877baec',
            'char_length("error_code") <= 100',
          ),
          checkExpression(
            'external_event_inbox_error_message_len_808566f9',
            'char_length("error_message") <= 2000',
          ),
          checkExpression(
            'external_event_inbox_external_event_id_len_40c71264',
            'char_length("external_event_id") <= 200',
          ),
          checkExpression(
            'external_event_inbox_organization_id_len_0ac99d67',
            'char_length("organization_id") <= 32',
          ),
          checkExpression(
            'external_event_inbox_request_hash_len_3f9094fd',
            'char_length("request_hash") = 64',
          ),
          checkExpression(
            'external_event_inbox_resolved_id_len_c4e1f55c',
            'char_length("resolved_id") <= 32',
          ),
          checkExpression(
            'external_event_inbox_source_len_060042c0',
            'char_length("source") <= 100',
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_event_inbox',
        index: 'external_event_inbox_org_customer_completed_at_idx',
        columns: ['organization_id', 'customer_id', 'completed_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_event_inbox',
        index: 'external_event_inbox_org_source_event_key',
        columns: ['organization_id', 'source', 'external_event_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_event_inbox',
        index: 'external_event_inbox_org_status_updated_at_idx',
        columns: ['organization_id', 'status', 'updated_at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
