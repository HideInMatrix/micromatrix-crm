import assert from 'node:assert/strict'
import test from 'node:test'
import { flowNodesEqual, normalizeFlowNodes } from './approval-flow-config.utils'

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
