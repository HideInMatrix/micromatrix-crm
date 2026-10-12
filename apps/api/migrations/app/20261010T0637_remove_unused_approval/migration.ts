#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/462205e1036c514a55adfc646f31732f48e0c543ad244006dd99f3f2492bd3ca/contract';
import endContract from '../../snapshots/462205e1036c514a55adfc646f31732f48e0c543ad244006dd99f3f2492bd3ca/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/84a7bfdd8e9ff7e81dee91f5826ae2a9f529450a47db982ccfc5db4cba2b322b/contract';
import startContract from '../../snapshots/84a7bfdd8e9ff7e81dee91f5826ae2a9f529450a47db982ccfc5db4cba2b322b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // ApprovalFlows.currentVersionId and ApprovalFlowVersions.flowId form a
      // circular FK dependency. Break it before dropping tables bottom-up.
      this.dropConstraint({
        schema: 'public',
        table: 'approval_flows',
        constraint: 'approval_flows_currentVersionId_fkey',
      }),
      this.dropTable({ schema: 'public', table: 'approval_add_sign_tasks' }),
      this.dropTable({ schema: 'public', table: 'approval_flow_number_counters' }),
      this.dropTable({ schema: 'public', table: 'approval_instance_attachments' }),
      this.dropTable({ schema: 'public', table: 'approval_node_approvers' }),
      this.dropTable({ schema: 'public', table: 'approval_node_conditions' }),
      this.dropTable({ schema: 'public', table: 'approval_node_links' }),
      this.dropTable({ schema: 'public', table: 'approval_records' }),
      this.dropTable({ schema: 'public', table: 'approval_return_back_records' }),
      this.dropTable({ schema: 'public', table: 'approval_webhook_deliveries' }),
      this.dropTable({ schema: 'public', table: 'approval_resource_snapshots' }),
      this.dropTable({ schema: 'public', table: 'approval_tasks' }),
      this.dropTable({ schema: 'public', table: 'approval_nodes' }),
      this.dropTable({ schema: 'public', table: 'approval_instances' }),
      this.dropTable({ schema: 'public', table: 'approval_flow_versions' }),
      this.dropTable({ schema: 'public', table: 'approval_flows' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalAddSignType' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalExecuteTiming' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalFormType' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalInstanceStatus' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalMode' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalNodeType' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalTaskAction' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalTaskStatus' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalTaskType' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalWebhookDeliverySource' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApprovalWebhookDeliveryStatus' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApproverDirection' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'ApproverType' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'DuplicateApproverRule' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'EmptyApproverAction' }),
      this.dropNativeEnumType({ schema: 'public', typeName: 'SameSubmitterAction' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
