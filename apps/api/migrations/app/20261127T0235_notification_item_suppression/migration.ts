#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1d28ae6b1c6d6784313f86c2fc35b7795dc83b2c19acee63394b1d64458123ed/contract';
import startContract from '../../snapshots/1d28ae6b1c6d6784313f86c2fc35b7795dc83b2c19acee63394b1d64458123ed/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9babdd3b9f0b0022454e51a2a77c9e2de16f0cc83859502e09c248c2e3b24f02/contract';
import endContract from '../../snapshots/9babdd3b9f0b0022454e51a2a77c9e2de16f0cc83859502e09c248c2e3b24f02/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'notification_items',
        column: col('suppressed_at', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'notification_items',
        column: col('suppression_reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
