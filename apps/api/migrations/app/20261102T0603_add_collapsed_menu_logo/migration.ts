#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/64049bfca7242c507d98c1aee2ef571b04780557fe299dff6b72299f54f0b105/contract';
import startContract from '../../snapshots/64049bfca7242c507d98c1aee2ef571b04780557fe299dff6b72299f54f0b105/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c103328401003630b4bdf5e0a6572a583bf87d6f2e9310020331b8e5ad54d62e/contract';
import endContract from '../../snapshots/c103328401003630b4bdf5e0a6572a583bf87d6f2e9310020331b8e5ad54d62e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'enterprise_ui_settings',
        column: col('collapsedLogoAttachmentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
