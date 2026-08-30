import assert from 'node:assert/strict'
import test from 'node:test'
import { ApprovalFormType } from '../../generated/prisma/client'
import {
  FORM_TYPE_TO_MODULE,
  MODULE_TO_FORM_TYPE,
  flowNodesEqual,
  fromDbFormType,
  normalizeFlowNodes,
  toDbFormType,
} from './approval-flow-config.utils'

test('流程表单类型只在受支持的配置类型与数据库枚举间映射', () => {
  assert.equal(toDbFormType('quotation'), ApprovalFormType.QUOTATION)
  assert.equal(toDbFormType('contract'), ApprovalFormType.CONTRACT)
  assert.equal(toDbFormType('invoice'), ApprovalFormType.INVOICE)
  assert.equal(toDbFormType('order'), ApprovalFormType.ORDER)
  assert.equal(FORM_TYPE_TO_MODULE.invoice, 'invoice')
  assert.equal(MODULE_TO_FORM_TYPE.invoice, 'invoice')
  assert.equal(fromDbFormType(ApprovalFormType.RECEIVABLE_RECORD_LEGACY), null)
})

test('节点规范化会裁剪名称、去重并稳定排序指定对象', () => {
  assert.deepEqual(
    normalizeFlowNodes([
      {
        name: '  财务审批  ',
        approverType: 'USER',
        approverIds: ['user-b', 'user-a', 'user-b'],
        ccUserIds: ['cc-b', 'cc-a', 'cc-b'],
        mode: 'ALL',
      },
      {
        name: '主管审批',
        approverType: 'DIRECT_LEADER',
        approverIds: ['ignored-user'],
        mode: 'ANY',
      },
    ]),
    [
      {
        name: '财务审批',
        approverType: 'USER',
        approverIds: ['user-a', 'user-b'],
        ccUserIds: ['cc-a', 'cc-b'],
        mode: 'ALL',
      },
      {
        name: '主管审批',
        approverType: 'DIRECT_LEADER',
        approverIds: [],
        ccUserIds: [],
        mode: 'ANY',
      },
    ],
  )
})

test('仅编辑 clientId 或指定对象顺序不会生成新流程版本', () => {
  assert.equal(
    flowNodesEqual(
      [
        {
          clientId: 'editor-a',
          name: '会计审批',
          approverType: 'ROLE',
          approverIds: ['role-b', 'role-a'],
          ccUserIds: ['cc-b', 'cc-a'],
          mode: 'ANY',
        },
      ],
      [
        {
          clientId: 'editor-b',
          name: ' 会计审批 ',
          approverType: 'ROLE',
          approverIds: ['role-a', 'role-b'],
          ccUserIds: ['cc-a', 'cc-b'],
          mode: 'ANY',
        },
      ],
    ),
    true,
  )
})

test('节点定义或顺序变化会识别为新版本内容', () => {
  const leader = {
    name: '主管审批',
    approverType: 'DIRECT_LEADER' as const,
    approverIds: [],
    mode: 'ANY' as const,
  }
  const finance = {
    name: '财务审批',
    approverType: 'ROLE' as const,
    approverIds: ['finance'],
    mode: 'ALL' as const,
  }
  assert.equal(flowNodesEqual([leader, finance], [finance, leader]), false)
  assert.equal(flowNodesEqual([leader], [{ ...leader, mode: 'ALL' }]), false)
  assert.equal(flowNodesEqual([leader], [{ ...leader, ccUserIds: ['user-x'] }]), false)
})
