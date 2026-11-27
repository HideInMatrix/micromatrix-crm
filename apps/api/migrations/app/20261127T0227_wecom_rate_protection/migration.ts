#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0c78dc85a10cec86f2c3b5a043ab02a7dcf421dd94fc2a18c6975a3e25839e8f/contract';
import endContract from '../../snapshots/0c78dc85a10cec86f2c3b5a043ab02a7dcf421dd94fc2a18c6975a3e25839e8f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7e3439789d16dee2bc4e192b53a0f4f30bc895cdbc8985d85d9a20b1424131f3/contract';
import startContract from '../../snapshots/7e3439789d16dee2bc4e192b53a0f4f30bc895cdbc8985d85d9a20b1424131f3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'wecom_rate_cooldowns',
        columns: [
          col('app_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('blocked_until', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['app_key'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'wecom_send_reservations',
        columns: [
          col('app_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('member_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reserved_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'wecom_rate_cooldowns',
        index: 'wecom_rate_cooldowns_expiry_idx',
        columns: ['blocked_until'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'wecom_send_reservations',
        index: 'wecom_send_reservations_app_time_idx',
        columns: ['app_key', 'reserved_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'wecom_send_reservations',
        index: 'wecom_send_reservations_expiry_idx',
        columns: ['reserved_at', 'id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'wecom_send_reservations',
        index: 'wecom_send_reservations_member_time_idx',
        columns: ['member_key', 'reserved_at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
