#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0c78dc85a10cec86f2c3b5a043ab02a7dcf421dd94fc2a18c6975a3e25839e8f/contract';
import startContract from '../../snapshots/0c78dc85a10cec86f2c3b5a043ab02a7dcf421dd94fc2a18c6975a3e25839e8f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/1d28ae6b1c6d6784313f86c2fc35b7795dc83b2c19acee63394b1d64458123ed/contract';
import endContract from '../../snapshots/1d28ae6b1c6d6784313f86c2fc35b7795dc83b2c19acee63394b1d64458123ed/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'message_deliveries',
        index: 'message_deliveries_channel_status_due_idx',
        columns: ['channel', 'status', 'nextAttemptAt', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
