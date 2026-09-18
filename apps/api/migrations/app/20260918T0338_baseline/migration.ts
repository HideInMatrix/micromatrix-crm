#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/651134f9ccfda014c4a27d235488e56b4640ad20fbf307fe0acaa0b8e39566de/contract';
import endContract from '../../snapshots/651134f9ccfda014c4a27d235488e56b4640ad20fbf307fe0acaa0b8e39566de/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalAddSignType',
        members: ['BEFORE', 'AFTER'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalExecuteTiming',
        members: ['CREATE', 'UPDATE', 'DELETE'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalFormType',
        members: ['QUOTATION', 'CONTRACT', 'INVOICE', 'ORDER', 'RECEIVABLE_RECORD_LEGACY'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalInstanceStatus',
        members: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalMode',
        members: ['ALL', 'ANY'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalNodeType',
        members: ['START', 'APPROVER', 'CONDITION', 'DEFAULT', 'END'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalTaskAction',
        members: ['APPROVE', 'REJECT', 'SIGN', 'BACK'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalTaskStatus',
        members: ['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalTaskType',
        members: ['APPROVAL', 'CC', 'SIGN', 'BACK'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalWebhookDeliverySource',
        members: ['TEST', 'RUNTIME'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApprovalWebhookDeliveryStatus',
        members: ['PENDING', 'SENT', 'FAILED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApproverDirection',
        members: ['BOTTOM_UP', 'TOP_DOWN'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ApproverType',
        members: [
          'USER',
          'ROLE',
          'DEPT_LEADER',
          'DIRECT_LEADER',
          'MULTIPLE_DEPT_LEADER',
          'MULTIPLE_DIRECT_LEADER',
        ],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'DataScope',
        members: ['ALL', 'DEPT_AND_CHILD', 'DEPT', 'SELF', 'CUSTOM'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'DuplicateApproverRule',
        members: ['FIRST_ONLY', 'SEQUENTIAL_ALL', 'EACH'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'EmptyApproverAction',
        members: ['AUTO_PASS', 'ASSIGN_SPECIFIC', 'ASSIGN_ADMIN'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'EnterpriseIntegrationProvider',
        members: ['WECOM', 'DINGTALK', 'LARK'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ExternalIdentityStatus',
        members: ['ACTIVE', 'REVOKED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ExternalOAuthFlow',
        members: ['QR_WECOM', 'WECOM', 'QR_DINGTALK', 'DINGTALK', 'QR_LARK', 'LARK', 'LARK_MOBILE'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'FollowUpPlanStatus',
        members: ['PREPARED', 'UNDERWAY', 'COMPLETED', 'CANCELLED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'MessageDeliveryChannel',
        members: ['WECOM', 'DINGTALK', 'LARK', 'EMAIL'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'MessageDeliveryStatus',
        members: ['PENDING', 'SENDING', 'SUCCEEDED', 'FAILED', 'DEAD'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'OperationLogCleanupSource',
        members: ['AUTO', 'MANUAL'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'OrganizationSyncAction',
        members: ['CREATE', 'UPDATE', 'DISABLE', 'UNCHANGED', 'CONFLICT', 'SKIP'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'OrganizationSyncItemResult',
        members: ['PENDING', 'RESOLVED', 'APPLIED', 'SKIPPED', 'FAILED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'OrganizationSyncResolution',
        members: ['BIND', 'SKIP'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'OrganizationSyncResourceType',
        members: ['DEPARTMENT', 'USER'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'OrganizationSyncStatus',
        members: ['FETCHING', 'PREVIEW_READY', 'APPLYING', 'SUCCEEDED', 'FAILED', 'INVALIDATED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'SameSubmitterAction',
        members: ['SKIP', 'ALLOW', 'ASSIGN_SUPERIOR'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'SubscriptionStatus',
        members: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'TenantStatus',
        members: ['ACTIVE', 'SUSPENDED'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'UserStatus',
        members: ['ACTIVE', 'DISABLED'],
      }),
      this.createTable({
        schema: 'public',
        table: 'announcements',
        columns: [
          col('content', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createUserId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('departmentIds', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('endAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('linkName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('notice', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('receiverUserIds', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('startAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('subject', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updateUserId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userIds', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'announcements_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_add_sign_tasks',
        columns: [
          col('comment', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('created_by_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instanceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('root_task_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sign_task_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sort', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('task_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', '"ApprovalAddSignType"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalAddSignType' } },
          }),
          col('updated_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_add_sign_tasks_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_flow_number_counters',
        columns: [
          col('formType', '"ApprovalFormType"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalFormType' } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('nextValue', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_flow_number_counters_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_flow_versions',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('flowId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_flow_versions_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_flows',
        columns: [
          col('allowAddSign', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('allowBatchProcess', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('allowWithdraw', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('condition', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('createExecute', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('currentVersionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('deleteExecute', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('deletedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('description', 'character varying(1000)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 1000 } },
          }),
          col('duplicateApproverRule', '"DuplicateApproverRule"', {
            notNull: true,
            default: lit('FIRST_ONLY'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'DuplicateApproverRule' } },
          }),
          col('enabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('formType', '"ApprovalFormType"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalFormType' } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('number', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requireComment', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('submitterCanRevoke', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updateExecute', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('updatedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_flows_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_instance_attachments',
        columns: [
          col('attachment_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('element_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instance_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_instance_attachments_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_instances',
        columns: [
          col('comment', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('currentNodeIndex', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('executeTiming', '"ApprovalExecuteTiming"', {
            notNull: true,
            default: lit('CREATE'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalExecuteTiming' } },
          }),
          col('finishedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('flowId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('flowVersionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('module', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('nodesSnapshot', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('status', '"ApprovalInstanceStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalInstanceStatus' } },
          }),
          col('submitterId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('submitterName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('summary', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('targetId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('update_fields', 'character varying(2000)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 2000 } },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_instances_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_node_approvers',
        columns: [
          col('approverIds', 'text[]', { codecRef: { codecId: 'pg/text@1', many: true } }),
          col('approverType', '"ApproverType"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApproverType' } },
          }),
          col('approver_direction', '"ApproverDirection"', {
            notNull: true,
            default: lit('BOTTOM_UP'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApproverDirection' } },
          }),
          col('cc_user_ids', 'text[]', { codecRef: { codecId: 'pg/text@1', many: true } }),
          col('empty_approver_action', '"EmptyApproverAction"', {
            notNull: true,
            default: lit('AUTO_PASS'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'EmptyApproverAction' } },
          }),
          col('fallback_approver', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('field_permissions', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mode', '"ApprovalMode"', {
            notNull: true,
            default: lit('ANY'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalMode' } },
          }),
          col('nodeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pass_post_config', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('reject_post_config', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('same_submitter_action', '"SameSubmitterAction"', {
            notNull: true,
            default: lit('SKIP'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'SameSubmitterAction' } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_node_approvers_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_node_conditions',
        columns: [
          col('condition_config', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('flowVersionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_node_conditions_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_node_links',
        columns: [
          col('flowVersionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('fromNodeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sort', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('toNodeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_node_links_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_nodes',
        columns: [
          col('executeTiming', '"ApprovalExecuteTiming"', {
            notNull: true,
            default: lit('CREATE'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalExecuteTiming' } },
          }),
          col('flowVersionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('nodeType', '"ApprovalNodeType"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalNodeType' } },
          }),
          col('number', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sort', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_nodes_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_records',
        columns: [
          col('comment', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('created_by_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instanceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('node_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('node_round', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('result', '"ApprovalTaskAction"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalTaskAction' } },
          }),
          col('taskId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_records_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_resource_snapshots',
        columns: [
          col('created_at', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('created_by_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('formType', '"ApprovalFormType"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalFormType' } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resourceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('snapshot_data', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('updated_by_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_resource_snapshots_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_return_back_records',
        columns: [
          col('created_at', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instance_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('return_reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('return_to_node_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('return_user_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('task_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_return_back_records_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_tasks',
        columns: [
          col('action', '"ApprovalTaskAction"', {
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalTaskAction' } },
          }),
          col('approverId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('handledAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instanceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('nodeIndex', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('nodeName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('node_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('node_round', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', '"ApprovalTaskStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalTaskStatus' } },
          }),
          col('task_type', '"ApprovalTaskType"', {
            notNull: true,
            default: lit('APPROVAL'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ApprovalTaskType' } },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_tasks_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'approval_webhook_deliveries',
        columns: [
          col('action', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('created_by_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('duration_ms', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('error_code', 'character varying(64)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 64 } },
          }),
          col('error_message', 'character varying(500)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 500 } },
          }),
          col('finished_at', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('flow_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('flow_version_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('http_status', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instance_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('method', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('node_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('node_index', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('response_bytes', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('source', '"ApprovalWebhookDeliverySource"', {
            notNull: true,
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'ApprovalWebhookDeliverySource' },
            },
          }),
          col('started_at', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('status', '"ApprovalWebhookDeliveryStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'ApprovalWebhookDeliveryStatus' },
            },
          }),
          col('target_origin', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('target_path', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenant_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'approval_webhook_deliveries_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'attachments',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mime', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('path', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('size', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('targetId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('targetType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('uploaderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'attachments_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'bidding_infos',
        columns: [
          col('budget', 'numeric(16,2)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 16, scale: 2 } },
          }),
          col('buyer', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('content', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('convertedLeadId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('deadline', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('keyword', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('publishedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('region', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'bidding_infos_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'bidding_keyword_subs',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('enabled', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('keyword', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'bidding_keyword_subs_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'bidding_sources',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('credentials', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('enabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastFetchAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'bidding_sources_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'business_title',
        columns: [
          col('approval_status', 'character varying(50)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('bank_account', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('city', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('company_number', 'BIGSERIAL', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('company_size', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('identification_number', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('industry', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('opening_bank', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('phone_number', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('province', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('registered_capital', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('registration_address', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('registration_number', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('remark', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('scale', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('type', 'character varying(50)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('unapproved_reason', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'business_title_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'business_title_config',
        columns: [
          col('field', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('required', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'business_title_config_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'clue',
        columns: [
          col('collection_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('contact', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('follow_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('follower', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('in_shared_pool', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('last_stage', 'character varying(30)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 30 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('phone', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('pool_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('products', 'character varying(1000)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 1000 } },
          }),
          col('reason_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('stage', 'character varying(30)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 30 } },
          }),
          col('transition_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('transition_type', 'character varying(30)', {
            default: lit('NONE'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 30 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'clue_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'clue_capacity',
        columns: [
          col('capacity', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('scope_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'clue_capacity_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'clue_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'clue_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'clue_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'clue_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'clue_owner',
        columns: [
          col('clue_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('collection_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('end_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('operator', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('reason_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'clue_owner_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'clue_pool',
        columns: [
          col('auto', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scope_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'clue_pool_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'clue_pool_hidden_field',
        columns: [
          col('field_id', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('pool_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['pool_id', 'field_id'], { name: 'clue_pool_hidden_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'clue_pool_pick_rule',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('limit_new', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('limit_on_number', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('limit_pre_owner', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('new_pick_interval', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('pick_interval_days', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('pick_number', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('pool_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'clue_pool_pick_rule_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'clue_pool_recycle_rule',
        columns: [
          col('condition', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('operator', 'character varying(10)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 10 } },
          }),
          col('pool_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'clue_pool_recycle_rule_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract',
        columns: [
          col('amount', 'numeric(14,2)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 14, scale: 2 } },
          }),
          col('approval_status', 'character varying(50)', {
            notNull: true,
            default: lit('NONE'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('approved', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('customer_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('end_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('number', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('stage', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('start_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('void_reason', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_field',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_field_blob',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_invoice',
        columns: [
          col('amount', 'numeric(20,10)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 20, scale: 10 } },
          }),
          col('approval_status', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('approved', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('business_title_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('contract_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('invoice_type', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('tax_rate', 'numeric(20,10)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 20, scale: 10 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_invoice_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_invoice_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_invoice_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_invoice_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_invoice_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_invoice_snapshot',
        columns: [
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('invoice_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('invoice_prop', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('invoice_value', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_invoice_snapshot_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_payment_plan',
        columns: [
          col('contract_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('plan_amount', 'numeric(20,10)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 20, scale: 10 } },
          }),
          col('plan_end_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('plan_status', 'character varying(32)', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_payment_plan_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_payment_plan_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_payment_plan_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_payment_plan_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_payment_plan_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_payment_record',
        columns: [
          col('contract_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('no', 'character varying(50)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('payment_plan_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('record_amount', 'numeric(20,10)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 20, scale: 10 } },
          }),
          col('record_end_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_payment_record_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_payment_record_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_payment_record_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_payment_record_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_payment_record_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_snapshot',
        columns: [
          col('contract_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('contract_prop', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('contract_value', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_snapshot_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'contract_stage_config',
        columns: [
          col('afoot_roll_back', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('circulation_type', 'character varying(50)', {
            notNull: true,
            default: lit('NORMAL'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('end_roll_back', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('type', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'contract_stage_config_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'custom_form',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'custom_form_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'custom_form_admin',
        columns: [
          col('custom_form_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('user_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'custom_form_admin_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'custom_form_data',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('custom_form_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'custom_form_data_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'custom_form_data_field',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'custom_form_data_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'custom_form_data_field_blob',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'custom_form_data_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'custom_form_role',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('custom_form_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('internal_key', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'custom_form_role_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'custom_form_role_user',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('role_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('user_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'custom_form_role_user_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer',
        columns: [
          col('collection_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('follow_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('follower', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('in_shared_pool', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pool_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('reason_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_capacity',
        columns: [
          col('capacity', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('filter', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('scope_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_capacity_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_collaboration',
        columns: [
          col('collaboration_type', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('customer_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('user_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_collaboration_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_contact',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('customer_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('disable_reason', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('phone', 'character varying(30)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 30 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_contact_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_contact_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_contact_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_contact_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_contact_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_owner',
        columns: [
          col('collection_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('customer_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('end_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('operator', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('reason_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_owner_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_pool',
        columns: [
          col('auto', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scope_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_pool_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_pool_hidden_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pool_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [
          primaryKey(['pool_id', 'field_id'], { name: 'customer_pool_hidden_field_pkey' }),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_pool_pick_rule',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('limit_new', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('limit_on_number', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('limit_pre_owner', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('new_pick_interval', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('pick_interval_days', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('pick_number', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('pool_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_pool_pick_rule_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_pool_recycle_rule',
        columns: [
          col('condition', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('operator', 'character varying(10)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 10 } },
          }),
          col('pool_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_pool_recycle_rule_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'customer_relation',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('source_customer_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('target_customer_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'customer_relation_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'dashboard',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('dashboard_module_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('description', 'character varying(1000)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 1000 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('resource_url', 'character varying(500)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 500 } },
          }),
          col('scope_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'dashboard_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'dashboard_collection',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('dashboard_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('user_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'dashboard_collection_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'dashboard_module',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('parent_id', 'character varying(32)', {
            notNull: true,
            default: lit('NONE'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', {
            notNull: true,
            default: lit('0'),
            codecRef: { codecId: 'pg/int8@1' },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'dashboard_module_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'departments',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('leaderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('parentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sort', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'departments_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_ai_model_routes',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('modelId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sort', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_ai_model_routes_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_ai_models',
        columns: [
          col('apiKeyAuthTag', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('apiKeyCiphertext', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('apiKeyIv', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('apiKeyKeyVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('apiUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('displayName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('globalDailyLimit', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('maxTokens', 'int4', {
            notNull: true,
            default: lit(2048),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('modelName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('temperature', 'float8', {
            notNull: true,
            default: lit(0.7),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('topP', 'float8', {
            notNull: true,
            default: lit(0.9),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('updatedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userDailyLimit', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_ai_models_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_global_task_executions',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('finishedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('input', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('output', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('startedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('taskId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_global_task_executions_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_global_tasks',
        columns: [
          col('applicableModelId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('confirmationLevel', 'text', {
            notNull: true,
            default: lit('ask'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('executionAction', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('executionCondition', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('triggerType', 'text', {
            notNull: true,
            default: lit('manual'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('updatedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_global_tasks_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_integrations',
        columns: [
          col('agentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('clientId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('corpId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('credentialVersion', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSyncMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastSyncStatus', '"OrganizationSyncStatus"', {
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'OrganizationSyncStatus' } },
          }),
          col('lastSyncedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('lastTestMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastTestSucceeded', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
          col('lastTestedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('provider', '"EnterpriseIntegrationProvider"', {
            notNull: true,
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'EnterpriseIntegrationProvider' },
            },
          }),
          col('redirectUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('secretAuthTag', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('secretCiphertext', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('secretIv', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('secretKeyVersion', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('syncDefaultRoleId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('syncEnabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('updatedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_integrations_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_mail_settings',
        columns: [
          col('account', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('fromAddress', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('host', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastTestMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastTestSucceeded', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
          col('lastTestedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('passwordAuthTag', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('passwordCiphertext', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('passwordIv', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('passwordKeyVersion', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('port', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('recipient', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('ssl', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tls', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_mail_settings_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_term_categories',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sort', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_term_categories_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_term_discoveries',
        columns: [
          col('adoptedTermId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('context', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('discovered', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_term_discoveries_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_terms',
        columns: [
          col('alsoCalled', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('avoidThese', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('categoryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('standardTerm', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('systemReference', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('updatedById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('useCase', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_terms_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'enterprise_ui_settings',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('customStyle', 'text', {
            notNull: true,
            default: lit('#f9fbfb'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('customTheme', 'text', {
            notNull: true,
            default: lit('#008d91'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('helpDoc', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('iconAttachmentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('loginImageAttachmentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('loginLogoAttachmentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('platformLogoAttachmentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('slogan', 'text', {
            notNull: true,
            default: lit('让客户关系更清晰，让销售协作更高效'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('style', 'text', {
            notNull: true,
            default: lit('default'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('theme', 'text', {
            notNull: true,
            default: lit('default'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('title', 'text', {
            notNull: true,
            default: lit('MicroMatrix CRM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'enterprise_ui_settings_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'export_tasks',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('completedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('fileName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('filePath', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fileSize', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('module', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('rowCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('startedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'export_tasks_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'external_department_mappings',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('departmentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenBatchId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('provider', '"EnterpriseIntegrationProvider"', {
            notNull: true,
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'EnterpriseIntegrationProvider' },
            },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'external_department_mappings_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'external_identities',
        columns: [
          col('bindingSource', 'text', {
            notNull: true,
            default: lit('LOGIN'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('boundAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('boundById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('externalSubject', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integrationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastLoginAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('mappingId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', '"EnterpriseIntegrationProvider"', {
            notNull: true,
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'EnterpriseIntegrationProvider' },
            },
          }),
          col('revokedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('revokedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"ExternalIdentityStatus"', {
            notNull: true,
            default: lit('ACTIVE'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ExternalIdentityStatus' } },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'external_identities_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'external_oauth_states',
        columns: [
          col('browserNonceHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('consumedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('expiresAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('flow', '"ExternalOAuthFlow"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ExternalOAuthFlow' } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integrationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('returnPath', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('stateHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'external_oauth_states_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'external_user_mappings',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('externalId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenBatchId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('provider', '"EnterpriseIntegrationProvider"', {
            notNull: true,
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'EnterpriseIntegrationProvider' },
            },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'external_user_mappings_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_plan_comment',
        columns: [
          col('content', 'character varying(3000)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 3000 } },
          }),
          col('create_time', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('parent_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('reply_to_user_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('update_time', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_plan_comment_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_plan_comment_mention',
        columns: [
          col('comment_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('user_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_plan_comment_mention_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_plan_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_plan_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_plan_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_plan_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_plans',
        columns: [
          col('commentCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('contactId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('content', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('converted', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('convertedRecordId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('customData', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('deptId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('dueNotifiedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('estimatedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('method', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('ownerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"FollowUpPlanStatus"', {
            notNull: true,
            default: lit('PREPARED'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'FollowUpPlanStatus' } },
          }),
          col('targetId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_plans_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_record_comment',
        columns: [
          col('content', 'character varying(3000)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 3000 } },
          }),
          col('create_time', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('parent_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('reply_to_user_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('update_time', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_record_comment_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_record_comment_mention',
        columns: [
          col('comment_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('user_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_record_comment_mention_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_record_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_record_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_record_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_record_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'follow_up_records',
        columns: [
          col('commentCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('contactId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('content', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('deptId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('followedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ownerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ownerName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'follow_up_records_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'login_logs',
        columns: [
          col('authType', 'text', {
            notNull: true,
            default: lit('PASSWORD'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalIdentityId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('externalSubject', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ip', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('message', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('success', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('tenantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userAgent', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'login_logs_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'message_deliveries',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('channel', '"MessageDeliveryChannel"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'MessageDeliveryChannel' } },
          }),
          col('content', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('event', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalSubject', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integrationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('link', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('maxAttempts', 'int4', {
            notNull: true,
            default: lit(3),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('nextAttemptAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('providerMessageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sentAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('status', '"MessageDeliveryStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'MessageDeliveryStatus' } },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'message_deliveries_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'message_task_settings',
        columns: [
          col('config', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('dingTalkEnabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('emailEnabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('event', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('larkEnabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('module', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('systemEnabled', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('weComEnabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'message_task_settings_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'module_configs',
        columns: [
          col('enabled', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sort', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'module_configs_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'notifications',
        columns: [
          col('content', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('link', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('linkLabel', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('readAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('sourceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sourceType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'notifications_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'operation_log_blobs',
        columns: [
          col('detail', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('operationLogId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['operationLogId'], { name: 'operation_log_blobs_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'operation_log_settings',
        columns: [
          col('lastCleanupAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('lastCleanupDeleted', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('lastCleanupSource', '"OperationLogCleanupSource"', {
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'OperationLogCleanupSource' },
            },
          }),
          col('retentionDays', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['tenantId'], { name: 'operation_log_settings_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'operation_logs',
        columns: [
          col('action', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ip', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('module', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('targetName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'operation_logs_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'opportunity',
        columns: [
          col('actual_end_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('amount', 'numeric(20,10)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 20, scale: 10 } },
          }),
          col('contact_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('customer_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('expected_end_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('failure_reason', 'character varying(50)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('follow_time', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('follower', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('last_stage', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('possible', 'numeric(20,10)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 20, scale: 10 } },
          }),
          col('products', 'character varying(1000)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 1000 } },
          }),
          col('stage', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'opportunity_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'opportunity_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'opportunity_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'opportunity_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'opportunity_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'opportunity_quotation',
        columns: [
          col('amount', 'numeric(14,2)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 14, scale: 2 } },
          }),
          col('approval_status', 'character varying(50)', {
            notNull: true,
            default: lit('NONE'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('approved', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('invalid', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('opportunity_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('until_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'opportunity_quotation_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'opportunity_quotation_field',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'opportunity_quotation_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'opportunity_quotation_field_blob',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'opportunity_quotation_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'opportunity_quotation_snapshot',
        columns: [
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('quotation_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('quotation_prop', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('quotation_value', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'opportunity_quotation_snapshot_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'opportunity_rule',
        columns: [
          col('auto', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('condition', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('operator', 'character varying(10)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 10 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scope_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'opportunity_rule_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'opportunity_stage_config',
        columns: [
          col('afoot_roll_back', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('end_roll_back', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(16)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 16 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('rate', 'character varying(10)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 10 } },
          }),
          col('type', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'opportunity_stage_config_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'organization_sync_batches',
        columns: [
          col('appliedById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('applyStartedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('counts', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('credentialVersion', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fetchStartedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('finishedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('integrationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('previewedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('provider', '"EnterpriseIntegrationProvider"', {
            notNull: true,
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'EnterpriseIntegrationProvider' },
            },
          }),
          col('status', '"OrganizationSyncStatus"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'OrganizationSyncStatus' } },
          }),
          col('targetDepartmentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'organization_sync_batches_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'organization_sync_items',
        columns: [
          col('action', '"OrganizationSyncAction"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'OrganizationSyncAction' } },
          }),
          col('batchId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('changes', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('conflictMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('conflictType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('externalId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('localId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('parentExternalKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resolution', '"OrganizationSyncResolution"', {
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'OrganizationSyncResolution' },
            },
          }),
          col('resolvedLocalId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resourceType', '"OrganizationSyncResourceType"', {
            notNull: true,
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'OrganizationSyncResourceType' },
            },
          }),
          col('result', '"OrganizationSyncItemResult"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'OrganizationSyncItemResult' },
            },
          }),
          col('sort', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('sourceData', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'organization_sync_items_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'plans',
        columns: [
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('features', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('maxUsers', 'int4', {
            notNull: true,
            default: lit(10),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('price', 'numeric(10,2)', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 10, scale: 2 } },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'plans_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'product',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('price', 'numeric(14,4)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 14, scale: 4 } },
          }),
          col('status', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'product_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'product_field',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'product_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'product_field_blob',
        columns: [
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'product_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'product_price',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('status', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'product_price_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'product_price_field',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'product_price_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'product_price_field_blob',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'product_price_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'roles',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('dataScope', '"DataScope"', {
            notNull: true,
            default: lit('SELF'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'DataScope' } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isSystem', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('permissions', 'text[]', { codecRef: { codecId: 'pg/text@1', many: true } }),
          col('remark', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scopeDeptIds', 'text[]', { codecRef: { codecId: 'pg/text@1', many: true } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'roles_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sales_order',
        columns: [
          col('amount', 'numeric(20,10)', {
            codecRef: { codecId: 'pg/numeric@1', typeParams: { precision: 20, scale: 10 } },
          }),
          col('approval_status', 'character varying(50)', {
            notNull: true,
            default: lit('NONE'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('approved', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('contract_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('customer_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('number', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('owner', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { codecRef: { codecId: 'pg/int8@1' } }),
          col('stage', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'sales_order_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sales_order_field',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'sales_order_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sales_order_field_blob',
        columns: [
          col('biz_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('field_value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('ref_sub_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('resource_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('row_id', 'character varying(32)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'sales_order_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sales_order_snapshot',
        columns: [
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('order_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('order_prop', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('order_value', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'sales_order_snapshot_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sales_order_stage_config',
        columns: [
          col('afoot_roll_back', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('circulation_type', 'character varying(50)', {
            notNull: true,
            default: lit('NORMAL'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('end_roll_back', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('type', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'sales_order_stage_config_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'stage_advanced_config',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('field_config', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('module_type', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('origin_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('target_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'stage_advanced_config_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'subscriptions',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('currentPeriodEnd', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('currentPeriodStart', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('planId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"SubscriptionStatus"', {
            notNull: true,
            default: lit('TRIALING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'SubscriptionStatus' } },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'subscriptions_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sys_dict',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('module', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('type', 'character varying(10)', {
            notNull: true,
            default: lit('TEXT'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 10 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'sys_dict_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sys_dict_config',
        columns: [
          col('enabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('module', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['module', 'organization_id'], { name: 'sys_dict_config_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sys_module_field',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('form_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('internal_key', 'character varying(255)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('mobile', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('pos', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('type', 'character varying(20)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'sys_module_field_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sys_module_field_blob',
        columns: [
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('prop', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'sys_module_field_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sys_module_form',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('form_key', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'sys_module_form_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sys_module_form_blob',
        columns: [
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('prop', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'sys_module_form_blob_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sys_user_view',
        columns: [
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('fixed', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('organization_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('pos', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('resource_type', 'character varying(50)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
          }),
          col('search_mode', 'character varying(10)', {
            notNull: true,
            default: lit('AND'),
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 10 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('user_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'sys_user_view_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'sys_user_view_condition',
        columns: [
          col('children_value', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('create_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('create_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('multiple_value', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'character varying(255)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 255 } },
          }),
          col('operator', 'character varying(20)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('sys_user_view_id', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('type', 'character varying(20)', {
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 20 } },
          }),
          col('update_time', 'int8', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
          col('update_user', 'character varying(32)', {
            notNull: true,
            codecRef: { codecId: 'sql/varchar@1', typeParams: { length: 32 } },
          }),
          col('value', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('value_type', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'sys_user_view_condition_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'tenants',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('enterpriseSyncResource', '"EnterpriseIntegrationProvider"', {
            notNull: true,
            default: lit('WECOM'),
            codecRef: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'EnterpriseIntegrationProvider' },
            },
          }),
          col('enterpriseSynced', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('slug', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"TenantStatus"', {
            notNull: true,
            default: lit('ACTIVE'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'TenantStatus' } },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'tenants_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'top_navigation_configs',
        columns: [
          col('enabled', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sort', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'top_navigation_configs_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'user_extensions',
        columns: [
          col('avatar', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('platformInfo', 'bytea', { codecRef: { codecId: 'pg/bytea@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'user_extensions_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'user_key',
        columns: [
          col('access_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('create_time', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('create_user', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('enable', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('expire_time', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('forever', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('secret_key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'user_key_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'user_roles',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('roleId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'user_roles_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'users',
        columns: [
          col('auth_version', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
          col('default_pwd', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('deptId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('email', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('gender', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('language', 'text', {
            notNull: true,
            default: lit('zh-CN'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('leaderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('passwordHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('passwordLoginEnabled', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('phone', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('position', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', '"UserStatus"', {
            notNull: true,
            default: lit('ACTIVE'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'UserStatus' } },
          }),
          col('tenantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-temporal@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'users_pkey' })],
      }),
      this.createIndex({
        schema: 'public',
        table: 'announcements',
        index: 'announcements_tenantId_createdAt_idx',
        columns: ['tenantId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'announcements',
        index: 'announcements_tenantId_notice_startAt_endAt_idx',
        columns: ['tenantId', 'notice', 'startAt', 'endAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_add_sign_tasks',
        index: 'approval_add_sign_tasks_root_task_id_sort_idx',
        columns: ['root_task_id', 'sort'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_add_sign_tasks',
        index: 'approval_add_sign_tasks_sign_task_id_idx',
        columns: ['sign_task_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_add_sign_tasks',
        index: 'approval_add_sign_tasks_task_id_key',
        columns: ['task_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_add_sign_tasks',
        index: 'approval_add_sign_tasks_tenantId_instanceId_idx',
        columns: ['tenantId', 'instanceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_flow_number_counters',
        index: 'approval_flow_number_counters_tenantId_formType_key',
        columns: ['tenantId', 'formType'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_flow_versions',
        index: 'approval_flow_versions_flowId_version_key',
        columns: ['flowId', 'version'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_flow_versions',
        index: 'approval_flow_versions_tenantId_flowId_idx',
        columns: ['tenantId', 'flowId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_flows',
        index: 'approval_flows_active_form_type_key',
        columns: ['tenantId', 'formType'],
        extras: { where: '("deletedAt" IS NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_flows',
        index: 'approval_flows_tenantId_enabled_deletedAt_idx',
        columns: ['tenantId', 'enabled', 'deletedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_flows',
        index: 'approval_flows_tenantId_formType_deletedAt_idx',
        columns: ['tenantId', 'formType', 'deletedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_flows',
        index: 'approval_flows_tenantId_number_key',
        columns: ['tenantId', 'number'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_instance_attachments',
        index: 'approval_instance_attachments_attachment_id_idx',
        columns: ['attachment_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_instance_attachments',
        index: 'approval_instance_attachments_element_id_idx',
        columns: ['element_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_instance_attachments',
        index: 'approval_instance_attachments_instance_id_element_id_attach_key',
        columns: ['instance_id', 'element_id', 'attachment_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_instance_attachments',
        index: 'approval_instance_attachments_tenantId_instance_id_created__idx',
        columns: ['tenantId', 'instance_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_instances',
        index: 'approval_instances_flowId_status_idx',
        columns: ['flowId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_instances',
        index: 'approval_instances_flowVersionId_idx',
        columns: ['flowVersionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_instances',
        index: 'approval_instances_tenantId_module_targetId_idx',
        columns: ['tenantId', 'module', 'targetId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_instances',
        index: 'approval_instances_tenantId_status_idx',
        columns: ['tenantId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_instances',
        index: 'approval_instances_tenantId_submitterId_idx',
        columns: ['tenantId', 'submitterId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_node_approvers',
        index: 'approval_node_approvers_nodeId_key',
        columns: ['nodeId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_node_conditions',
        index: 'approval_node_conditions_flowVersionId_idx',
        columns: ['flowVersionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_node_links',
        index: 'approval_node_links_flowVersionId_fromNodeId_toNodeId_key',
        columns: ['flowVersionId', 'fromNodeId', 'toNodeId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_node_links',
        index: 'approval_node_links_flowVersionId_sort_idx',
        columns: ['flowVersionId', 'sort'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_node_links',
        index: 'approval_node_links_fromNodeId_idx',
        columns: ['fromNodeId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_node_links',
        index: 'approval_node_links_toNodeId_idx',
        columns: ['toNodeId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_nodes',
        index: 'approval_nodes_flowVersionId_executeTiming_sort_idx',
        columns: ['flowVersionId', 'executeTiming', 'sort'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_nodes',
        index: 'approval_nodes_flowVersionId_number_key',
        columns: ['flowVersionId', 'number'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_records',
        index: 'approval_records_taskId_idx',
        columns: ['taskId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_records',
        index: 'approval_records_tenantId_instanceId_created_at_idx',
        columns: ['tenantId', 'instanceId', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_resource_snapshots',
        index: 'approval_resource_snapshots_tenantId_formType_idx',
        columns: ['tenantId', 'formType'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_resource_snapshots',
        index: 'approval_resource_snapshots_tenantId_formType_resourceId_key',
        columns: ['tenantId', 'formType', 'resourceId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_return_back_records',
        index: 'approval_return_back_records_instance_id_return_to_node_id_key',
        columns: ['instance_id', 'return_to_node_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_return_back_records',
        index: 'approval_return_back_records_task_id_idx',
        columns: ['task_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_return_back_records',
        index: 'approval_return_back_records_tenantId_instance_id_created_a_idx',
        columns: ['tenantId', 'instance_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_tasks',
        index: 'approval_tasks_instanceId_idx',
        columns: ['instanceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_tasks',
        index: 'approval_tasks_instanceId_nodeIndex_node_round_idx',
        columns: ['instanceId', 'nodeIndex', 'node_round'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_tasks',
        index: 'approval_tasks_tenantId_approverId_status_idx',
        columns: ['tenantId', 'approverId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_tasks',
        index: 'approval_tasks_tenantId_approverId_task_type_status_idx',
        columns: ['tenantId', 'approverId', 'task_type', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_webhook_deliveries',
        index: 'approval_webhook_deliveries_tenant_id_flow_id_created_at_idx',
        columns: ['tenant_id', 'flow_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_webhook_deliveries',
        index: 'approval_webhook_deliveries_tenant_id_instance_id_created_a_idx',
        columns: ['tenant_id', 'instance_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'approval_webhook_deliveries',
        index: 'approval_webhook_deliveries_tenant_id_status_created_at_idx',
        columns: ['tenant_id', 'status', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'attachments',
        index: 'attachments_tenantId_targetType_targetId_idx',
        columns: ['tenantId', 'targetType', 'targetId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'bidding_infos',
        index: 'bidding_infos_tenantId_hash_key',
        columns: ['tenantId', 'hash'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'bidding_infos',
        index: 'bidding_infos_tenantId_publishedAt_idx',
        columns: ['tenantId', 'publishedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'bidding_keyword_subs',
        index: 'bidding_keyword_subs_tenantId_keyword_key',
        columns: ['tenantId', 'keyword'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'bidding_sources',
        index: 'bidding_sources_tenantId_provider_key',
        columns: ['tenantId', 'provider'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'business_title',
        index: 'business_title_company_number_key',
        columns: ['company_number'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'business_title',
        index: 'business_title_name_idx',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'business_title',
        index: 'business_title_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'business_title_config',
        index: 'business_title_config_organization_id_field_key',
        columns: ['organization_id', 'field'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'business_title_config',
        index: 'business_title_config_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue',
        index: 'clue_follow_time_idx',
        columns: ['follow_time'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue',
        index: 'clue_follower_idx',
        columns: ['follower'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue',
        index: 'clue_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue',
        index: 'clue_phone_idx',
        columns: ['phone'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue',
        index: 'clue_pool_id_idx',
        columns: ['pool_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue',
        index: 'clue_reason_id_idx',
        columns: ['reason_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue_capacity',
        index: 'clue_capacity_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue_field',
        index: 'clue_field_resource_id_field_id_field_value_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue_field',
        index: 'clue_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue_field_blob',
        index: 'clue_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue_field_blob',
        index: 'clue_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue_owner',
        index: 'clue_owner_clue_id_idx',
        columns: ['clue_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue_pool',
        index: 'clue_pool_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue_pool_pick_rule',
        index: 'clue_pool_pick_rule_pool_id_key',
        columns: ['pool_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'clue_pool_recycle_rule',
        index: 'clue_pool_recycle_rule_pool_id_key',
        columns: ['pool_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract',
        index: 'contract_approval_status_idx',
        columns: ['approval_status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract',
        index: 'contract_create_user_idx',
        columns: ['create_user'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract',
        index: 'contract_customer_id_idx',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract',
        index: 'contract_name_idx',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract',
        index: 'contract_number_idx',
        columns: ['number'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract',
        index: 'contract_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract',
        index: 'contract_owner_idx',
        columns: ['owner'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract',
        index: 'contract_stage_idx',
        columns: ['stage'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_field',
        index: 'contract_field_ref_sub_id_idx',
        columns: ['ref_sub_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_field',
        index: 'contract_field_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_field',
        index: 'uk_contract_field_cell',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_field_blob',
        index: 'contract_field_blob_ref_sub_id_idx',
        columns: ['ref_sub_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_field_blob',
        index: 'contract_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_field_blob',
        index: 'uk_contract_field_blob_cell',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice',
        index: 'contract_invoice_approval_status_idx',
        columns: ['approval_status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice',
        index: 'contract_invoice_contract_id_idx',
        columns: ['contract_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice',
        index: 'contract_invoice_create_user_idx',
        columns: ['create_user'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice',
        index: 'contract_invoice_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice',
        index: 'contract_invoice_owner_idx',
        columns: ['owner'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice_field',
        index: 'contract_invoice_field_resource_id_field_id_field_value_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice_field',
        index: 'contract_invoice_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice_field_blob',
        index: 'contract_invoice_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice_field_blob',
        index: 'contract_invoice_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_invoice_snapshot',
        index: 'contract_invoice_snapshot_invoice_id_idx',
        columns: ['invoice_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_plan',
        index: 'contract_payment_plan_contract_id_idx',
        columns: ['contract_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_plan',
        index: 'contract_payment_plan_create_user_idx',
        columns: ['create_user'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_plan',
        index: 'contract_payment_plan_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_plan',
        index: 'contract_payment_plan_owner_idx',
        columns: ['owner'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_plan',
        index: 'contract_payment_plan_plan_end_time_idx',
        columns: ['plan_end_time'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_plan_field',
        index: 'contract_payment_plan_field_resource_id_field_id_field_valu_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_plan_field',
        index: 'contract_payment_plan_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_plan_field_blob',
        index: 'contract_payment_plan_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_plan_field_blob',
        index: 'contract_payment_plan_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_record',
        index: 'contract_payment_record_contract_id_idx',
        columns: ['contract_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_record',
        index: 'contract_payment_record_create_user_idx',
        columns: ['create_user'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_record',
        index: 'contract_payment_record_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_record',
        index: 'contract_payment_record_owner_idx',
        columns: ['owner'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_record',
        index: 'contract_payment_record_payment_plan_id_idx',
        columns: ['payment_plan_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_record_field',
        index: 'contract_payment_record_field_resource_id_field_id_field_va_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_record_field',
        index: 'contract_payment_record_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_record_field_blob',
        index: 'contract_payment_record_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_payment_record_field_blob',
        index: 'contract_payment_record_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_snapshot',
        index: 'contract_snapshot_contract_id_idx',
        columns: ['contract_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contract_stage_config',
        index: 'contract_stage_config_organization_id_pos_idx',
        columns: ['organization_id', 'pos'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form',
        index: 'custom_form_organization_id_enable_idx',
        columns: ['organization_id', 'enable'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form',
        index: 'custom_form_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form',
        index: 'custom_form_organization_id_name_key',
        columns: ['organization_id', 'name'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_admin',
        index: 'custom_form_admin_custom_form_id_user_id_key',
        columns: ['custom_form_id', 'user_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_admin',
        index: 'custom_form_admin_user_id_idx',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data',
        index: 'custom_form_data_custom_form_id_create_time_idx',
        columns: ['custom_form_id', 'create_time'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data',
        index: 'custom_form_data_custom_form_id_idx',
        columns: ['custom_form_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data',
        index: 'custom_form_data_custom_form_id_owner_idx',
        columns: ['custom_form_id', 'owner'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data',
        index: 'custom_form_data_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field',
        index: 'custom_form_data_field_biz_id_idx',
        columns: ['biz_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field',
        index: 'custom_form_data_field_resource_id_field_id_field_value_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field',
        index: 'custom_form_data_field_resource_id_ref_sub_id_row_id_idx',
        columns: ['resource_id', 'ref_sub_id', 'row_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field',
        index: 'custom_form_data_field_sub_cell_key',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { where: '(ref_sub_id IS NOT NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field',
        index: 'custom_form_data_field_top_level_key',
        columns: ['resource_id', 'field_id'],
        extras: { where: '(ref_sub_id IS NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field_blob',
        index: 'custom_form_data_field_blob_biz_id_idx',
        columns: ['biz_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field_blob',
        index: 'custom_form_data_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field_blob',
        index: 'custom_form_data_field_blob_resource_id_ref_sub_id_row_id_idx',
        columns: ['resource_id', 'ref_sub_id', 'row_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field_blob',
        index: 'custom_form_data_field_blob_sub_cell_key',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { where: '(ref_sub_id IS NOT NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_data_field_blob',
        index: 'custom_form_data_field_blob_top_level_key',
        columns: ['resource_id', 'field_id'],
        extras: { where: '(ref_sub_id IS NULL)', unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_role',
        index: 'custom_form_role_custom_form_id_idx',
        columns: ['custom_form_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_role',
        index: 'custom_form_role_custom_form_id_internal_key_key',
        columns: ['custom_form_id', 'internal_key'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_role_user',
        index: 'custom_form_role_user_create_time_idx',
        columns: ['create_time'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_role_user',
        index: 'custom_form_role_user_role_id_user_id_key',
        columns: ['role_id', 'user_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'custom_form_role_user',
        index: 'custom_form_role_user_user_id_idx',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer',
        index: 'customer_follow_time_idx',
        columns: ['follow_time'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer',
        index: 'customer_follower_idx',
        columns: ['follower'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer',
        index: 'customer_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer',
        index: 'customer_pool_id_idx',
        columns: ['pool_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer',
        index: 'customer_reason_id_idx',
        columns: ['reason_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_capacity',
        index: 'customer_capacity_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_collaboration',
        index: 'customer_collaboration_customer_id_idx',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_collaboration',
        index: 'customer_collaboration_customer_id_user_id_key',
        columns: ['customer_id', 'user_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_collaboration',
        index: 'customer_collaboration_user_id_idx',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_contact',
        index: 'customer_contact_customer_id_idx',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_contact',
        index: 'customer_contact_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_contact',
        index: 'customer_contact_phone_idx',
        columns: ['phone'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_contact_field',
        index: 'customer_contact_field_resource_id_field_id_field_value_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_contact_field',
        index: 'customer_contact_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_contact_field_blob',
        index: 'customer_contact_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_contact_field_blob',
        index: 'customer_contact_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_field',
        index: 'customer_field_resource_id_field_id_field_value_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_field',
        index: 'customer_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_field_blob',
        index: 'customer_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_field_blob',
        index: 'customer_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_owner',
        index: 'customer_owner_customer_id_idx',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_pool',
        index: 'customer_pool_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_pool_pick_rule',
        index: 'customer_pool_pick_rule_pool_id_key',
        columns: ['pool_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_pool_recycle_rule',
        index: 'customer_pool_recycle_rule_pool_id_key',
        columns: ['pool_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_relation',
        index: 'customer_relation_source_customer_id_idx',
        columns: ['source_customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_relation',
        index: 'customer_relation_source_customer_id_target_customer_id_key',
        columns: ['source_customer_id', 'target_customer_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'customer_relation',
        index: 'customer_relation_target_customer_id_idx',
        columns: ['target_customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dashboard',
        index: 'dashboard_dashboard_module_id_idx',
        columns: ['dashboard_module_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dashboard',
        index: 'dashboard_name_idx',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dashboard',
        index: 'dashboard_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dashboard_collection',
        index: 'dashboard_collection_user_id_dashboard_id_key',
        columns: ['user_id', 'dashboard_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'dashboard_collection',
        index: 'dashboard_collection_user_id_idx',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dashboard_module',
        index: 'dashboard_module_name_idx',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dashboard_module',
        index: 'dashboard_module_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dashboard_module',
        index: 'dashboard_module_parent_id_idx',
        columns: ['parent_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dashboard_module',
        index: 'dashboard_module_pos_idx',
        columns: ['pos'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'departments',
        index: 'departments_tenantId_idx',
        columns: ['tenantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'departments',
        index: 'departments_tenantId_parentId_idx',
        columns: ['tenantId', 'parentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_ai_model_routes',
        index: 'enterprise_ai_model_routes_tenantId_idx',
        columns: ['tenantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_ai_model_routes',
        index: 'enterprise_ai_model_routes_tenantId_modelId_key',
        columns: ['tenantId', 'modelId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_ai_model_routes',
        index: 'enterprise_ai_model_routes_tenantId_sort_key',
        columns: ['tenantId', 'sort'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_ai_models',
        index: 'enterprise_ai_models_tenantId_displayName_key',
        columns: ['tenantId', 'displayName'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_ai_models',
        index: 'enterprise_ai_models_tenantId_enable_idx',
        columns: ['tenantId', 'enable'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_global_task_executions',
        index: 'enterprise_global_task_executions_taskId_createdAt_idx',
        columns: ['taskId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_global_task_executions',
        index: 'enterprise_global_task_executions_tenantId_createdAt_idx',
        columns: ['tenantId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_global_tasks',
        index: 'enterprise_global_tasks_applicableModelId_idx',
        columns: ['applicableModelId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_global_tasks',
        index: 'enterprise_global_tasks_tenantId_enable_idx',
        columns: ['tenantId', 'enable'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_global_tasks',
        index: 'enterprise_global_tasks_tenantId_name_key',
        columns: ['tenantId', 'name'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_integrations',
        index: 'enterprise_integrations_syncDefaultRoleId_idx',
        columns: ['syncDefaultRoleId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_integrations',
        index: 'enterprise_integrations_tenantId_idx',
        columns: ['tenantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_integrations',
        index: 'enterprise_integrations_tenantId_provider_key',
        columns: ['tenantId', 'provider'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_mail_settings',
        index: 'enterprise_mail_settings_tenantId_key',
        columns: ['tenantId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_term_categories',
        index: 'enterprise_term_categories_tenantId_name_key',
        columns: ['tenantId', 'name'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_term_categories',
        index: 'enterprise_term_categories_tenantId_sort_idx',
        columns: ['tenantId', 'sort'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_term_discoveries',
        index: 'enterprise_term_discoveries_tenantId_status_idx',
        columns: ['tenantId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_terms',
        index: 'enterprise_terms_categoryId_idx',
        columns: ['categoryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_terms',
        index: 'enterprise_terms_tenantId_categoryId_standardTerm_key',
        columns: ['tenantId', 'categoryId', 'standardTerm'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_terms',
        index: 'enterprise_terms_tenantId_enable_idx',
        columns: ['tenantId', 'enable'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'enterprise_ui_settings',
        index: 'enterprise_ui_settings_tenantId_key',
        columns: ['tenantId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'export_tasks',
        index: 'export_tasks_expiresAt_idx',
        columns: ['expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'export_tasks',
        index: 'export_tasks_tenantId_userId_createdAt_idx',
        columns: ['tenantId', 'userId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_department_mappings',
        index: 'external_department_mappings_lastSeenBatchId_idx',
        columns: ['lastSeenBatchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_department_mappings',
        index: 'external_department_mappings_tenantId_provider_active_idx',
        columns: ['tenantId', 'provider', 'active'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_department_mappings',
        index: 'external_department_mappings_tenantId_provider_departmentId_key',
        columns: ['tenantId', 'provider', 'departmentId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_department_mappings',
        index: 'external_department_mappings_tenantId_provider_externalKey_key',
        columns: ['tenantId', 'provider', 'externalKey'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_identities',
        index: 'external_identities_integrationId_idx',
        columns: ['integrationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_identities',
        index: 'external_identities_mappingId_key',
        columns: ['mappingId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_identities',
        index: 'external_identities_tenantId_provider_externalSubject_key',
        columns: ['tenantId', 'provider', 'externalSubject'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_identities',
        index: 'external_identities_tenantId_provider_status_idx',
        columns: ['tenantId', 'provider', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_identities',
        index: 'external_identities_tenantId_provider_userId_key',
        columns: ['tenantId', 'provider', 'userId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_oauth_states',
        index: 'external_oauth_states_expiresAt_consumedAt_idx',
        columns: ['expiresAt', 'consumedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_oauth_states',
        index: 'external_oauth_states_stateHash_key',
        columns: ['stateHash'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_oauth_states',
        index: 'external_oauth_states_tenantId_flow_expiresAt_idx',
        columns: ['tenantId', 'flow', 'expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_user_mappings',
        index: 'external_user_mappings_lastSeenBatchId_idx',
        columns: ['lastSeenBatchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_user_mappings',
        index: 'external_user_mappings_tenantId_provider_active_idx',
        columns: ['tenantId', 'provider', 'active'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_user_mappings',
        index: 'external_user_mappings_tenantId_provider_externalKey_key',
        columns: ['tenantId', 'provider', 'externalKey'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'external_user_mappings',
        index: 'external_user_mappings_tenantId_provider_userId_key',
        columns: ['tenantId', 'provider', 'userId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plan_comment',
        index: 'follow_plan_comment_page_idx',
        columns: ['organization_id', 'resource_id', 'parent_id', 'create_time'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plan_comment',
        index: 'follow_up_plan_comment_parent_id_idx',
        columns: ['parent_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plan_comment_mention',
        index: 'follow_up_plan_comment_mention_comment_id_idx',
        columns: ['comment_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plan_comment_mention',
        index: 'follow_up_plan_comment_mention_comment_id_user_id_key',
        columns: ['comment_id', 'user_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plan_comment_mention',
        index: 'follow_up_plan_comment_mention_user_id_idx',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plan_field',
        index: 'follow_up_plan_field_resource_id_field_id_field_value_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plan_field',
        index: 'follow_up_plan_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plan_field_blob',
        index: 'follow_up_plan_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plan_field_blob',
        index: 'follow_up_plan_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plans',
        index: 'follow_up_plans_tenantId_estimatedAt_status_idx',
        columns: ['tenantId', 'estimatedAt', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plans',
        index: 'follow_up_plans_tenantId_ownerId_status_idx',
        columns: ['tenantId', 'ownerId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_plans',
        index: 'follow_up_plans_tenantId_targetType_targetId_idx',
        columns: ['tenantId', 'targetType', 'targetId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_record_comment',
        index: 'follow_record_comment_page_idx',
        columns: ['organization_id', 'resource_id', 'parent_id', 'create_time'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_record_comment',
        index: 'follow_up_record_comment_parent_id_idx',
        columns: ['parent_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_record_comment_mention',
        index: 'follow_up_record_comment_mention_comment_id_idx',
        columns: ['comment_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_record_comment_mention',
        index: 'follow_up_record_comment_mention_comment_id_user_id_key',
        columns: ['comment_id', 'user_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_record_comment_mention',
        index: 'follow_up_record_comment_mention_user_id_idx',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_record_field',
        index: 'follow_up_record_field_resource_id_field_id_field_value_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_record_field',
        index: 'follow_up_record_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_record_field_blob',
        index: 'follow_up_record_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_record_field_blob',
        index: 'follow_up_record_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_records',
        index: 'follow_up_records_tenantId_ownerId_followedAt_idx',
        columns: ['tenantId', 'ownerId', 'followedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'follow_up_records',
        index: 'follow_up_records_tenantId_targetType_targetId_idx',
        columns: ['tenantId', 'targetType', 'targetId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'login_logs',
        index: 'login_logs_tenantId_authType_createdAt_idx',
        columns: ['tenantId', 'authType', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'login_logs',
        index: 'login_logs_tenantId_createdAt_idx',
        columns: ['tenantId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message_deliveries',
        index: 'message_deliveries_tenantId_event_createdAt_idx',
        columns: ['tenantId', 'event', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message_deliveries',
        index: 'message_deliveries_tenantId_status_nextAttemptAt_idx',
        columns: ['tenantId', 'status', 'nextAttemptAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message_deliveries',
        index: 'message_deliveries_tenantId_userId_createdAt_idx',
        columns: ['tenantId', 'userId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'message_task_settings',
        index: 'message_task_settings_tenantId_module_event_key',
        columns: ['tenantId', 'module', 'event'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'message_task_settings',
        index: 'message_task_settings_tenantId_module_idx',
        columns: ['tenantId', 'module'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'module_configs',
        index: 'module_configs_tenantId_key_key',
        columns: ['tenantId', 'key'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'module_configs',
        index: 'module_configs_tenantId_sort_idx',
        columns: ['tenantId', 'sort'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notifications',
        index: 'notifications_tenantId_sourceType_sourceId_idx',
        columns: ['tenantId', 'sourceType', 'sourceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notifications',
        index: 'notifications_tenantId_userId_readAt_idx',
        columns: ['tenantId', 'userId', 'readAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'notifications',
        index: 'notifications_tenantId_userId_sourceType_sourceId_key',
        columns: ['tenantId', 'userId', 'sourceType', 'sourceId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'operation_logs',
        index: 'operation_logs_createdAt_idx',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'operation_logs',
        index: 'operation_logs_tenantId_createdAt_idx',
        columns: ['tenantId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'operation_logs',
        index: 'operation_logs_tenantId_module_idx',
        columns: ['tenantId', 'module'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity',
        index: 'opportunity_customer_id_idx',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity',
        index: 'opportunity_follow_time_idx',
        columns: ['follow_time'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity',
        index: 'opportunity_follower_idx',
        columns: ['follower'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity',
        index: 'opportunity_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity',
        index: 'opportunity_owner_idx',
        columns: ['owner'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity',
        index: 'opportunity_stage_idx',
        columns: ['stage'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_field',
        index: 'opportunity_field_resource_id_field_id_field_value_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_field',
        index: 'opportunity_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_field_blob',
        index: 'opportunity_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_field_blob',
        index: 'opportunity_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation',
        index: 'opportunity_quotation_approval_status_idx',
        columns: ['approval_status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation',
        index: 'opportunity_quotation_create_user_idx',
        columns: ['create_user'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation',
        index: 'opportunity_quotation_opportunity_id_idx',
        columns: ['opportunity_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation',
        index: 'opportunity_quotation_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation_field',
        index: 'opportunity_quotation_field_ref_sub_id_idx',
        columns: ['ref_sub_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation_field',
        index: 'opportunity_quotation_field_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation_field',
        index: 'uk_opp_quotation_field_cell',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation_field_blob',
        index: 'opportunity_quotation_field_blob_ref_sub_id_idx',
        columns: ['ref_sub_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation_field_blob',
        index: 'opportunity_quotation_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation_field_blob',
        index: 'uk_opp_quotation_field_blob_cell',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_quotation_snapshot',
        index: 'opportunity_quotation_snapshot_quotation_id_idx',
        columns: ['quotation_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_rule',
        index: 'opportunity_rule_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_stage_config',
        index: 'opportunity_stage_config_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'opportunity_stage_config',
        index: 'opportunity_stage_config_organization_id_pos_idx',
        columns: ['organization_id', 'pos'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'organization_sync_batches',
        index: 'organization_sync_batches_active_key',
        columns: ['tenantId', 'provider'],
        extras: {
          where:
            '(status = ANY (ARRAY[\'FETCHING\'::"OrganizationSyncStatus", \'APPLYING\'::"OrganizationSyncStatus"]))',
          unique: true,
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'organization_sync_batches',
        index: 'organization_sync_batches_integrationId_status_idx',
        columns: ['integrationId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'organization_sync_batches',
        index: 'organization_sync_batches_tenantId_provider_createdAt_idx',
        columns: ['tenantId', 'provider', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'organization_sync_batches',
        index: 'organization_sync_batches_tenantId_targetDepartmentId_creat_idx',
        columns: ['tenantId', 'targetDepartmentId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'organization_sync_items',
        index: 'organization_sync_items_batchId_resourceType_externalKey_key',
        columns: ['batchId', 'resourceType', 'externalKey'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'organization_sync_items',
        index: 'organization_sync_items_tenantId_batchId_resourceType_actio_idx',
        columns: ['tenantId', 'batchId', 'resourceType', 'action'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'plans',
        index: 'plans_code_key',
        columns: ['code'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'product',
        index: 'product_name_idx',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product',
        index: 'product_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product',
        index: 'product_organization_id_pos_idx',
        columns: ['organization_id', 'pos'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_field',
        index: 'product_field_resource_id_field_id_field_value_idx',
        columns: ['resource_id', 'field_id', 'field_value'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_field',
        index: 'product_field_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_field_blob',
        index: 'product_field_blob_resource_id_field_id_key',
        columns: ['resource_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_field_blob',
        index: 'product_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_price',
        index: 'product_price_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_price',
        index: 'product_price_organization_id_pos_idx',
        columns: ['organization_id', 'pos'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_price',
        index: 'product_price_status_idx',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_price_field',
        index: 'product_price_field_ref_sub_id_idx',
        columns: ['ref_sub_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_price_field',
        index: 'product_price_field_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_price_field',
        index: 'uk_price_field_cell',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_price_field_blob',
        index: 'product_price_field_blob_ref_sub_id_idx',
        columns: ['ref_sub_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_price_field_blob',
        index: 'product_price_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'product_price_field_blob',
        index: 'uk_price_field_blob_cell',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'roles',
        index: 'roles_tenantId_idx',
        columns: ['tenantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'roles',
        index: 'roles_tenantId_name_key',
        columns: ['tenantId', 'name'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order',
        index: 'sales_order_approval_status_idx',
        columns: ['approval_status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order',
        index: 'sales_order_contract_id_idx',
        columns: ['contract_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order',
        index: 'sales_order_create_user_idx',
        columns: ['create_user'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order',
        index: 'sales_order_customer_id_idx',
        columns: ['customer_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order',
        index: 'sales_order_name_idx',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order',
        index: 'sales_order_number_idx',
        columns: ['number'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order',
        index: 'sales_order_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order',
        index: 'sales_order_owner_idx',
        columns: ['owner'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order',
        index: 'sales_order_stage_idx',
        columns: ['stage'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order_field',
        index: 'sales_order_field_ref_sub_id_idx',
        columns: ['ref_sub_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order_field',
        index: 'sales_order_field_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order_field',
        index: 'uk_order_field_cell',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order_field_blob',
        index: 'sales_order_field_blob_ref_sub_id_idx',
        columns: ['ref_sub_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order_field_blob',
        index: 'sales_order_field_blob_resource_id_idx',
        columns: ['resource_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order_field_blob',
        index: 'uk_order_field_blob_cell',
        columns: ['resource_id', 'ref_sub_id', 'row_id', 'field_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order_snapshot',
        index: 'sales_order_snapshot_order_id_idx',
        columns: ['order_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sales_order_stage_config',
        index: 'sales_order_stage_config_organization_id_pos_idx',
        columns: ['organization_id', 'pos'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stage_advanced_config',
        index: 'idx_stage_advanced_type',
        columns: ['module_type'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stage_advanced_config',
        index: 'stage_advanced_config_organization_id_module_type_idx',
        columns: ['organization_id', 'module_type'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'stage_advanced_config',
        index: 'uk_stage_advanced_transition',
        columns: ['organization_id', 'module_type', 'origin_id', 'target_id'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'subscriptions',
        index: 'subscriptions_tenantId_idx',
        columns: ['tenantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_dict',
        index: 'sys_dict_organization_id_module_pos_idx',
        columns: ['organization_id', 'module', 'pos'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_dict',
        index: 'sys_dict_organization_id_name_idx',
        columns: ['organization_id', 'name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_module_field',
        index: 'sys_module_field_form_id_internal_key_idx',
        columns: ['form_id', 'internal_key'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_module_field',
        index: 'sys_module_field_mobile_idx',
        columns: ['mobile'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_module_form',
        index: 'sys_module_form_organization_id_form_key_key',
        columns: ['organization_id', 'form_key'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_module_form',
        index: 'sys_module_form_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_user_view',
        index: 'sys_user_view_name_idx',
        columns: ['name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_user_view',
        index: 'sys_user_view_organization_id_idx',
        columns: ['organization_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_user_view',
        index: 'sys_user_view_organization_id_user_id_resource_type_name_key',
        columns: ['organization_id', 'user_id', 'resource_type', 'name'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_user_view',
        index: 'sys_user_view_resource_type_idx',
        columns: ['resource_type'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_user_view',
        index: 'sys_user_view_user_id_idx',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sys_user_view_condition',
        index: 'sys_user_view_condition_sys_user_view_id_idx',
        columns: ['sys_user_view_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'tenants',
        index: 'tenants_slug_key',
        columns: ['slug'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'top_navigation_configs',
        index: 'top_navigation_configs_tenantId_key_key',
        columns: ['tenantId', 'key'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'top_navigation_configs',
        index: 'top_navigation_configs_tenantId_sort_idx',
        columns: ['tenantId', 'sort'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_key',
        index: 'user_key_access_key_key',
        columns: ['access_key'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_key',
        index: 'user_key_create_user_idx',
        columns: ['create_user'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_roles',
        index: 'user_roles_tenantId_roleId_idx',
        columns: ['tenantId', 'roleId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_roles',
        index: 'user_roles_tenantId_userId_idx',
        columns: ['tenantId', 'userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'user_roles',
        index: 'user_roles_userId_roleId_key',
        columns: ['userId', 'roleId'],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_email_idx',
        columns: ['email'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_tenantId_deptId_idx',
        columns: ['tenantId', 'deptId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_tenantId_idx',
        columns: ['tenantId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_add_sign_tasks',
        foreignKey: {
          name: 'approval_add_sign_tasks_instanceId_fkey',
          columns: ['instanceId'],
          references: { schema: 'public', table: 'approval_instances', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_add_sign_tasks',
        foreignKey: {
          name: 'approval_add_sign_tasks_sign_task_id_fkey',
          columns: ['sign_task_id'],
          references: { schema: 'public', table: 'approval_tasks', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_add_sign_tasks',
        foreignKey: {
          name: 'approval_add_sign_tasks_task_id_fkey',
          columns: ['task_id'],
          references: { schema: 'public', table: 'approval_tasks', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_flow_versions',
        foreignKey: {
          name: 'approval_flow_versions_flowId_fkey',
          columns: ['flowId'],
          references: { schema: 'public', table: 'approval_flows', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_flows',
        foreignKey: {
          name: 'approval_flows_currentVersionId_fkey',
          columns: ['currentVersionId'],
          references: { schema: 'public', table: 'approval_flow_versions', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_instance_attachments',
        foreignKey: {
          name: 'approval_instance_attachments_attachment_id_fkey',
          columns: ['attachment_id'],
          references: { schema: 'public', table: 'attachments', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_instance_attachments',
        foreignKey: {
          name: 'approval_instance_attachments_instance_id_fkey',
          columns: ['instance_id'],
          references: { schema: 'public', table: 'approval_instances', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_instances',
        foreignKey: {
          name: 'approval_instances_flowId_fkey',
          columns: ['flowId'],
          references: { schema: 'public', table: 'approval_flows', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_instances',
        foreignKey: {
          name: 'approval_instances_flowVersionId_fkey',
          columns: ['flowVersionId'],
          references: { schema: 'public', table: 'approval_flow_versions', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_node_approvers',
        foreignKey: {
          name: 'approval_node_approvers_nodeId_fkey',
          columns: ['nodeId'],
          references: { schema: 'public', table: 'approval_nodes', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_node_conditions',
        foreignKey: {
          name: 'approval_node_conditions_flowVersionId_fkey',
          columns: ['flowVersionId'],
          references: { schema: 'public', table: 'approval_flow_versions', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_node_conditions',
        foreignKey: {
          name: 'approval_node_conditions_id_fkey',
          columns: ['id'],
          references: { schema: 'public', table: 'approval_nodes', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_node_links',
        foreignKey: {
          name: 'approval_node_links_flowVersionId_fkey',
          columns: ['flowVersionId'],
          references: { schema: 'public', table: 'approval_flow_versions', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_node_links',
        foreignKey: {
          name: 'approval_node_links_fromNodeId_fkey',
          columns: ['fromNodeId'],
          references: { schema: 'public', table: 'approval_nodes', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_node_links',
        foreignKey: {
          name: 'approval_node_links_toNodeId_fkey',
          columns: ['toNodeId'],
          references: { schema: 'public', table: 'approval_nodes', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_nodes',
        foreignKey: {
          name: 'approval_nodes_flowVersionId_fkey',
          columns: ['flowVersionId'],
          references: { schema: 'public', table: 'approval_flow_versions', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_records',
        foreignKey: {
          name: 'approval_records_instanceId_fkey',
          columns: ['instanceId'],
          references: { schema: 'public', table: 'approval_instances', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_records',
        foreignKey: {
          name: 'approval_records_taskId_fkey',
          columns: ['taskId'],
          references: { schema: 'public', table: 'approval_tasks', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_return_back_records',
        foreignKey: {
          name: 'approval_return_back_records_instance_id_fkey',
          columns: ['instance_id'],
          references: { schema: 'public', table: 'approval_instances', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_return_back_records',
        foreignKey: {
          name: 'approval_return_back_records_task_id_fkey',
          columns: ['task_id'],
          references: { schema: 'public', table: 'approval_tasks', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_tasks',
        foreignKey: {
          name: 'approval_tasks_instanceId_fkey',
          columns: ['instanceId'],
          references: { schema: 'public', table: 'approval_instances', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'approval_webhook_deliveries',
        foreignKey: {
          name: 'approval_webhook_deliveries_instance_id_fkey',
          columns: ['instance_id'],
          references: { schema: 'public', table: 'approval_instances', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'clue',
        foreignKey: {
          name: 'clue_pool_id_fkey',
          columns: ['pool_id'],
          references: { schema: 'public', table: 'clue_pool', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'clue_field',
        foreignKey: {
          name: 'clue_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'clue', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'clue_field_blob',
        foreignKey: {
          name: 'clue_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'clue', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'clue_owner',
        foreignKey: {
          name: 'clue_owner_clue_id_fkey',
          columns: ['clue_id'],
          references: { schema: 'public', table: 'clue', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'clue_pool_hidden_field',
        foreignKey: {
          name: 'clue_pool_hidden_field_pool_id_fkey',
          columns: ['pool_id'],
          references: { schema: 'public', table: 'clue_pool', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'clue_pool_pick_rule',
        foreignKey: {
          name: 'clue_pool_pick_rule_pool_id_fkey',
          columns: ['pool_id'],
          references: { schema: 'public', table: 'clue_pool', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'clue_pool_recycle_rule',
        foreignKey: {
          name: 'clue_pool_recycle_rule_pool_id_fkey',
          columns: ['pool_id'],
          references: { schema: 'public', table: 'clue_pool', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract',
        foreignKey: {
          name: 'contract_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_field',
        foreignKey: {
          name: 'contract_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'contract', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_field_blob',
        foreignKey: {
          name: 'contract_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'contract', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_invoice',
        foreignKey: {
          name: 'contract_invoice_business_title_id_fkey',
          columns: ['business_title_id'],
          references: { schema: 'public', table: 'business_title', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_invoice',
        foreignKey: {
          name: 'contract_invoice_contract_id_fkey',
          columns: ['contract_id'],
          references: { schema: 'public', table: 'contract', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_invoice_field',
        foreignKey: {
          name: 'contract_invoice_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'contract_invoice', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_invoice_field_blob',
        foreignKey: {
          name: 'contract_invoice_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'contract_invoice', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_invoice_snapshot',
        foreignKey: {
          name: 'contract_invoice_snapshot_invoice_id_fkey',
          columns: ['invoice_id'],
          references: { schema: 'public', table: 'contract_invoice', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_payment_plan',
        foreignKey: {
          name: 'contract_payment_plan_contract_id_fkey',
          columns: ['contract_id'],
          references: { schema: 'public', table: 'contract', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_payment_plan_field',
        foreignKey: {
          name: 'contract_payment_plan_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'contract_payment_plan', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_payment_plan_field_blob',
        foreignKey: {
          name: 'contract_payment_plan_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'contract_payment_plan', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_payment_record',
        foreignKey: {
          name: 'contract_payment_record_contract_id_fkey',
          columns: ['contract_id'],
          references: { schema: 'public', table: 'contract', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_payment_record',
        foreignKey: {
          name: 'contract_payment_record_payment_plan_id_fkey',
          columns: ['payment_plan_id'],
          references: { schema: 'public', table: 'contract_payment_plan', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_payment_record_field',
        foreignKey: {
          name: 'contract_payment_record_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'contract_payment_record', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_payment_record_field_blob',
        foreignKey: {
          name: 'contract_payment_record_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'contract_payment_record', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contract_snapshot',
        foreignKey: {
          name: 'contract_snapshot_contract_id_fkey',
          columns: ['contract_id'],
          references: { schema: 'public', table: 'contract', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'custom_form_admin',
        foreignKey: {
          name: 'custom_form_admin_custom_form_id_fkey',
          columns: ['custom_form_id'],
          references: { schema: 'public', table: 'custom_form', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'custom_form_data',
        foreignKey: {
          name: 'custom_form_data_custom_form_id_fkey',
          columns: ['custom_form_id'],
          references: { schema: 'public', table: 'custom_form', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'custom_form_data_field',
        foreignKey: {
          name: 'custom_form_data_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'custom_form_data', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'custom_form_data_field_blob',
        foreignKey: {
          name: 'custom_form_data_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'custom_form_data', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'custom_form_role',
        foreignKey: {
          name: 'custom_form_role_custom_form_id_fkey',
          columns: ['custom_form_id'],
          references: { schema: 'public', table: 'custom_form', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'custom_form_role_user',
        foreignKey: {
          name: 'custom_form_role_user_role_id_fkey',
          columns: ['role_id'],
          references: { schema: 'public', table: 'custom_form_role', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer',
        foreignKey: {
          name: 'customer_pool_id_fkey',
          columns: ['pool_id'],
          references: { schema: 'public', table: 'customer_pool', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_collaboration',
        foreignKey: {
          name: 'customer_collaboration_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_contact',
        foreignKey: {
          name: 'customer_contact_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_contact_field',
        foreignKey: {
          name: 'customer_contact_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'customer_contact', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_contact_field_blob',
        foreignKey: {
          name: 'customer_contact_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'customer_contact', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_field',
        foreignKey: {
          name: 'customer_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_field_blob',
        foreignKey: {
          name: 'customer_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_owner',
        foreignKey: {
          name: 'customer_owner_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_pool_hidden_field',
        foreignKey: {
          name: 'customer_pool_hidden_field_pool_id_fkey',
          columns: ['pool_id'],
          references: { schema: 'public', table: 'customer_pool', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_pool_pick_rule',
        foreignKey: {
          name: 'customer_pool_pick_rule_pool_id_fkey',
          columns: ['pool_id'],
          references: { schema: 'public', table: 'customer_pool', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_pool_recycle_rule',
        foreignKey: {
          name: 'customer_pool_recycle_rule_pool_id_fkey',
          columns: ['pool_id'],
          references: { schema: 'public', table: 'customer_pool', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_relation',
        foreignKey: {
          name: 'customer_relation_source_customer_id_fkey',
          columns: ['source_customer_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'customer_relation',
        foreignKey: {
          name: 'customer_relation_target_customer_id_fkey',
          columns: ['target_customer_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dashboard',
        foreignKey: {
          name: 'dashboard_dashboard_module_id_fkey',
          columns: ['dashboard_module_id'],
          references: { schema: 'public', table: 'dashboard_module', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dashboard_collection',
        foreignKey: {
          name: 'dashboard_collection_dashboard_id_fkey',
          columns: ['dashboard_id'],
          references: { schema: 'public', table: 'dashboard', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'departments',
        foreignKey: {
          name: 'departments_parentId_fkey',
          columns: ['parentId'],
          references: { schema: 'public', table: 'departments', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'departments',
        foreignKey: {
          name: 'departments_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_ai_model_routes',
        foreignKey: {
          name: 'enterprise_ai_model_routes_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_ai_models',
        foreignKey: {
          name: 'enterprise_ai_models_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_global_task_executions',
        foreignKey: {
          name: 'enterprise_global_task_executions_taskId_fkey',
          columns: ['taskId'],
          references: { schema: 'public', table: 'enterprise_global_tasks', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_global_task_executions',
        foreignKey: {
          name: 'enterprise_global_task_executions_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_global_tasks',
        foreignKey: {
          name: 'enterprise_global_tasks_applicableModelId_fkey',
          columns: ['applicableModelId'],
          references: { schema: 'public', table: 'enterprise_ai_models', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_global_tasks',
        foreignKey: {
          name: 'enterprise_global_tasks_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_integrations',
        foreignKey: {
          name: 'enterprise_integrations_syncDefaultRoleId_fkey',
          columns: ['syncDefaultRoleId'],
          references: { schema: 'public', table: 'roles', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_integrations',
        foreignKey: {
          name: 'enterprise_integrations_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_mail_settings',
        foreignKey: {
          name: 'enterprise_mail_settings_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_term_categories',
        foreignKey: {
          name: 'enterprise_term_categories_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_term_discoveries',
        foreignKey: {
          name: 'enterprise_term_discoveries_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_terms',
        foreignKey: {
          name: 'enterprise_terms_categoryId_fkey',
          columns: ['categoryId'],
          references: { schema: 'public', table: 'enterprise_term_categories', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_terms',
        foreignKey: {
          name: 'enterprise_terms_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'enterprise_ui_settings',
        foreignKey: {
          name: 'enterprise_ui_settings_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_department_mappings',
        foreignKey: {
          name: 'external_department_mappings_departmentId_fkey',
          columns: ['departmentId'],
          references: { schema: 'public', table: 'departments', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_department_mappings',
        foreignKey: {
          name: 'external_department_mappings_lastSeenBatchId_fkey',
          columns: ['lastSeenBatchId'],
          references: { schema: 'public', table: 'organization_sync_batches', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_department_mappings',
        foreignKey: {
          name: 'external_department_mappings_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_identities',
        foreignKey: {
          name: 'external_identities_integrationId_fkey',
          columns: ['integrationId'],
          references: { schema: 'public', table: 'enterprise_integrations', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_identities',
        foreignKey: {
          name: 'external_identities_mappingId_fkey',
          columns: ['mappingId'],
          references: { schema: 'public', table: 'external_user_mappings', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_identities',
        foreignKey: {
          name: 'external_identities_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_identities',
        foreignKey: {
          name: 'external_identities_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_oauth_states',
        foreignKey: {
          name: 'external_oauth_states_integrationId_fkey',
          columns: ['integrationId'],
          references: { schema: 'public', table: 'enterprise_integrations', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_oauth_states',
        foreignKey: {
          name: 'external_oauth_states_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_user_mappings',
        foreignKey: {
          name: 'external_user_mappings_lastSeenBatchId_fkey',
          columns: ['lastSeenBatchId'],
          references: { schema: 'public', table: 'organization_sync_batches', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_user_mappings',
        foreignKey: {
          name: 'external_user_mappings_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'external_user_mappings',
        foreignKey: {
          name: 'external_user_mappings_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_plan_comment',
        foreignKey: {
          name: 'follow_up_plan_comment_parent_id_fkey',
          columns: ['parent_id'],
          references: { schema: 'public', table: 'follow_up_plan_comment', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_plan_comment',
        foreignKey: {
          name: 'follow_up_plan_comment_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'follow_up_plans', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_plan_comment_mention',
        foreignKey: {
          name: 'follow_up_plan_comment_mention_comment_id_fkey',
          columns: ['comment_id'],
          references: { schema: 'public', table: 'follow_up_plan_comment', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_plan_field',
        foreignKey: {
          name: 'follow_up_plan_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'follow_up_plans', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_plan_field_blob',
        foreignKey: {
          name: 'follow_up_plan_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'follow_up_plans', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_record_comment',
        foreignKey: {
          name: 'follow_up_record_comment_parent_id_fkey',
          columns: ['parent_id'],
          references: { schema: 'public', table: 'follow_up_record_comment', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_record_comment',
        foreignKey: {
          name: 'follow_up_record_comment_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'follow_up_records', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_record_comment_mention',
        foreignKey: {
          name: 'follow_up_record_comment_mention_comment_id_fkey',
          columns: ['comment_id'],
          references: { schema: 'public', table: 'follow_up_record_comment', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_record_field',
        foreignKey: {
          name: 'follow_up_record_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'follow_up_records', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'follow_up_record_field_blob',
        foreignKey: {
          name: 'follow_up_record_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'follow_up_records', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message_deliveries',
        foreignKey: {
          name: 'message_deliveries_integrationId_fkey',
          columns: ['integrationId'],
          references: { schema: 'public', table: 'enterprise_integrations', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message_deliveries',
        foreignKey: {
          name: 'message_deliveries_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message_deliveries',
        foreignKey: {
          name: 'message_deliveries_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'message_task_settings',
        foreignKey: {
          name: 'message_task_settings_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'module_configs',
        foreignKey: {
          name: 'module_configs_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'operation_log_blobs',
        foreignKey: {
          name: 'operation_log_blobs_operationLogId_fkey',
          columns: ['operationLogId'],
          references: { schema: 'public', table: 'operation_logs', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'operation_log_settings',
        foreignKey: {
          name: 'operation_log_settings_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'opportunity',
        foreignKey: {
          name: 'opportunity_contact_id_fkey',
          columns: ['contact_id'],
          references: { schema: 'public', table: 'customer_contact', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'opportunity',
        foreignKey: {
          name: 'opportunity_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'opportunity',
        foreignKey: {
          name: 'opportunity_stage_fkey',
          columns: ['stage'],
          references: { schema: 'public', table: 'opportunity_stage_config', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'opportunity_field',
        foreignKey: {
          name: 'opportunity_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'opportunity', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'opportunity_field_blob',
        foreignKey: {
          name: 'opportunity_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'opportunity', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'opportunity_quotation',
        foreignKey: {
          name: 'opportunity_quotation_opportunity_id_fkey',
          columns: ['opportunity_id'],
          references: { schema: 'public', table: 'opportunity', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'opportunity_quotation_field',
        foreignKey: {
          name: 'opportunity_quotation_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'opportunity_quotation', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'opportunity_quotation_field_blob',
        foreignKey: {
          name: 'opportunity_quotation_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'opportunity_quotation', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'opportunity_quotation_snapshot',
        foreignKey: {
          name: 'opportunity_quotation_snapshot_quotation_id_fkey',
          columns: ['quotation_id'],
          references: { schema: 'public', table: 'opportunity_quotation', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'organization_sync_batches',
        foreignKey: {
          name: 'organization_sync_batches_integrationId_fkey',
          columns: ['integrationId'],
          references: { schema: 'public', table: 'enterprise_integrations', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'organization_sync_batches',
        foreignKey: {
          name: 'organization_sync_batches_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'organization_sync_items',
        foreignKey: {
          name: 'organization_sync_items_batchId_fkey',
          columns: ['batchId'],
          references: { schema: 'public', table: 'organization_sync_batches', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_field',
        foreignKey: {
          name: 'product_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'product', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_field_blob',
        foreignKey: {
          name: 'product_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'product', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_price_field',
        foreignKey: {
          name: 'product_price_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'product_price', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'product_price_field_blob',
        foreignKey: {
          name: 'product_price_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'product_price', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'roles',
        foreignKey: {
          name: 'roles_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_order',
        foreignKey: {
          name: 'sales_order_contract_id_fkey',
          columns: ['contract_id'],
          references: { schema: 'public', table: 'contract', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_order',
        foreignKey: {
          name: 'sales_order_customer_id_fkey',
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customer', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_order_field',
        foreignKey: {
          name: 'sales_order_field_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'sales_order', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_order_field_blob',
        foreignKey: {
          name: 'sales_order_field_blob_resource_id_fkey',
          columns: ['resource_id'],
          references: { schema: 'public', table: 'sales_order', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sales_order_snapshot',
        foreignKey: {
          name: 'sales_order_snapshot_order_id_fkey',
          columns: ['order_id'],
          references: { schema: 'public', table: 'sales_order', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'subscriptions',
        foreignKey: {
          name: 'subscriptions_planId_fkey',
          columns: ['planId'],
          references: { schema: 'public', table: 'plans', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'subscriptions',
        foreignKey: {
          name: 'subscriptions_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sys_module_field',
        foreignKey: {
          name: 'sys_module_field_form_id_fkey',
          columns: ['form_id'],
          references: { schema: 'public', table: 'sys_module_form', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sys_module_field_blob',
        foreignKey: {
          name: 'sys_module_field_blob_id_fkey',
          columns: ['id'],
          references: { schema: 'public', table: 'sys_module_field', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sys_module_form_blob',
        foreignKey: {
          name: 'sys_module_form_blob_id_fkey',
          columns: ['id'],
          references: { schema: 'public', table: 'sys_module_form', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sys_user_view_condition',
        foreignKey: {
          name: 'sys_user_view_condition_sys_user_view_id_fkey',
          columns: ['sys_user_view_id'],
          references: { schema: 'public', table: 'sys_user_view', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'top_navigation_configs',
        foreignKey: {
          name: 'top_navigation_configs_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user_extensions',
        foreignKey: {
          name: 'user_extensions_id_fkey',
          columns: ['id'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user_key',
        foreignKey: {
          name: 'user_key_create_user_fkey',
          columns: ['create_user'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user_roles',
        foreignKey: {
          name: 'user_roles_roleId_fkey',
          columns: ['roleId'],
          references: { schema: 'public', table: 'roles', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user_roles',
        foreignKey: {
          name: 'user_roles_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'user_roles',
        foreignKey: {
          name: 'user_roles_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'users',
        foreignKey: {
          name: 'users_deptId_fkey',
          columns: ['deptId'],
          references: { schema: 'public', table: 'departments', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'users',
        foreignKey: {
          name: 'users_tenantId_fkey',
          columns: ['tenantId'],
          references: { schema: 'public', table: 'tenants', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.setDefault({ schema: 'public', table: 'contract', column: 'amount', defaultSql: 'DEFAULT 0', operationClass: 'additive' }),
      this.setDefault({ schema: 'public', table: 'opportunity_quotation', column: 'amount', defaultSql: 'DEFAULT 0', operationClass: 'additive' }),
      this.setDefault({ schema: 'public', table: 'plans', column: 'price', defaultSql: 'DEFAULT 0', operationClass: 'additive' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
