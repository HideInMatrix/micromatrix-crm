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
      approvalRecord: {
        findFirst(input: Record<string, unknown>): Promise<Record<string, unknown> | null>
        deleteMany(input: Record<string, unknown>): Promise<unknown>
        create(input: { data: Record<string, unknown> }): Promise<unknown>
      }
      approvalInstance: { findUniqueOrThrow(input: Record<string, unknown>): Promise<Record<string, unknown>> }
      $transaction(input: (tx: unknown) => Promise<unknown>): Promise<unknown>
    }
    ensurePendingTask(user: Record<string, unknown>, taskId: string): Promise<Record<string, unknown>>
    ensureActionAttachmentIds(user: Record<string, unknown>, ids?: string[]): Promise<string[]>
    requireCommentForInstance(user: Record<string, unknown>, instanceId: string): Promise<boolean>
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
  runtime.ensureActionAttachmentIds = async (_user, ids) => ids ?? []
  runtime.requireCommentForInstance = async () => false
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
      findFirst: async () => null,
      deleteMany: async (input) => input,
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
    $transaction: async (input) => input(runtime.prisma),
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
  const taskUpdates: Array<Record<string, unknown>> = []
  const skippedUpdates: Array<Record<string, unknown>> = []
  const instanceUpdates: Array<Record<string, unknown>> = []
  const records: Array<Record<string, unknown>> = []
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    prisma: {
      approvalTask: {
        update(input: Record<string, unknown>): Promise<unknown>
        updateMany(input: Record<string, unknown>): Promise<unknown>
      }
      approvalRecord: {
        findFirst(input: Record<string, unknown>): Promise<Record<string, unknown> | null>
        deleteMany(input: Record<string, unknown>): Promise<unknown>
        create(input: { data: Record<string, unknown> }): Promise<unknown>
      }
      approvalInstance: {
        findUniqueOrThrow(input: Record<string, unknown>): Promise<Record<string, unknown>>
        update(input: Record<string, unknown>): Promise<unknown>
      }
      $transaction(input: (tx: unknown) => Promise<unknown>): Promise<unknown>
    }
    resources: { setBizStatus(): Promise<void> }
    ensurePendingTask(user: Record<string, unknown>, taskId: string): Promise<Record<string, unknown>>
    ensureActionAttachmentIds(user: Record<string, unknown>, ids?: string[]): Promise<string[]>
    requireCommentForInstance(user: Record<string, unknown>, instanceId: string): Promise<boolean>
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
  runtime.ensureActionAttachmentIds = async (_user, ids) => ids ?? []
  runtime.requireCommentForInstance = async () => false
  runtime.prisma = {
    approvalTask: {
      update: async (input) => {
        taskUpdates.push(input)
        return input
      },
      updateMany: async (input) => {
        skippedUpdates.push(input)
        return input
      },
    },
    approvalRecord: {
      findFirst: async () => null,
      deleteMany: async (input) => input,
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
      update: async (input) => {
        instanceUpdates.push(input)
        return input
      },
    },
    $transaction: async (input) => input(runtime.prisma),
  }
  runtime.resources = { setBizStatus: async () => undefined }
  runtime.restorePreUpdateSnapshot = async () => undefined
  runtime.sendApprovalResult = async () => undefined

  await service.rejectTask(
    { id: 'approver-a', tenantId: 'tenant-a', name: '审批人' } as never,
    'task-r',
    '  资料不完整  ',
  )

  assert.equal(taskUpdates.length, 1)
  assert.equal(skippedUpdates.length, 1)
  assert.equal(instanceUpdates.length, 1)
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

test('审批人撤回的 ANY / ALL 可逆边界按当前活动节点 fail-closed', () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const canWithdraw = (service as unknown as {
    isTaskWithdrawable(
      instance: Record<string, unknown>,
      tasks: Array<Record<string, unknown>>,
      task: Record<string, unknown>,
      allowWithdraw: boolean,
    ): boolean
  }).isTaskWithdrawable.bind(service)

  const baseTask = {
    id: 'task-a',
    instanceId: 'instance-a',
    tenantId: 'tenant-a',
    nodeId: 'node-a',
    nodeIndex: 0,
    nodeRound: 1,
    nodeName: '一级审批',
    approverId: 'user-a',
    taskType: 'APPROVAL',
    status: 'APPROVED',
    action: 'APPROVE',
  }
  const anyInstance = {
    id: 'instance-a',
    status: 'PENDING',
    currentNodeIndex: 1,
    nodesSnapshot: [
      { nodeId: 'node-a', name: '一级审批', approverType: 'USER', approverIds: ['user-a'], mode: 'ANY' },
      { nodeId: 'node-b', name: '二级审批', approverType: 'USER', approverIds: ['user-b'], mode: 'ANY' },
      { nodeId: 'node-c', name: '三级审批', approverType: 'USER', approverIds: ['user-c'], mode: 'ANY' },
    ],
  }
  const nextPending = {
    ...baseTask,
    id: 'task-b',
    nodeId: 'node-b',
    nodeIndex: 1,
    nodeName: '二级审批',
    approverId: 'user-b',
    status: 'PENDING',
    action: null,
  }
  assert.equal(canWithdraw(anyInstance, [baseTask, nextPending], baseTask, true), true)
  assert.equal(canWithdraw(anyInstance, [baseTask, nextPending], baseTask, false), false)

  const secondApproved = { ...nextPending, status: 'APPROVED', action: 'APPROVE' }
  const thirdPending = {
    ...baseTask,
    id: 'task-c',
    nodeId: 'node-c',
    nodeIndex: 2,
    nodeName: '三级审批',
    approverId: 'user-c',
    status: 'PENDING',
    action: null,
  }
  assert.equal(
    canWithdraw(
      { ...anyInstance, currentNodeIndex: 2 },
      [baseTask, secondApproved, thirdPending],
      baseTask,
      true,
    ),
    false,
    '已有中间审批节点完成后，旧 task 必须不可撤回',
  )

  const peerPending = {
    ...baseTask,
    id: 'task-peer',
    approverId: 'user-peer',
    status: 'PENDING',
    action: null,
  }
  const allInstance = {
    ...anyInstance,
    currentNodeIndex: 0,
    nodesSnapshot: [
      {
        nodeId: 'node-a',
        name: '一级会签',
        approverType: 'USER',
        approverIds: ['user-a', 'user-peer'],
        mode: 'ALL',
      },
    ],
  }
  assert.equal(canWithdraw(allInstance, [baseTask, peerPending], baseTask, true), true)
  assert.equal(
    canWithdraw({ ...allInstance, currentNodeIndex: 1 }, [baseTask, peerPending], baseTask, true),
    false,
  )
})

test('撤回后同 task/node/round 重审按 Cordys 保留或 delete+create ApprovalRecord', async () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    saveApprovalRecord(
      tx: Record<string, unknown>,
      user: Record<string, unknown>,
      task: Record<string, unknown>,
      result: 'APPROVE' | 'REJECT',
      comment: string | null,
      attachmentIds?: string[],
    ): Promise<void>
  }
  let deleted = 0
  let relationDeleted = 0
  const created: Array<Record<string, unknown>> = []
  const attachmentRelations: Array<Record<string, unknown>> = []
  const tx = {
    approvalRecord: {
      findFirst: async () => ({ id: 'record-old', result: 'APPROVE' }),
      deleteMany: async () => {
        deleted += 1
        return { count: 1 }
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data)
        return { id: `record-new-${created.length}`, ...data }
      },
    },
    approvalInstanceAttachment: {
      deleteMany: async () => {
        relationDeleted += 1
        return { count: 1 }
      },
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        attachmentRelations.push(...data)
        return { count: data.length }
      },
    },
  }
  const user = { id: 'user-a', tenantId: 'tenant-a' }
  const task = { id: 'task-a', instanceId: 'instance-a', nodeId: 'node-a', nodeRound: 1 }

  await runtime.saveApprovalRecord(tx, user, task, 'APPROVE', null)
  assert.equal(deleted, 0)
  assert.equal(created.length, 0, '无新意见再次同意时保留原 record')

  await runtime.saveApprovalRecord(tx, user, task, 'APPROVE', '重新确认通过')
  assert.equal(deleted, 1)
  assert.equal(relationDeleted, 1)
  assert.equal(created.length, 1)
  assert.equal(created[0]?.result, 'APPROVE')
  assert.equal(created[0]?.comment, '重新确认通过')

  await runtime.saveApprovalRecord(tx, user, task, 'REJECT', '复核后驳回')
  assert.equal(deleted, 2)
  assert.equal(relationDeleted, 2)
  assert.equal(created.length, 2)
  assert.equal(created[1]?.result, 'REJECT')
  assert.equal(created[1]?.comment, '复核后驳回')

  await runtime.saveApprovalRecord(tx, user, task, 'APPROVE', null, ['attachment-a'])
  assert.equal(deleted, 3, '出现新附件时必须替换旧 record')
  assert.equal(relationDeleted, 3, '替换旧 record 时同步清理旧 element relation')
  assert.equal(attachmentRelations.length, 1)
  assert.equal(attachmentRelations[0]?.attachmentId, 'attachment-a')
  assert.equal(attachmentRelations[0]?.elementId, 'record-new-3')
})

test('requireComment=true 时同意和驳回都拒绝空审批意见', async () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    ensurePendingTask(): Promise<Record<string, unknown>>
    ensureActionAttachmentIds(): Promise<string[]>
    requireCommentForInstance(): Promise<boolean>
  }
  runtime.ensurePendingTask = async () => ({
    id: 'task-required',
    tenantId: 'tenant-a',
    instanceId: 'instance-required',
    nodeId: 'node-required',
    nodeIndex: 0,
    nodeRound: 1,
    nodeName: '必填审批',
    approverId: 'user-a',
    taskType: 'APPROVAL',
    status: 'PENDING',
    action: null,
  })
  runtime.ensureActionAttachmentIds = async () => []
  runtime.requireCommentForInstance = async () => true

  const user = { id: 'user-a', tenantId: 'tenant-a', name: '审批人' } as never
  await assert.rejects(() => service.approveTask(user, 'task-required'), /要求填写审批意见/)
  await assert.rejects(() => service.rejectTask(user, 'task-required'), /要求填写审批意见/)
})

test('审批动作附件只接受当前操作人尚未归档的租户内附件', async () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  let attachmentQuery: Record<string, unknown> | undefined
  const runtime = service as unknown as {
    prisma: {
      attachment: { findMany(input: Record<string, unknown>): Promise<Array<{ id: string }>> }
      approvalInstanceAttachment: {
        findMany(input: Record<string, unknown>): Promise<Array<{ attachmentId: string }>>
      }
    }
    ensureActionAttachmentIds(user: Record<string, unknown>, ids?: string[]): Promise<string[]>
  }
  runtime.prisma = {
    attachment: {
      findMany: async (input) => {
        attachmentQuery = input
        return [{ id: 'attachment-a' }]
      },
    },
    approvalInstanceAttachment: { findMany: async () => [] },
  }
  const user = { id: 'user-a', tenantId: 'tenant-a' }
  assert.deepEqual(await runtime.ensureActionAttachmentIds(user, ['attachment-a', 'attachment-a']), [
    'attachment-a',
  ])
  assert.deepEqual((attachmentQuery?.where as Record<string, unknown>) ?? {}, {
    id: { in: ['attachment-a'] },
    tenantId: 'tenant-a',
    uploaderId: 'user-a',
    targetType: null,
    targetId: null,
  })

  runtime.prisma.approvalInstanceAttachment.findMany = async () => [
    { attachmentId: 'attachment-a' },
  ]
  await assert.rejects(
    () => runtime.ensureActionAttachmentIds(user, ['attachment-a']),
    /已归档的审批附件不能重复绑定/,
  )
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
