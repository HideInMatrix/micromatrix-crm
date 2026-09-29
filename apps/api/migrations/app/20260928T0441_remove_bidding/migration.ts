#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/8d20146e9378f026310c0d0495fc47ed2f313f5a77b27a50ea76fe27fd4f8f6c/contract';
import endContract from '../../snapshots/8d20146e9378f026310c0d0495fc47ed2f313f5a77b27a50ea76fe27fd4f8f6c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9d7edfaa09a05603882af604f7f566ac550540b03765f1a984fad2fe4625f3fc/contract';
import startContract from '../../snapshots/9d7edfaa09a05603882af604f7f566ac550540b03765f1a984fad2fe4625f3fc/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropTable({ schema: 'public', table: 'bidding_infos' }),
      this.dropTable({ schema: 'public', table: 'bidding_keyword_subs' }),
      this.dropTable({ schema: 'public', table: 'bidding_sources' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
