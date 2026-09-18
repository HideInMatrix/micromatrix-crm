import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ApprovalsService } from './approvals.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '审批 approve/reject 使用 Prisma 8 transaction 保持 record/附件/实例原子语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const approverId = `approver-${suffix}`
    const submitterId = `submitter-${suffix}`

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 approval actions ${suffix}`, slug: `p8-approval-actions-${suffix}` },
      })
      const instance = await fixtureDb.approvalInstance.create({
        data: {
          tenantId: tenant.id,
          module: 'contract',
          targetId: `contract-${suffix}`,
          targetName: 'Prisma 8 approval action contract',
          nodesSnapshot: [
            {
              nodeId: `node-${suffix}`,
              name: '审批节点',
              approverType: 'USER',
              approverIds: [approverId],
              ccUserIds: [],
              mode: 'ANY',
            },
          ],
          submitterId,
          submitterName: 'Submitter',
        },
      })
      const task = await fixtureDb.approvalTask.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          nodeId: `node-${suffix}`,
          nodeIndex: 0,
          nodeRound: 1,
          nodeName: '审批节点',
          approverId,
        },
      })
      const attachment = await fixtureDb.attachment.create({
        data: {
          tenantId: tenant.id,
          uploaderId: approverId,
          name: 'approval.txt',
          path: `/tmp/${suffix}/approval.txt`,
        },
      })

      const resources = { setBizStatus: async () => undefined }
      const service = new ApprovalsService(
        { client: prisma8Client } as Prisma8Service,
        {} as never,
        {} as never,
        resources as never,
        {} as never,
      )
      const internals = service as unknown as {
        completeApprovedNodeTask(): Promise<void>
        restorePreUpdateSnapshot(): Promise<void>
        applyNodePostFieldUpdates(): Promise<void>
        sendApprovalResult(): Promise<void>
      }
      internals.completeApprovedNodeTask = async () => undefined
      internals.restorePreUpdateSnapshot = async () => undefined
      internals.applyNodePostFieldUpdates = async () => undefined
      internals.sendApprovalResult = async () => undefined

      await service.approveTask(
        { id: approverId, tenantId: tenant.id, name: 'Approver' } as never,
        task.id,
        '  首次同意  ',
        [attachment.id],
      )

      const approvedTask = await fixtureDb.approvalTask.findUniqueOrThrow({ where: { id: task.id } })
      assert.equal(approvedTask.status, 'APPROVED')
      assert.equal(approvedTask.action, 'APPROVE')
      assert.ok(approvedTask.handledAt instanceof Date)
      const firstRecords = await fixtureDb.approvalRecord.findMany({
        where: { tenantId: tenant.id, instanceId: instance.id, taskId: task.id },
      })
      assert.equal(firstRecords.length, 1)
      assert.equal(firstRecords[0]?.result, 'APPROVE')
      assert.equal(firstRecords[0]?.comment, '首次同意')
      const firstRelations = await fixtureDb.approvalInstanceAttachment.findMany({
        where: { tenantId: tenant.id, instanceId: instance.id },
      })
      assert.equal(firstRelations.length, 1)
      assert.equal(firstRelations[0]?.elementId, firstRecords[0]?.id)
      assert.equal(firstRelations[0]?.attachmentId, attachment.id)

      await fixtureDb.approvalTask.update({
        where: { id: task.id },
        data: { status: 'PENDING', action: null, handledAt: null },
      })
      await service.approveTask(
        { id: approverId, tenantId: tenant.id, name: 'Approver' } as never,
        task.id,
      )
      const reusedRecords = await fixtureDb.approvalRecord.findMany({
        where: { tenantId: tenant.id, instanceId: instance.id, taskId: task.id },
      })
      assert.equal(reusedRecords.length, 1)
      assert.equal(reusedRecords[0]?.id, firstRecords[0]?.id)
      assert.equal(reusedRecords[0]?.comment, '首次同意')
      assert.equal(
        await fixtureDb.approvalInstanceAttachment.count({
          where: { tenantId: tenant.id, instanceId: instance.id },
        }),
        1,
      )

      await fixtureDb.approvalTask.update({
        where: { id: task.id },
        data: { status: 'PENDING', action: null, handledAt: null },
      })
      const peerTask = await fixtureDb.approvalTask.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          nodeId: `node-${suffix}`,
          nodeIndex: 0,
          nodeRound: 1,
          nodeName: '审批节点',
          approverId: `peer-${suffix}`,
        },
      })
      await service.rejectTask(
        { id: approverId, tenantId: tenant.id, name: 'Approver' } as never,
        task.id,
        '  改为驳回  ',
      )

      const rejectedTask = await fixtureDb.approvalTask.findUniqueOrThrow({ where: { id: task.id } })
      assert.equal(rejectedTask.status, 'REJECTED')
      assert.equal(rejectedTask.action, 'REJECT')
      const skippedPeer = await fixtureDb.approvalTask.findUniqueOrThrow({ where: { id: peerTask.id } })
      assert.equal(skippedPeer.status, 'SKIPPED')
      const rejectedInstance = await fixtureDb.approvalInstance.findUniqueOrThrow({
        where: { id: instance.id },
      })
      assert.equal(rejectedInstance.status, 'REJECTED')
      assert.ok(rejectedInstance.finishedAt instanceof Date)

      const rejectedRecords = await fixtureDb.approvalRecord.findMany({
        where: { tenantId: tenant.id, instanceId: instance.id, taskId: task.id },
      })
      assert.equal(rejectedRecords.length, 1)
      assert.notEqual(rejectedRecords[0]?.id, firstRecords[0]?.id)
      assert.equal(rejectedRecords[0]?.result, 'REJECT')
      assert.equal(rejectedRecords[0]?.comment, '改为驳回')
      assert.equal(
        await fixtureDb.approvalInstanceAttachment.count({
          where: { tenantId: tenant.id, instanceId: instance.id },
        }),
        0,
      )
    } finally {
      const tenant = await fixtureDb.tenant.findUnique({
        where: { slug: `p8-approval-actions-${suffix}` },
        select: { id: true },
      })
      if (tenant) {
        await fixtureDb.approvalInstance.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.attachment.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.tenant.delete({ where: { id: tenant.id } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)

test(
  '审批 signTask 使用 Prisma 8 transaction 保持 BEFORE/AFTER 加签链与附件语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 sign task ${suffix}`, slug: `p8-sign-task-${suffix}` },
      })
      const sourceApprover = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Source Approver',
          passwordHash: 'not-used',
        },
      })
      const signApprover = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Sign Approver',
          passwordHash: 'not-used',
        },
      })
      const flow = await fixtureDb.approvalFlow.create({
        data: {
          tenantId: tenant.id,
          number: `FLOW-${suffix}`,
          formType: 'CONTRACT',
          name: 'Prisma 8 sign flow',
          allowAddSign: true,
        },
      })
      const instance = await fixtureDb.approvalInstance.create({
        data: {
          tenantId: tenant.id,
          flowId: flow.id,
          module: 'contract',
          targetId: `contract-${suffix}`,
          targetName: 'Prisma 8 sign contract',
          nodesSnapshot: [],
          submitterId: sourceApprover.id,
          submitterName: sourceApprover.name,
        },
      })
      const beforeSource = await fixtureDb.approvalTask.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          nodeId: `node-before-${suffix}`,
          nodeIndex: 0,
          nodeRound: 1,
          nodeName: 'Before source',
          approverId: sourceApprover.id,
        },
      })
      const afterSource = await fixtureDb.approvalTask.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          nodeId: `node-after-${suffix}`,
          nodeIndex: 1,
          nodeRound: 1,
          nodeName: 'After source',
          approverId: sourceApprover.id,
        },
      })
      const beforeAttachment = await fixtureDb.attachment.create({
        data: {
          tenantId: tenant.id,
          uploaderId: sourceApprover.id,
          name: 'before.txt',
          path: `/tmp/${suffix}/before.txt`,
        },
      })
      const afterAttachment = await fixtureDb.attachment.create({
        data: {
          tenantId: tenant.id,
          uploaderId: sourceApprover.id,
          name: 'after.txt',
          path: `/tmp/${suffix}/after.txt`,
        },
      })

      const notifications: Array<Record<string, unknown>> = []
      const service = new ApprovalsService(
        { client: prisma8Client } as Prisma8Service,
        {
          notifyMany: async (
            tenantId: string,
            userIds: string[],
            message: Record<string, unknown>,
          ) => {
            notifications.push({ tenantId, userIds, message })
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
      )

      const beforeResult = await service.signTask(
        { id: sourceApprover.id, tenantId: tenant.id, name: sourceApprover.name } as never,
        beforeSource.id,
        {
          type: 'BEFORE',
          signApprover: signApprover.id,
          comment: '  前置加签  ',
          attachmentIds: [beforeAttachment.id],
        },
      )
      const storedBeforeSource = await fixtureDb.approvalTask.findUniqueOrThrow({
        where: { id: beforeSource.id },
      })
      assert.equal(storedBeforeSource.status, 'PENDING')
      assert.equal(storedBeforeSource.action, 'SIGN')
      assert.equal(storedBeforeSource.handledAt, null)
      const beforeSignTask = await fixtureDb.approvalTask.findUniqueOrThrow({
        where: { id: beforeResult.id },
      })
      assert.equal(beforeSignTask.taskType, 'SIGN')
      assert.equal(beforeSignTask.approverId, signApprover.id)
      assert.equal(beforeSignTask.status, 'PENDING')
      const beforeRelation = await fixtureDb.approvalAddSignTask.findUniqueOrThrow({
        where: { taskId: beforeSignTask.id },
      })
      assert.equal(beforeRelation.type, 'BEFORE')
      assert.equal(beforeRelation.signTaskId, beforeSource.id)
      assert.equal(beforeRelation.rootTaskId, beforeSource.id)
      assert.equal(beforeRelation.comment, '前置加签')
      assert.equal(
        await fixtureDb.approvalRecord.count({ where: { taskId: beforeSource.id } }),
        0,
      )
      const beforeRelations = await fixtureDb.approvalInstanceAttachment.findMany({
        where: { instanceId: instance.id, attachmentId: beforeAttachment.id },
      })
      assert.equal(beforeRelations.length, 1)
      assert.equal(beforeRelations[0]?.elementId, beforeRelation.id)

      const afterResult = await service.signTask(
        { id: sourceApprover.id, tenantId: tenant.id, name: sourceApprover.name } as never,
        afterSource.id,
        {
          type: 'AFTER',
          signApprover: signApprover.id,
          comment: '  后置加签  ',
          attachmentIds: [afterAttachment.id],
        },
      )
      const storedAfterSource = await fixtureDb.approvalTask.findUniqueOrThrow({
        where: { id: afterSource.id },
      })
      assert.equal(storedAfterSource.status, 'APPROVED')
      assert.equal(storedAfterSource.action, 'APPROVE')
      assert.ok(storedAfterSource.handledAt instanceof Date)
      const afterSignTask = await fixtureDb.approvalTask.findUniqueOrThrow({
        where: { id: afterResult.id },
      })
      assert.equal(afterSignTask.taskType, 'SIGN')
      assert.equal(afterSignTask.approverId, signApprover.id)
      const afterRelation = await fixtureDb.approvalAddSignTask.findUniqueOrThrow({
        where: { taskId: afterSignTask.id },
      })
      assert.equal(afterRelation.type, 'AFTER')
      assert.equal(afterRelation.signTaskId, afterSource.id)
      assert.equal(afterRelation.rootTaskId, afterSource.id)
      assert.equal(afterRelation.comment, '后置加签')
      const afterRecords = await fixtureDb.approvalRecord.findMany({
        where: { tenantId: tenant.id, instanceId: instance.id, taskId: afterSource.id },
      })
      assert.equal(afterRecords.length, 1)
      assert.equal(afterRecords[0]?.result, 'APPROVE')
      assert.equal(afterRecords[0]?.comment, '后置加签')
      const afterRelations = await fixtureDb.approvalInstanceAttachment.findMany({
        where: { instanceId: instance.id, attachmentId: afterAttachment.id },
        orderBy: { elementId: 'asc' },
      })
      assert.equal(afterRelations.length, 2)
      assert.deepEqual(
        new Set(afterRelations.map((relation) => relation.elementId)),
        new Set([afterRelation.id, afterRecords[0]!.id]),
      )
      assert.equal(notifications.length, 2)
    } finally {
      const tenant = await fixtureDb.tenant.findUnique({
        where: { slug: `p8-sign-task-${suffix}` },
        select: { id: true },
      })
      if (tenant) {
        await fixtureDb.approvalInstance.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.approvalFlow.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.attachment.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.tenant.delete({ where: { id: tenant.id } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
