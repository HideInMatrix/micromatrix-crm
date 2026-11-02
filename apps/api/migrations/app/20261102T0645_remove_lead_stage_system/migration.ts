#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/53f2de2363c0f079fbeffa0cec23330fe675854e5682a47eb88207af861418e1/contract';
import endContract from '../../snapshots/53f2de2363c0f079fbeffa0cec23330fe675854e5682a47eb88207af861418e1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c103328401003630b4bdf5e0a6572a583bf87d6f2e9310020331b8e5ad54d62e/contract';
import startContract from '../../snapshots/c103328401003630b4bdf5e0a6572a583bf87d6f2e9310020331b8e5ad54d62e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'clue',
        constraint: 'text_len_28f6d7aae3_ced8e2eb',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'clue',
        constraint: 'text_len_8cb7c75bb9_8e04cd04',
      }),
      this.dropColumn({ schema: 'public', table: 'clue', column: 'last_stage' }),
      this.dropColumn({ schema: 'public', table: 'clue', column: 'stage' }),
      this.dropTable({ schema: 'public', table: 'lead_stage_event' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
