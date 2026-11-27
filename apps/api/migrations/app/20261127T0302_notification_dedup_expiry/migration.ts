#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/04e83c33b814a1d763ed5f79d20f9e22cb2a1ad42438a4bf3a71c10eac4880bc/contract';
import startContract from '../../snapshots/04e83c33b814a1d763ed5f79d20f9e22cb2a1ad42438a4bf3a71c10eac4880bc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ec057e0ddaf5100ae8da7f222754f62c016aea36707f1a404d5fac803a3dda36/contract';
import endContract from '../../snapshots/ec057e0ddaf5100ae8da7f222754f62c016aea36707f1a404d5fac803a3dda36/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'notification_source_tombstones',
        column: col('expires_at', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_source_tombstones',
        index: 'notification_source_tombstones_expiry_idx',
        columns: ['expires_at', 'source_key'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
