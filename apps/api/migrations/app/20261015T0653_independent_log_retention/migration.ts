#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/36d0c17775db10dde420cf0b81754420eea1a93e54cf5ab5fdabeef4c8bdd88e/contract';
import endContract from '../../snapshots/36d0c17775db10dde420cf0b81754420eea1a93e54cf5ab5fdabeef4c8bdd88e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e7ff8583e9210f427e85001683c3508599467c5d9904b1c954cdd686b55379b1/contract';
import startContract from '../../snapshots/e7ff8583e9210f427e85001683c3508599467c5d9904b1c954cdd686b55379b1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'operation_log_settings',
        column: col('eventLastCleanupAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'operation_log_settings',
        column: col('eventLastCleanupDeleted', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'operation_log_settings',
        column: col('eventLastCleanupSource', '"OperationLogCleanupSource"', {
          codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'OperationLogCleanupSource' } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'operation_log_settings',
        column: col('eventRetentionDays', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'operation_log_settings',
        column: col('loginLastCleanupAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'operation_log_settings',
        column: col('loginLastCleanupDeleted', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'operation_log_settings',
        column: col('loginLastCleanupSource', '"OperationLogCleanupSource"', {
          codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'OperationLogCleanupSource' } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'operation_log_settings',
        column: col('loginRetentionDays', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
