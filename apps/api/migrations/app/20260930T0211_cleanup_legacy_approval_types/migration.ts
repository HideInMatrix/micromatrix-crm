#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/244779402c6406785cb7478c93e39b89747a96ac9d904795e728dd9b40253db7/contract';
import startContract from '../../snapshots/244779402c6406785cb7478c93e39b89747a96ac9d904795e728dd9b40253db7/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/84a7bfdd8e9ff7e81dee91f5826ae2a9f529450a47db982ccfc5db4cba2b322b/contract';
import endContract from '../../snapshots/84a7bfdd8e9ff7e81dee91f5826ae2a9f529450a47db982ccfc5db4cba2b322b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      rawSql({
        id: 'approval-form-type.collapse-to-generic',
        label: 'Collapse ApprovalFormType to GENERIC',
        operationClass: 'destructive',
        target: {
          id: 'public.ApprovalFormType',
          details: {
            schema: 'public',
            objectType: 'type',
            name: 'ApprovalFormType',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'Replace legacy approval form enum values with GENERIC',
            sql: `
CREATE TYPE "public"."ApprovalFormType__generic" AS ENUM ('GENERIC');

ALTER TABLE "public"."approval_flows"
  ALTER COLUMN "formType" TYPE "public"."ApprovalFormType__generic"
  USING 'GENERIC'::"public"."ApprovalFormType__generic";

ALTER TABLE "public"."approval_flow_number_counters"
  ALTER COLUMN "formType" TYPE "public"."ApprovalFormType__generic"
  USING 'GENERIC'::"public"."ApprovalFormType__generic";

ALTER TABLE "public"."approval_resource_snapshots"
  ALTER COLUMN "formType" TYPE "public"."ApprovalFormType__generic"
  USING 'GENERIC'::"public"."ApprovalFormType__generic";

DROP TYPE "public"."ApprovalFormType";
ALTER TYPE "public"."ApprovalFormType__generic" RENAME TO "ApprovalFormType";
`.trim(),
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
