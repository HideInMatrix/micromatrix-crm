import assert from 'node:assert/strict'
import test from 'node:test'
import { ApprovalsService } from './approvals.service'

test('审批结果业务事件按 Cordys 映射 invoice -> INVOICE_APPROVAL', () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const resolve = (service as unknown as {
    approvalResultEvent(module: string): string | undefined
  }).approvalResultEvent.bind(service)

  assert.equal(resolve('quote'), 'BUSINESS_QUOTATION_APPROVAL')
  assert.equal(resolve('contract'), 'CONTRACT_APPROVAL')
  assert.equal(resolve('order'), 'ORDER_APPROVAL')
  assert.equal(resolve('invoice'), 'INVOICE_APPROVAL')
  assert.equal(resolve('unknown'), undefined)
})

test('发票审批结束真实走 INVOICE_APPROVAL 业务消息并通知提交人', async () => {
  const sent: Array<Record<string, unknown>> = []
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    businessNotifications: { send(input: Record<string, unknown>): Promise<number> }
    notifications: { notify(): Promise<void> }
    sendApprovalResult(
      instance: Record<string, unknown>,
      operatorId: string | undefined,
      message: { title: string; content: string },
    ): Promise<void>
  }
  runtime.businessNotifications = {
    send: async (input) => {
      sent.push(input)
      return 1
    },
  }
  runtime.notifications = {
    notify: async () => {
      throw new Error('invoice approval should not fall back to generic notification')
    },
  }

  await runtime.sendApprovalResult(
    { module: 'invoice', tenantId: 'tenant-a', submitterId: 'submitter-a' },
    'approver-a',
    { title: '审批已通过', content: '发票已审批通过' },
  )

  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.event, 'INVOICE_APPROVAL')
  assert.deepEqual(sent[0]?.recipientIds, ['submitter-a'])
  assert.equal(sent[0]?.operatorId, 'approver-a')
  assert.equal(sent[0]?.excludeSelf, true)
})

test('同意任务写 task action 与独立 ApprovalRecord，意见不再写回 task', async () => {
  const taskUpdates: Array<Record<string, unknown>> = []
  const records: Array<Record<string, unknown>> = []
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    prisma: {
      approvalTask: {
        update(input: Record<string, unknown>): Promise<unknown>
        findMany(input: Record<string, unknown>): Promise<Array<Record<string, unknown>>>
        updateMany(input: Record<string, unknown>): Promise<unknown>
      }
      approvalRecord: { create(input: { data: Record<string, unknown> }): Promise<unknown> }
      approvalInstance: { findUniqueOrThrow(input: Record<string, unknown>): Promise<Record<string, unknown>> }
      $transaction(input: Array<Promise<unknown>>): Promise<unknown[]>
    }
    ensurePendingTask(user: Record<string, unknown>, taskId: string): Promise<Record<string, unknown>>
  }
  runtime.ensurePendingTask = async () => ({
    id: 'task-a',
    tenantId: 'tenant-a',
    instanceId: 'instance-a',
    nodeId: 'node-a',
    nodeIndex: 0,
    nodeRound: 2,
    nodeName: '主管审批',
    approverId: 'approver-a',
    taskType: 'APPROVAL',
    status: 'PENDING',
    action: null,
    handledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  runtime.prisma = {
    approvalTask: {
      update: async (input) => {
        taskUpdates.push(input)
        return input
      },
      findMany: async () => [{ id: 'still-pending' }],
      updateMany: async (input) => input,
    },
    approvalRecord: {
      create: async (input) => {
        records.push(input.data)
        return input
      },
    },
    approvalInstance: {
      findUniqueOrThrow: async () => ({
        id: 'instance-a',
        targetName: '测试合同',
        nodesSnapshot: [{ name: '主管审批', approverType: 'USER', approverIds: [], mode: 'ALL' }],
      }),
    },
    $transaction: async (input) => Promise.all(input),
  }

  await service.approveTask(
    { id: 'approver-a', tenantId: 'tenant-a', name: '审批人' } as never,
    'task-a',
    '  同意执行  ',
  )

  assert.equal(taskUpdates.length, 1)
  assert.deepEqual((taskUpdates[0]?.data as Record<string, unknown>).status, 'APPROVED')
  assert.deepEqual((taskUpdates[0]?.data as Record<string, unknown>).action, 'APPROVE')
  assert.equal('comment' in (taskUpdates[0]?.data as Record<string, unknown>), false)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.taskId, 'task-a')
  assert.equal(records[0]?.nodeId, 'node-a')
  assert.equal(records[0]?.nodeRound, 2)
  assert.equal(records[0]?.result, 'APPROVE')
  assert.equal(records[0]?.comment, '同意执行')
})

test('驳回任务与 ApprovalRecord 在同一事务写入并保留 round/node', async () => {
  const transactionEntries: unknown[] = []
  const records: Array<Record<string, unknown>> = []
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    prisma: {
      approvalTask: {
        update(input: Record<string, unknown>): Promise<unknown>
        updateMany(input: Record<string, unknown>): Promise<unknown>
      }
      approvalRecord: { create(input: { data: Record<string, unknown> }): Promise<unknown> }
      approvalInstance: {
        findUniqueOrThrow(input: Record<string, unknown>): Promise<Record<string, unknown>>
        update(input: Record<string, unknown>): Promise<unknown>
      }
      $transaction(input: Array<Promise<unknown>>): Promise<unknown[]>
    }
    resources: { setBizStatus(): Promise<void> }
    ensurePendingTask(user: Record<string, unknown>, taskId: string): Promise<Record<string, unknown>>
    restorePreUpdateSnapshot(instance: Record<string, unknown>, operatorId: string): Promise<void>
    sendApprovalResult(
      instance: Record<string, unknown>,
      operatorId: string,
      message: Record<string, unknown>,
    ): Promise<void>
  }
  runtime.ensurePendingTask = async () => ({
    id: 'task-r',
    tenantId: 'tenant-a',
    instanceId: 'instance-r',
    nodeId: 'node-r',
    nodeIndex: 1,
    nodeRound: 3,
    nodeName: '财务审批',
    approverId: 'approver-a',
    taskType: 'APPROVAL',
    status: 'PENDING',
    action: null,
    handledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  runtime.prisma = {
    approvalTask: {
      update: async (input) => input,
      updateMany: async (input) => input,
    },
    approvalRecord: {
      create: async (input) => {
        records.push(input.data)
        return input
      },
    },
    approvalInstance: {
      findUniqueOrThrow: async () => ({
        id: 'instance-r',
        tenantId: 'tenant-a',
        module: 'contract',
        targetId: 'contract-r',
        targetName: '测试合同',
      }),
      update: async (input) => input,
    },
    $transaction: async (input) => {
      transactionEntries.push(...input)
      return Promise.all(input)
    },
  }
  runtime.resources = { setBizStatus: async () => undefined }
  runtime.restorePreUpdateSnapshot = async () => undefined
  runtime.sendApprovalResult = async () => undefined

  await service.rejectTask(
    { id: 'approver-a', tenantId: 'tenant-a', name: '审批人' } as never,
    'task-r',
    '  资料不完整  ',
  )

  assert.equal(transactionEntries.length, 4)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.taskId, 'task-r')
  assert.equal(records[0]?.nodeId, 'node-r')
  assert.equal(records[0]?.nodeRound, 3)
  assert.equal(records[0]?.result, 'REJECT')
  assert.equal(records[0]?.comment, '资料不完整')
})

test('节点再次进入时 round 取 task/record 最大值 + 1', async () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    prisma: {
      approvalTask: { aggregate(): Promise<{ _max: { nodeRound: number | null } }> }
      approvalRecord: { aggregate(): Promise<{ _max: { nodeRound: number | null } }> }
    }
    nextApprovalNodeRound(instanceId: string, nodeId: string | null): Promise<number>
  }
  runtime.prisma = {
    approvalTask: { aggregate: async () => ({ _max: { nodeRound: 2 } }) },
    approvalRecord: { aggregate: async () => ({ _max: { nodeRound: 3 } }) },
  }

  assert.equal(await runtime.nextApprovalNodeRound('instance-a', 'node-a'), 4)
  assert.equal(await runtime.nextApprovalNodeRound('instance-a', null), 1)
})

test('待办任务查询强制 tenant/owner/status，并拒绝已执行 BACK 的旧任务', async () => {
  const captured: Array<Record<string, unknown>> = []
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    prisma: {
      approvalTask: { findFirst(input: Record<string, unknown>): Promise<Record<string, unknown> | null> }
      approvalAddSignTask: { findUnique(): Promise<null> }
    }
    ensurePendingTask(user: Record<string, unknown>, taskId: string): Promise<Record<string, unknown>>
  }
  runtime.prisma = {
    approvalTask: {
      findFirst: async (input) => {
        captured.push(input)
        return {
          id: 'task-back',
          tenantId: 'tenant-a',
          instanceId: 'instance-a',
          nodeId: 'node-a',
          nodeIndex: 1,
          nodeRound: 1,
          nodeName: '二级审批',
          approverId: 'user-a',
          taskType: 'APPROVAL',
          status: 'PENDING',
          action: 'BACK',
        }
      },
    },
    approvalAddSignTask: { findUnique: async () => null },
  }

  await assert.rejects(
    () => runtime.ensurePendingTask({ id: 'user-a', tenantId: 'tenant-a' }, 'task-back'),
    /当前任务已经执行节点退回/,
  )
  const where = captured[0]?.where as Record<string, unknown>
  assert.equal(where.tenantId, 'tenant-a')
  assert.equal(where.approverId, 'user-a')
  assert.equal(where.status, 'PENDING')
  assert.deepEqual(where.instance, { status: 'PENDING' })
})
