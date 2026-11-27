#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/d42f976229912985a97851f800785770ca8d00dab8243e56e5466526e1030df5/contract';
import endContract from '../../snapshots/d42f976229912985a97851f800785770ca8d00dab8243e56e5466526e1030df5/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ec057e0ddaf5100ae8da7f222754f62c016aea36707f1a404d5fac803a3dda36/contract';
import startContract from '../../snapshots/ec057e0ddaf5100ae8da7f222754f62c016aea36707f1a404d5fac803a3dda36/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'notification_source_tombstones',
        column: col('tenant_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'notification_source_tombstones',
        index: 'notification_source_tombstones_tenant_expiry_idx',
        columns: ['tenant_id', 'expires_at', 'source_key'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
