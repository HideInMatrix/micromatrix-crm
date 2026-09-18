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
    prisma8: {
      client: {
        orm: { public: { ApprovalInstances: { where(): { first(): Promise<Record<string, unknown>> } } } }
        transaction(input: (tx: unknown) => Promise<unknown>): Promise<unknown>
      }
    }
    toLegacyInstance(row: Record<string, unknown>): Record<string, unknown>
    ensurePendingTask(user: Record<string, unknown>, taskId: string): Promise<Record<string, unknown>>
    ensureActionAttachmentIds(user: Record<string, unknown>, ids?: string[]): Promise<string[]>
    requireCommentForInstance(user: Record<string, unknown>, instanceId: string): Promise<boolean>
    saveApprovalRecordPrisma8(
      tx: unknown,
      user: Record<string, unknown>,
      task: Record<string, unknown>,
      result: 'APPROVE' | 'REJECT',
      comment: string | null,
      attachmentIds: string[],
      updatedAt: unknown,
    ): Promise<unknown>
    completeApprovedNodeTask(): Promise<void>
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
  runtime.toLegacyInstance = (row) => row
  runtime.prisma8 = {
    client: {
      orm: {
        public: {
          ApprovalInstances: {
            where: () => ({
              first: async () => ({
                id: 'instance-a',
                targetName: '测试合同',
                nodesSnapshot: [
                  { name: '主管审批', approverType: 'USER', approverIds: [], mode: 'ALL' },
                ],
              }),
            }),
          },
        },
      },
      transaction: async (input) =>
        input({
          orm: {
            public: {
              ApprovalTasks: {
                where: () => ({
                  update: async (data: Record<string, unknown>) => {
                    taskUpdates.push(data)
                    return { id: 'task-a', ...data }
                  },
                }),
              },
            },
          },
        }),
    },
  }
  runtime.saveApprovalRecordPrisma8 = async (_tx, _user, task, result, comment) => {
    const record = {
      taskId: task['id'],
      nodeId: task['nodeId'],
      nodeRound: task['nodeRound'],
      result,
      comment,
    }
    records.push(record)
    return record
  }
  runtime.completeApprovedNodeTask = async () => undefined

  await service.approveTask(
    { id: 'approver-a', tenantId: 'tenant-a', name: '审批人' } as never,
    'task-a',
    '  同意执行  ',
  )

  assert.equal(taskUpdates.length, 1)
  assert.deepEqual(taskUpdates[0]?.['status'], 'APPROVED')
  assert.deepEqual(taskUpdates[0]?.['action'], 'APPROVE')
  assert.equal('comment' in (taskUpdates[0] ?? {}), false)
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
    prisma8: {
      client: {
        orm: { public: { ApprovalInstances: { where(): { first(): Promise<Record<string, unknown>> } } } }
        transaction(input: (tx: unknown) => Promise<unknown>): Promise<unknown>
      }
    }
    toLegacyInstance(row: Record<string, unknown>): Record<string, unknown>
    resources: { setBizStatus(): Promise<void> }
    ensurePendingTask(user: Record<string, unknown>, taskId: string): Promise<Record<string, unknown>>
    ensureActionAttachmentIds(user: Record<string, unknown>, ids?: string[]): Promise<string[]>
    requireCommentForInstance(user: Record<string, unknown>, instanceId: string): Promise<boolean>
    saveApprovalRecordPrisma8(
      tx: unknown,
      user: Record<string, unknown>,
      task: Record<string, unknown>,
      result: 'APPROVE' | 'REJECT',
      comment: string | null,
      attachmentIds: string[],
      updatedAt: unknown,
    ): Promise<unknown>
    restorePreUpdateSnapshot(instance: Record<string, unknown>, operatorId: string): Promise<void>
    applyNodePostFieldUpdates(): Promise<void>
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
  runtime.toLegacyInstance = (row) => row
  runtime.prisma8 = {
    client: {
      orm: {
        public: {
          ApprovalInstances: {
            where: () => ({
              first: async () => ({
                id: 'instance-r',
                tenantId: 'tenant-a',
                module: 'contract',
                targetId: 'contract-r',
                targetName: '测试合同',
                nodesSnapshot: [
                  {
                    nodeId: 'node-before',
                    name: '前置审批',
                    approverType: 'USER',
                    approverIds: ['approver-before'],
                    ccUserIds: [],
                    mode: 'ANY',
                  },
                  {
                    nodeId: 'node-r',
                    name: '财务审批',
                    approverType: 'USER',
                    approverIds: ['approver-a'],
                    ccUserIds: [],
                    mode: 'ANY',
                  },
                ],
              }),
            }),
          },
        },
      },
      transaction: async (input) =>
        input({
          orm: {
            public: {
              ApprovalTasks: {
                where: (where: Record<string, unknown>) => ({
                  update: async (data: Record<string, unknown>) => {
                    taskUpdates.push({ where, data })
                    return { id: 'task-r', ...data }
                  },
                  updateAll: async (data: Record<string, unknown>) => {
                    skippedUpdates.push({ where, data })
                    return []
                  },
                }),
              },
              ApprovalInstances: {
                where: (where: Record<string, unknown>) => ({
                  update: async (data: Record<string, unknown>) => {
                    instanceUpdates.push({ where, data })
                    return { id: 'instance-r', ...data }
                  },
                }),
              },
            },
          },
        }),
    },
  }
  runtime.saveApprovalRecordPrisma8 = async (_tx, _user, task, result, comment) => {
    const record = {
      taskId: task['id'],
      nodeId: task['nodeId'],
      nodeRound: task['nodeRound'],
      result,
      comment,
    }
    records.push(record)
    return record
  }
  runtime.resources = { setBizStatus: async () => undefined }
  runtime.restorePreUpdateSnapshot = async () => undefined
  runtime.applyNodePostFieldUpdates = async () => undefined
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
    prisma8: unknown
    nextApprovalNodeRound(instanceId: string, nodeId: string | null): Promise<number>
  }
  const collection = (nodeRound: number) => ({
    where: () => ({
      select: () => ({ orderBy: () => ({ first: async () => ({ nodeRound }) }) }),
    }),
  })
  runtime.prisma8 = {
    client: {
      orm: {
        public: {
          ApprovalTasks: collection(2),
          ApprovalRecords: collection(3),
        },
      },
    },
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
    saveApprovalRecordPrisma8(
      tx: Record<string, unknown>,
      user: Record<string, unknown>,
      task: Record<string, unknown>,
      result: 'APPROVE' | 'REJECT',
      comment: string | null,
      attachmentIds: string[],
      updatedAt: unknown,
    ): Promise<void>
  }
  let deleted = 0
  let relationDeleted = 0
  const created: Array<Record<string, unknown>> = []
  const attachmentRelations: Array<Record<string, unknown>> = []
  const recordQuery = {
    select: () => recordQuery,
    orderBy: () => recordQuery,
    first: async () => ({ id: 'record-old', result: 'APPROVE' }),
    deleteAll: async () => {
      deleted += 1
      return []
    },
  }
  const tx = {
    orm: {
      public: {
        ApprovalRecords: {
          where: () => recordQuery,
          create: async (data: Record<string, unknown>) => {
            created.push(data)
            return { id: `record-new-${created.length}`, ...data }
          },
        },
        ApprovalInstanceAttachments: {
          where: () => ({
            deleteAll: async () => {
              relationDeleted += 1
              return []
            },
          }),
          create: async (data: Record<string, unknown>) => {
            attachmentRelations.push(data)
            return { id: `relation-${attachmentRelations.length}`, ...data }
          },
        },
      },
    },
  }
  const user = { id: 'user-a', tenantId: 'tenant-a' }
  const task = { id: 'task-a', instanceId: 'instance-a', nodeId: 'node-a', nodeRound: 1 }
  const updatedAt = {}

  await runtime.saveApprovalRecordPrisma8(tx, user, task, 'APPROVE', null, [], updatedAt)
  assert.equal(deleted, 0)
  assert.equal(created.length, 0, '无新意见再次同意时保留原 record')

  await runtime.saveApprovalRecordPrisma8(
    tx,
    user,
    task,
    'APPROVE',
    '重新确认通过',
    [],
    updatedAt,
  )
  assert.equal(deleted, 1)
  assert.equal(relationDeleted, 1)
  assert.equal(created.length, 1)
  assert.equal(created[0]?.result, 'APPROVE')
  assert.equal(created[0]?.comment, '重新确认通过')

  await runtime.saveApprovalRecordPrisma8(tx, user, task, 'REJECT', '复核后驳回', [], updatedAt)
  assert.equal(deleted, 2)
  assert.equal(relationDeleted, 2)
  assert.equal(created.length, 2)
  assert.equal(created[1]?.result, 'REJECT')
  assert.equal(created[1]?.comment, '复核后驳回')

  await runtime.saveApprovalRecordPrisma8(
    tx,
    user,
    task,
    'APPROVE',
    null,
    ['attachment-a'],
    updatedAt,
  )
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
  let hasBoundAttachment = false
  const runtime = service as unknown as {
    prisma8: unknown
    ensureActionAttachmentIds(user: Record<string, unknown>, ids?: string[]): Promise<string[]>
  }
  runtime.prisma8 = {
    client: {
      orm: {
        public: {
          Attachments: {
            where: (input: Record<string, unknown>) => {
              attachmentQuery = input
              return {
                where: () => ({ select: () => ({ all: async () => [{ id: 'attachment-a' }] }) }),
              }
            },
          },
          ApprovalInstanceAttachments: {
            where: () => ({
              where: () => ({
                select: () => ({
                  all: async () =>
                    hasBoundAttachment ? [{ attachmentId: 'attachment-a' }] : [],
                }),
              }),
            }),
          },
        },
      },
    },
  }
  const user = { id: 'user-a', tenantId: 'tenant-a' }
  assert.deepEqual(await runtime.ensureActionAttachmentIds(user, ['attachment-a', 'attachment-a']), [
    'attachment-a',
  ])
  assert.deepEqual(attachmentQuery ?? {}, {
    tenantId: 'tenant-a',
    uploaderId: 'user-a',
    targetType: null,
    targetId: null,
  })

  hasBoundAttachment = true
  await assert.rejects(
    () => runtime.ensureActionAttachmentIds(user, ['attachment-a']),
    /已归档的审批附件不能重复绑定/,
  )
})

test('待办任务查询强制 tenant/owner/status，并拒绝已执行 BACK 的旧任务', async () => {
  let taskWhere: Record<string, unknown> | undefined
  let instanceWhere: Record<string, unknown> | undefined
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    prisma8: unknown
    toLegacyTask(row: Record<string, unknown>): Record<string, unknown>
    ensurePendingTask(user: Record<string, unknown>, taskId: string): Promise<Record<string, unknown>>
  }
  runtime.toLegacyTask = (row) => row
  runtime.prisma8 = {
    client: {
      orm: {
        public: {
          ApprovalTasks: {
            where: (input: Record<string, unknown>) => {
              taskWhere = input
              return {
                where: () => ({
                  first: async () => ({
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
                  }),
                }),
              }
            },
          },
          ApprovalInstances: {
            where: (input: Record<string, unknown>) => {
              instanceWhere = input
              return { select: () => ({ first: async () => ({ id: 'instance-a' }) }) }
            },
          },
        },
      },
    },
  }

  await assert.rejects(
    () => runtime.ensurePendingTask({ id: 'user-a', tenantId: 'tenant-a' }, 'task-back'),
    /当前任务已经执行节点退回/,
  )
  assert.equal(taskWhere?.tenantId, 'tenant-a')
  assert.equal(taskWhere?.approverId, 'user-a')
  assert.equal(taskWhere?.status, 'PENDING')
  assert.deepEqual(instanceWhere, { id: 'instance-a', status: 'PENDING' })
})
