#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4a68c767b49167c5bb54dd466f46873a34b71e93b3fe1e248a8bfd7f84daf50c/contract';
import startContract from '../../snapshots/4a68c767b49167c5bb54dd466f46873a34b71e93b3fe1e248a8bfd7f84daf50c/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7e3439789d16dee2bc4e192b53a0f4f30bc895cdbc8985d85d9a20b1424131f3/contract';
import endContract from '../../snapshots/7e3439789d16dee2bc4e192b53a0f4f30bc895cdbc8985d85d9a20b1424131f3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'message_deliveries',
        column: col('claim_token', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'notification_batches',
        column: col('next_seal_attempt_at', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'notification_batches',
        column: col('seal_dead_at', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'notification_batches',
        column: col('seal_error_code', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'notification_batches',
        column: col('seal_failures', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_batches',
        index: 'notification_batches_retry_due_idx',
        columns: ['sealed_at', 'seal_dead_at', 'window_end', 'next_seal_attempt_at', 'id'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
