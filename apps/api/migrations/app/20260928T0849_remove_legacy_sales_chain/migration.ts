#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/244779402c6406785cb7478c93e39b89747a96ac9d904795e728dd9b40253db7/contract';
import endContract from '../../snapshots/244779402c6406785cb7478c93e39b89747a96ac9d904795e728dd9b40253db7/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/8d20146e9378f026310c0d0495fc47ed2f313f5a77b27a50ea76fe27fd4f8f6c/contract';
import startContract from '../../snapshots/8d20146e9378f026310c0d0495fc47ed2f313f5a77b27a50ea76fe27fd4f8f6c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'clue',
        constraint: 'text_len_d1404981a3_007536a6',
      }),
      this.dropColumn({ schema: 'public', table: 'clue', column: 'products' }),
      this.dropTable({ schema: 'public', table: 'business_title_config' }),
      this.dropTable({ schema: 'public', table: 'contract_field' }),
      this.dropTable({ schema: 'public', table: 'contract_field_blob' }),
      this.dropTable({ schema: 'public', table: 'contract_invoice_field' }),
      this.dropTable({ schema: 'public', table: 'contract_invoice_field_blob' }),
      this.dropTable({ schema: 'public', table: 'contract_invoice_snapshot' }),
      this.dropTable({ schema: 'public', table: 'contract_payment_plan_field' }),
      this.dropTable({ schema: 'public', table: 'contract_payment_plan_field_blob' }),
      this.dropTable({ schema: 'public', table: 'contract_payment_record_field' }),
      this.dropTable({ schema: 'public', table: 'contract_payment_record_field_blob' }),
      this.dropTable({ schema: 'public', table: 'contract_snapshot' }),
      this.dropTable({ schema: 'public', table: 'contract_stage_config' }),
      this.dropTable({ schema: 'public', table: 'opportunity_field' }),
      this.dropTable({ schema: 'public', table: 'opportunity_field_blob' }),
      this.dropTable({ schema: 'public', table: 'opportunity_quotation_field' }),
      this.dropTable({ schema: 'public', table: 'opportunity_quotation_field_blob' }),
      this.dropTable({ schema: 'public', table: 'opportunity_quotation_snapshot' }),
      this.dropTable({ schema: 'public', table: 'opportunity_rule' }),
      this.dropTable({ schema: 'public', table: 'product_field' }),
      this.dropTable({ schema: 'public', table: 'product_field_blob' }),
      this.dropTable({ schema: 'public', table: 'product_price_field' }),
      this.dropTable({ schema: 'public', table: 'product_price_field_blob' }),
      this.dropTable({ schema: 'public', table: 'sales_order_field' }),
      this.dropTable({ schema: 'public', table: 'sales_order_field_blob' }),
      this.dropTable({ schema: 'public', table: 'sales_order_snapshot' }),
      this.dropTable({ schema: 'public', table: 'sales_order_stage_config' }),
      this.dropTable({ schema: 'public', table: 'contract_invoice' }),
      this.dropTable({ schema: 'public', table: 'contract_payment_record' }),
      this.dropTable({ schema: 'public', table: 'opportunity_quotation' }),
      this.dropTable({ schema: 'public', table: 'product' }),
      this.dropTable({ schema: 'public', table: 'product_price' }),
      this.dropTable({ schema: 'public', table: 'sales_order' }),
      this.dropTable({ schema: 'public', table: 'business_title' }),
      this.dropTable({ schema: 'public', table: 'contract_payment_plan' }),
      this.dropTable({ schema: 'public', table: 'opportunity' }),
      this.dropTable({ schema: 'public', table: 'contract' }),
      this.dropTable({ schema: 'public', table: 'opportunity_stage_config' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
