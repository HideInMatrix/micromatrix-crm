import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApprovalConditionConfig } from '@micromatrix/shared'
import { ApprovalFlowConfigService } from './approval-flow-config.service'
import { ApprovalsService } from './approvals.service'
import type { FlowLinkDto, FlowNodeDto } from './dto/approval.dto'

test('Condition runtime 按 AND/OR、比较与 NOT_EQUAL_ORIGINAL 匹配', () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    matchCondition(
      config: ApprovalConditionConfig,
      values: Record<string, unknown>,
      updateFields: Set<string>,
    ): boolean
  }
  const values = { amount: '1200.50', stage: 'S2', tags: ['A', 'B'] }
  assert.equal(
    runtime.matchCondition(
      {
        searchMode: 'AND',
        conditions: [
          { name: 'amount', operator: 'GE', value: 1000 },
          { name: 'stage', operator: 'EQUALS', value: 'S2' },
          { name: 'amount', operator: 'NOT_EQUAL_ORIGINAL' },
        ],
      },
      values,
      new Set(['amount']),
    ),
    true,
  )
  assert.equal(
    runtime.matchCondition(
      {
        searchMode: 'OR',
        conditions: [
          { name: 'stage', operator: 'EQUALS', value: 'S9' },
          { name: 'tags', operator: 'IN', value: ['B'] },
        ],
      },
      values,
      new Set(),
    ),
    true,
  )
})

test('Condition 子表字段按任一行命中，未知 COUNT operator fail-closed', () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    matchCondition(
      config: ApprovalConditionConfig,
      values: Record<string, unknown>,
      updateFields: Set<string>,
    ): boolean
  }
  assert.equal(
    runtime.matchCondition(
      {
        searchMode: 'AND',
        conditions: [{ name: 'products.amount', operator: 'GT', value: 500 }],
      },
      { 'products.amount': ['100', '800'] },
      new Set(),
    ),
    true,
  )
  assert.equal(
    runtime.matchCondition(
      {
        searchMode: 'AND',
        conditions: [{ name: 'products.amount', operator: 'COUNT_GT', value: 1 }],
      },
      { 'products.amount': ['100', '800'] },
      new Set(),
    ),
    false,
  )
})

function graphNodes(): FlowNodeDto[] {
  return [
    { clientId: 'start', name: '开始', nodeType: 'START' },
    {
      clientId: 'high',
      name: '高金额',
      nodeType: 'CONDITION',
      conditionConfig: {
        searchMode: 'AND',
        conditions: [{ name: 'amount', operator: 'GE', value: 1000 }],
      },
    },
    { clientId: 'default', name: '其他', nodeType: 'DEFAULT' },
    {
      clientId: 'manager',
      name: '主管审批',
      nodeType: 'APPROVER',
      approverType: 'USER',
      approverIds: ['u1'],
      ccUserIds: [],
      mode: 'ANY',
    },
    {
      clientId: 'admin',
      name: '管理员审批',
      nodeType: 'APPROVER',
      approverType: 'USER',
      approverIds: ['u2'],
      ccUserIds: [],
      mode: 'ANY',
    },
    { clientId: 'end', name: '结束', nodeType: 'END' },
  ]
}

function graphLinks(): FlowLinkDto[] {
  return [
    { fromNodeId: 'start', toNodeId: 'high', sort: 0 },
    { fromNodeId: 'start', toNodeId: 'default', sort: 1 },
    { fromNodeId: 'high', toNodeId: 'manager', sort: 0 },
    { fromNodeId: 'default', toNodeId: 'admin', sort: 0 },
    { fromNodeId: 'manager', toNodeId: 'end', sort: 0 },
    { fromNodeId: 'admin', toNodeId: 'end', sort: 0 },
  ]
}

test('高级审批图要求 Condition + 唯一 DEFAULT，并拒绝循环', () => {
  const service = Object.create(ApprovalFlowConfigService.prototype) as ApprovalFlowConfigService
  const runtime = service as unknown as {
    validateGraph(nodes: FlowNodeDto[], links: FlowLinkDto[]): void
  }
  assert.doesNotThrow(() => runtime.validateGraph(graphNodes(), graphLinks()))

  assert.throws(
    () => runtime.validateGraph(graphNodes(), graphLinks().filter((link) => link.toNodeId !== 'default')),
    /DEFAULT/,
  )

  const cycle = graphLinks().map((link) => ({ ...link }))
  cycle[cycle.length - 1] = { fromNodeId: 'admin', toNodeId: 'start', sort: 0 }
  assert.throws(() => runtime.validateGraph(graphNodes(), cycle), /START|循环/)
})
