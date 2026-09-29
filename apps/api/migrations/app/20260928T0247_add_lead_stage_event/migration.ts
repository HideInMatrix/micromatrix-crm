#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/d6d0c5805c50b5a9a192a7d16884c2ee18453b0836bb0ce35df65fec350e2d7c/contract';
import endContract from '../../snapshots/d6d0c5805c50b5a9a192a7d16884c2ee18453b0836bb0ce35df65fec350e2d7c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/dee42ec15d90123679a39e92cd8468c445ed20dea1161a6b69ba8c615206c7b1/contract';
import startContract from '../../snapshots/dee42ec15d90123679a39e92cd8468c445ed20dea1161a6b69ba8c615206c7b1/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'lead_stage_event',
        columns: [
          col('from_stage_key', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lead_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurred_at', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('operator_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('organization_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('owner_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('to_stage_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id'], { name: 'lead_stage_event_pkey' }),
          checkExpression(
            'lead_stage_event_from_stage_key_len_fbe4a7ae',
            'char_length("from_stage_key") <= 30',
          ),
          checkExpression('lead_stage_event_id_len_3d66fb56', 'char_length("id") <= 32'),
          checkExpression('lead_stage_event_lead_id_len_014967bd', 'char_length("lead_id") <= 32'),
          checkExpression(
            'lead_stage_event_operator_id_len_436760a5',
            'char_length("operator_id") <= 32',
          ),
          checkExpression(
            'lead_stage_event_organization_id_len_0ac99d67',
            'char_length("organization_id") <= 32',
          ),
          checkExpression(
            'lead_stage_event_owner_id_len_dc83cd8f',
            'char_length("owner_id") <= 32',
          ),
          checkExpression('lead_stage_event_source_len_5b27430a', 'char_length("source") <= 30'),
          checkExpression(
            'lead_stage_event_to_stage_key_len_f854f770',
            'char_length("to_stage_key") <= 30',
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'lead_stage_event',
        index: 'lead_stage_event_lead_id_occurred_at_idx',
        columns: ['lead_id', 'occurred_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'lead_stage_event',
        index: 'lead_stage_event_organization_id_occurred_at_idx',
        columns: ['organization_id', 'occurred_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'lead_stage_event',
        index: 'lead_stage_event_organization_id_owner_id_occurred_at_idx',
        columns: ['organization_id', 'owner_id', 'occurred_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'lead_stage_event',
        index: 'lead_stage_event_organization_id_to_stage_key_occurred_at_idx',
        columns: ['organization_id', 'to_stage_key', 'occurred_at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
