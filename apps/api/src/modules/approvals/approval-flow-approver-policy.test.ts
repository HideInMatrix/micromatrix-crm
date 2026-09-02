import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeFlowNodes } from './approval-flow-config.utils'
import { ApprovalsService } from './approvals.service'

test('审批人异常策略进入冻结节点契约并使用 Cordys 业务默认值', () => {
  const [node] = normalizeFlowNodes([
    {
      name: '连续上级审批',
      approverType: 'MULTIPLE_DIRECT_LEADER',
      approverIds: ['3'],
      ccUserIds: [],
      mode: 'ALL',
      emptyApproverAction: 'ASSIGN_SPECIFIC',
      fallbackApprover: ' fallback-user ',
      sameSubmitterAction: 'ASSIGN_SUPERIOR',
      approverDirection: 'TOP_DOWN',
    },
  ])
  assert.deepEqual(node, {
    name: '连续上级审批',
    approverType: 'MULTIPLE_DIRECT_LEADER',
    approverIds: ['3'],
    ccUserIds: [],
    mode: 'ALL',
    emptyApproverAction: 'ASSIGN_SPECIFIC',
    fallbackApprover: 'fallback-user',
    sameSubmitterAction: 'ASSIGN_SUPERIOR',
    approverDirection: 'TOP_DOWN',
  })

  const [defaults] = normalizeFlowNodes([
    { name: '直属上级', approverType: 'DIRECT_LEADER', approverIds: [], ccUserIds: [], mode: 'ANY' },
  ])
  assert.equal(defaults.approverIds[0], '1')
  assert.equal(defaults.emptyApproverAction, 'AUTO_PASS')
  assert.equal(defaults.sameSubmitterAction, 'SKIP')
  assert.equal(defaults.approverDirection, 'BOTTOM_UP')
})

test('动态审批方向严格按 Cordys 的层级位置选择', () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    selectHierarchyApprovers(
      ids: Array<string | null>,
      level: number,
      direction: 'BOTTOM_UP' | 'TOP_DOWN' | undefined,
      multiple: boolean,
    ): string[]
  }
  const chain = ['direct', 'middle', 'top']
  assert.deepEqual(runtime.selectHierarchyApprovers(chain, 2, 'BOTTOM_UP', false), ['middle'])
  assert.deepEqual(runtime.selectHierarchyApprovers(chain, 2, 'TOP_DOWN', false), ['middle'])
  assert.deepEqual(runtime.selectHierarchyApprovers(chain, 2, 'BOTTOM_UP', true), ['direct', 'middle'])
  assert.deepEqual(runtime.selectHierarchyApprovers(chain, 2, 'TOP_DOWN', true), ['top', 'middle'])
  assert.deepEqual(runtime.selectHierarchyApprovers(chain, 4, 'BOTTOM_UP', true), [])
  assert.deepEqual(runtime.selectHierarchyApprovers([null, 'middle', 'top'], 1, 'BOTTOM_UP', false), [])
})

test('duplicate rule: FIRST_ONLY 看历史节点，SEQUENTIAL_ALL 只看紧邻上一节点', async () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const calls: unknown[] = []
  ;(service as unknown as { prisma: unknown }).prisma = {
    approvalTask: {
      findMany: async (args: unknown) => {
        calls.push(args)
        return [{ approverId: 'u1' }, { approverId: 'u3' }]
      },
      aggregate: async () => ({ _max: { nodeRound: 4 } }),
    },
  }
  const runtime = service as unknown as {
    duplicateApproversToSkip(
      instance: { id: string },
      nodeIndex: number,
      nodeId: string | null,
      rule: 'FIRST_ONLY' | 'SEQUENTIAL_ALL' | 'EACH',
      approvers: string[],
    ): Promise<Set<string>>
  }
  assert.deepEqual(
    [...await runtime.duplicateApproversToSkip({ id: 'i1' }, 3, 'n4', 'FIRST_ONLY', ['u1', 'u2'])],
    ['u1'],
  )
  assert.deepEqual(
    [...await runtime.duplicateApproversToSkip({ id: 'i1' }, 3, 'n4', 'SEQUENTIAL_ALL', ['u2', 'u3'])],
    ['u3'],
  )
  assert.deepEqual(
    [...await runtime.duplicateApproversToSkip({ id: 'i1' }, 3, 'n4', 'EACH', ['u1'])],
    [],
  )
  assert.equal(calls.length, 2)
})
