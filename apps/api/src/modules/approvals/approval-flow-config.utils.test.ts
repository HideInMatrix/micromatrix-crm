import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FORM_TYPE_TO_MODULE,
  MODULE_TO_FORM_TYPE,
  flowNodesEqual,
  fromDbFormType,
  normalizeFlowNodes,
  toDbFormType,
} from './approval-flow-config.utils'

const ApprovalFormType = {
  GENERIC: 'GENERIC',
} as const

test('流程表单类型只在受支持的配置类型与数据库枚举间映射', () => {
  assert.equal(toDbFormType('generic'), ApprovalFormType.GENERIC)
  assert.equal(FORM_TYPE_TO_MODULE.generic, 'generic')
  assert.equal(MODULE_TO_FORM_TYPE.generic, 'generic')
  assert.equal(fromDbFormType(ApprovalFormType.GENERIC), 'generic')
})

test('节点规范化会裁剪名称、去重排序指定对象并保留层级策略默认值', () => {
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
        approverIds: ['2'],
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
        emptyApproverAction: 'AUTO_PASS',
        fallbackApprover: null,
        sameSubmitterAction: 'SKIP',
        approverDirection: 'BOTTOM_UP',
      },
      {
        name: '主管审批',
        approverType: 'DIRECT_LEADER',
        approverIds: ['2'],
        ccUserIds: [],
        mode: 'ANY',
        emptyApproverAction: 'AUTO_PASS',
        fallbackApprover: null,
        sameSubmitterAction: 'SKIP',
        approverDirection: 'BOTTOM_UP',
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
