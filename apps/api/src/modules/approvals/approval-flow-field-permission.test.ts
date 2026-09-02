import assert from 'node:assert/strict'
import test from 'node:test'
import type { FieldVO } from '@micromatrix/shared'
import { isApprovalEditableField } from './approval-field-permission.utils'
import { flowNodesEqual, normalizeFlowNodes } from './approval-flow-config.utils'
import { ApprovalResourceService } from './approval-resource.service'

function field(overrides: Partial<FieldVO>): FieldVO {
  return {
    id: 'f1',
    module: 'contract',
    key: 'cf_text',
    label: '测试字段',
    type: 'text',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: null,
    ...overrides,
  }
}

test('字段权限进入节点版本比较并按 fieldId 稳定排序', () => {
  const [node] = normalizeFlowNodes([{
    name: '字段权限审批',
    approverType: 'USER',
    approverIds: ['u1'],
    ccUserIds: [],
    mode: 'ANY',
    fieldPermissions: [
      { fieldId: ' z-field ', permissionType: 'EDIT' },
      { fieldId: 'a-field', permissionType: 'HIDDEN' },
    ],
  }])
  assert.deepEqual(node.fieldPermissions, [
    { fieldId: 'a-field', permissionType: 'HIDDEN' },
    { fieldId: 'z-field', permissionType: 'EDIT' },
  ])
  assert.equal(flowNodesEqual([node], [{ ...node, fieldPermissions: [...node.fieldPermissions!].reverse() }]), true)
  assert.equal(
    flowNodesEqual([node], [{ ...node, fieldPermissions: [{ fieldId: 'a-field', permissionType: 'VIEW' }] }]),
    false,
  )
})

test('pass/reject 后置字段配置进入版本比较并按 fieldId 稳定排序', () => {
  const [node] = normalizeFlowNodes([{
    name: '后置字段审批',
    approverType: 'USER',
    approverIds: ['u1'],
    ccUserIds: [],
    mode: 'ANY',
    passPostConfig: {
      fieldUpdateConfigs: [
        { fieldId: ' z-field ', fieldValue: '通过-z', enable: true },
        { fieldId: 'a-field', fieldValue: null, enable: false },
      ],
    },
    rejectPostConfig: {
      fieldUpdateConfigs: [
        { fieldId: 'b-field', fieldValue: '驳回-b', enable: true },
      ],
    },
  }])
  assert.deepEqual(node.passPostConfig?.fieldUpdateConfigs, [
    { fieldId: 'a-field', fieldValue: null, enable: false },
    { fieldId: 'z-field', fieldValue: '通过-z', enable: true },
  ])
  assert.equal(
    flowNodesEqual([node], [{
      ...node,
      passPostConfig: {
        fieldUpdateConfigs: [...node.passPostConfig!.fieldUpdateConfigs].reverse(),
      },
    }]),
    true,
  )
  assert.equal(
    flowNodesEqual([node], [{
      ...node,
      rejectPostConfig: {
        fieldUpdateConfigs: [{ fieldId: 'b-field', fieldValue: '另一个值', enable: true }],
      },
    }]),
    false,
  )
})

test('审批中 EDIT 仅开放安全字段类型和显式系统字段白名单', () => {
  assert.equal(isApprovalEditableField('contract', field({ system: false, type: 'text' })), true)
  assert.equal(isApprovalEditableField('contract', field({ system: false, type: 'picture' })), false)
  assert.equal(isApprovalEditableField('contract', field({ system: false, type: 'formula' })), false)
  assert.equal(isApprovalEditableField('contract', field({ system: true, key: 'name' })), true)
  assert.equal(isApprovalEditableField('contract', field({ system: true, key: 'customerId' })), false)
  assert.equal(isApprovalEditableField('invoice', field({ system: true, key: 'amount', type: 'currency' })), true)
  assert.equal(isApprovalEditableField('order', field({ system: true, key: 'amount', type: 'formula' })), false)
  assert.equal(isApprovalEditableField('contract', field({ hidden: true })), false)
})

test('审批详情按节点 HIDDEN/VIEW/EDIT 裁剪，加签强制全部 VIEW', async () => {
  const service = Object.create(ApprovalResourceService.prototype) as ApprovalResourceService
  ;(service as unknown as { moduleForms: unknown }).moduleForms = {
    listFields: async () => [
      field({ id: 'hidden-by-node', key: 'cf_hidden' }),
      field({ id: 'editable', key: 'cf_edit' }),
      field({ id: 'default-view', key: 'cf_view' }),
      field({ id: 'metadata-hidden', key: 'cf_meta_hidden', hidden: true }),
    ],
  }
  ;(service as unknown as { conditionFieldValues: unknown }).conditionFieldValues = async () => ({
    'hidden-by-node': 'secret',
    editable: 'editable-value',
    'default-view': 'view-value',
    'metadata-hidden': 'meta-secret',
  })

  const user = { id: 'u1', tenantId: 't1' } as never
  const normal = await service.approvalFields(user, 'contract', 'c1', [
    { fieldId: 'hidden-by-node', permissionType: 'HIDDEN' },
    { fieldId: 'editable', permissionType: 'EDIT' },
  ])
  assert.deepEqual(normal.map((item) => [item.fieldId, item.permissionType]), [
    ['editable', 'EDIT'],
    ['default-view', 'VIEW'],
  ])

  const sign = await service.approvalFields(user, 'contract', 'c1', [
    { fieldId: 'hidden-by-node', permissionType: 'HIDDEN' },
    { fieldId: 'editable', permissionType: 'EDIT' },
  ], true)
  assert.deepEqual(sign.map((item) => [item.fieldId, item.permissionType]), [
    ['hidden-by-node', 'VIEW'],
    ['editable', 'VIEW'],
    ['default-view', 'VIEW'],
  ])
})
