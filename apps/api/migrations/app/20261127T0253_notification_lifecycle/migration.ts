#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/04e83c33b814a1d763ed5f79d20f9e22cb2a1ad42438a4bf3a71c10eac4880bc/contract';
import endContract from '../../snapshots/04e83c33b814a1d763ed5f79d20f9e22cb2a1ad42438a4bf3a71c10eac4880bc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9babdd3b9f0b0022454e51a2a77c9e2de16f0cc83859502e09c248c2e3b24f02/contract';
import startContract from '../../snapshots/9babdd3b9f0b0022454e51a2a77c9e2de16f0cc83859502e09c248c2e3b24f02/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'notification_lifecycle_cursors',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('last_batch_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'notification_source_tombstones',
        columns: [
          col('batch_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('item_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['source_key'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'notification_batches',
        column: col('details_archived_at', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
