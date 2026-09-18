import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { jsonValue } from '../../prisma/json-value'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { ApprovalsService } from './approvals.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '审批 approve/reject 使用 Prisma transaction 保持 record/附件/实例原子语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const approverId = `approver-${suffix}`
    const submitterId = `submitter-${suffix}`
    const tenant = await createPrismaTestTenant(prismaClient, 'p8-approval-actions')

    try {
      const instance = await prismaClient.orm.public.ApprovalInstances.select('id').create({
        tenantId: tenant.id,
        module: 'contract',
        targetId: `contract-${suffix}`,
        targetName: 'Prisma approval action contract',
        nodesSnapshot: jsonValue([
          {
            nodeId: `node-${suffix}`,
            name: '审批节点',
            approverType: 'USER',
            approverIds: [approverId],
            ccUserIds: [],
            mode: 'ANY',
          },
        ]),
        submitterId,
        submitterName: 'Submitter',
        updatedAt: nowInstant(),
      })
      const task = await prismaClient.orm.public.ApprovalTasks.select('id').create({
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: `node-${suffix}`,
        nodeIndex: 0,
        nodeRound: 1,
        nodeName: '审批节点',
        approverId,
        updatedAt: nowInstant(),
      })
      const attachment = await prismaClient.orm.public.Attachments.select('id').create({
        tenantId: tenant.id,
        uploaderId: approverId,
        name: 'approval.txt',
        path: `/tmp/${suffix}/approval.txt`,
      })

      const resources = { setBizStatus: async () => undefined }
      const service = new ApprovalsService(
        { client: prismaClient } as PrismaService,
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

      const approvedTask = await prismaClient.orm.public.ApprovalTasks.where({
        id: task.id,
      }).first()
      assert.ok(approvedTask)
      assert.equal(approvedTask.status, 'APPROVED')
      assert.equal(approvedTask.action, 'APPROVE')
      assert.ok(approvedTask.handledAt)
      const firstRecords = await prismaClient.orm.public.ApprovalRecords.where({
        tenantId: tenant.id,
        instanceId: instance.id,
        taskId: task.id,
      }).all()
      assert.equal(firstRecords.length, 1)
      assert.equal(firstRecords[0]?.result, 'APPROVE')
      assert.equal(firstRecords[0]?.comment, '首次同意')
      const firstRelations = await prismaClient.orm.public.ApprovalInstanceAttachments.where({
        tenantId: tenant.id,
        instanceId: instance.id,
      }).all()
      assert.equal(firstRelations.length, 1)
      assert.equal(firstRelations[0]?.elementId, firstRecords[0]?.id)
      assert.equal(firstRelations[0]?.attachmentId, attachment.id)

      await prismaClient.orm.public.ApprovalTasks.where({ id: task.id }).update({
        status: 'PENDING',
        action: null,
        handledAt: null,
        updatedAt: nowInstant(),
      })
      await service.approveTask(
        { id: approverId, tenantId: tenant.id, name: 'Approver' } as never,
        task.id,
      )
      const reusedRecords = await prismaClient.orm.public.ApprovalRecords.where({
        tenantId: tenant.id,
        instanceId: instance.id,
        taskId: task.id,
      }).all()
      assert.equal(reusedRecords.length, 1)
      assert.equal(reusedRecords[0]?.id, firstRecords[0]?.id)
      assert.equal(reusedRecords[0]?.comment, '首次同意')
      assert.equal(
        (
          await prismaClient.orm.public.ApprovalInstanceAttachments.where({
            tenantId: tenant.id,
            instanceId: instance.id,
          })
            .select('id')
            .all()
        ).length,
        1,
      )

      await prismaClient.orm.public.ApprovalTasks.where({ id: task.id }).update({
        status: 'PENDING',
        action: null,
        handledAt: null,
        updatedAt: nowInstant(),
      })
      const peerTask = await prismaClient.orm.public.ApprovalTasks.select('id').create({
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: `node-${suffix}`,
        nodeIndex: 0,
        nodeRound: 1,
        nodeName: '审批节点',
        approverId: `peer-${suffix}`,
        updatedAt: nowInstant(),
      })
      await service.rejectTask(
        { id: approverId, tenantId: tenant.id, name: 'Approver' } as never,
        task.id,
        '  改为驳回  ',
      )

      const rejectedTask = await prismaClient.orm.public.ApprovalTasks.where({
        id: task.id,
      }).first()
      assert.ok(rejectedTask)
      assert.equal(rejectedTask.status, 'REJECTED')
      assert.equal(rejectedTask.action, 'REJECT')
      const skippedPeer = await prismaClient.orm.public.ApprovalTasks.where({
        id: peerTask.id,
      }).first()
      assert.ok(skippedPeer)
      assert.equal(skippedPeer.status, 'SKIPPED')
      const rejectedInstance = await prismaClient.orm.public.ApprovalInstances.where({
        id: instance.id,
      }).first()
      assert.ok(rejectedInstance)
      assert.equal(rejectedInstance.status, 'REJECTED')
      assert.ok(rejectedInstance.finishedAt)

      const rejectedRecords = await prismaClient.orm.public.ApprovalRecords.where({
        tenantId: tenant.id,
        instanceId: instance.id,
        taskId: task.id,
      }).all()
      assert.equal(rejectedRecords.length, 1)
      assert.notEqual(rejectedRecords[0]?.id, firstRecords[0]?.id)
      assert.equal(rejectedRecords[0]?.result, 'REJECT')
      assert.equal(rejectedRecords[0]?.comment, '改为驳回')
      assert.equal(
        (
          await prismaClient.orm.public.ApprovalInstanceAttachments.where({
            tenantId: tenant.id,
            instanceId: instance.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      await prismaClient.orm.public.ApprovalInstances.where({ tenantId: tenant.id }).deleteAll()
      await prismaClient.orm.public.Attachments.where({ tenantId: tenant.id }).deleteAll()
      await prismaClient.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
      await testDb.close()
    }
  },
)

test(
  '审批 signTask 使用 Prisma transaction 保持 BEFORE/AFTER 加签链与附件语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const tenant = await createPrismaTestTenant(prismaClient, 'p8-sign-task')
    const sourceApprover = await createPrismaTestUser(prismaClient, {
      tenantId: tenant.id,
      name: 'Source Approver',
    })
    const signApprover = await createPrismaTestUser(prismaClient, {
      tenantId: tenant.id,
      name: 'Sign Approver',
    })

    try {
      const flow = await prismaClient.orm.public.ApprovalFlows.select('id').create({
        tenantId: tenant.id,
        number: `FLOW-${suffix}`,
        formType: 'CONTRACT',
        name: 'Prisma sign flow',
        allowAddSign: true,
        updatedAt: nowInstant(),
      })
      const instance = await prismaClient.orm.public.ApprovalInstances.select('id').create({
        tenantId: tenant.id,
        flowId: flow.id,
        module: 'contract',
        targetId: `contract-${suffix}`,
        targetName: 'Prisma sign contract',
        nodesSnapshot: jsonValue([]),
        submitterId: sourceApprover.id,
        submitterName: sourceApprover.name,
        updatedAt: nowInstant(),
      })
      const beforeSource = await prismaClient.orm.public.ApprovalTasks.select('id').create({
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: `node-before-${suffix}`,
        nodeIndex: 0,
        nodeRound: 1,
        nodeName: 'Before source',
        approverId: sourceApprover.id,
        updatedAt: nowInstant(),
      })
      const afterSource = await prismaClient.orm.public.ApprovalTasks.select('id').create({
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: `node-after-${suffix}`,
        nodeIndex: 1,
        nodeRound: 1,
        nodeName: 'After source',
        approverId: sourceApprover.id,
        updatedAt: nowInstant(),
      })
      const beforeAttachment = await prismaClient.orm.public.Attachments.select('id').create({
        tenantId: tenant.id,
        uploaderId: sourceApprover.id,
        name: 'before.txt',
        path: `/tmp/${suffix}/before.txt`,
      })
      const afterAttachment = await prismaClient.orm.public.Attachments.select('id').create({
        tenantId: tenant.id,
        uploaderId: sourceApprover.id,
        name: 'after.txt',
        path: `/tmp/${suffix}/after.txt`,
      })

      const notifications: Array<Record<string, unknown>> = []
      const service = new ApprovalsService(
        { client: prismaClient } as PrismaService,
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
      const storedBeforeSource = await prismaClient.orm.public.ApprovalTasks.where({
        id: beforeSource.id,
      }).first()
      assert.ok(storedBeforeSource)
      assert.equal(storedBeforeSource.status, 'PENDING')
      assert.equal(storedBeforeSource.action, 'SIGN')
      assert.equal(storedBeforeSource.handledAt, null)
      const beforeSignTask = await prismaClient.orm.public.ApprovalTasks.where({
        id: beforeResult.id,
      }).first()
      assert.ok(beforeSignTask)
      assert.equal(beforeSignTask.taskType, 'SIGN')
      assert.equal(beforeSignTask.approverId, signApprover.id)
      assert.equal(beforeSignTask.status, 'PENDING')
      const beforeRelation = await prismaClient.orm.public.ApprovalAddSignTasks.where({
        taskId: beforeSignTask.id,
      }).first()
      assert.ok(beforeRelation)
      assert.equal(beforeRelation._type, 'BEFORE')
      assert.equal(beforeRelation.signTaskId, beforeSource.id)
      assert.equal(beforeRelation.rootTaskId, beforeSource.id)
      assert.equal(beforeRelation.comment, '前置加签')
      assert.equal(
        (
          await prismaClient.orm.public.ApprovalRecords.where({ taskId: beforeSource.id })
            .select('id')
            .all()
        ).length,
        0,
      )
      const beforeRelations = await prismaClient.orm.public.ApprovalInstanceAttachments.where({
        instanceId: instance.id,
        attachmentId: beforeAttachment.id,
      }).all()
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
      const storedAfterSource = await prismaClient.orm.public.ApprovalTasks.where({
        id: afterSource.id,
      }).first()
      assert.ok(storedAfterSource)
      assert.equal(storedAfterSource.status, 'APPROVED')
      assert.equal(storedAfterSource.action, 'APPROVE')
      assert.ok(storedAfterSource.handledAt)
      const afterSignTask = await prismaClient.orm.public.ApprovalTasks.where({
        id: afterResult.id,
      }).first()
      assert.ok(afterSignTask)
      assert.equal(afterSignTask.taskType, 'SIGN')
      assert.equal(afterSignTask.approverId, signApprover.id)
      const afterRelation = await prismaClient.orm.public.ApprovalAddSignTasks.where({
        taskId: afterSignTask.id,
      }).first()
      assert.ok(afterRelation)
      assert.equal(afterRelation._type, 'AFTER')
      assert.equal(afterRelation.signTaskId, afterSource.id)
      assert.equal(afterRelation.rootTaskId, afterSource.id)
      assert.equal(afterRelation.comment, '后置加签')
      const afterRecords = await prismaClient.orm.public.ApprovalRecords.where({
        tenantId: tenant.id,
        instanceId: instance.id,
        taskId: afterSource.id,
      }).all()
      assert.equal(afterRecords.length, 1)
      assert.equal(afterRecords[0]?.result, 'APPROVE')
      assert.equal(afterRecords[0]?.comment, '后置加签')
      const afterRelations = await prismaClient.orm.public.ApprovalInstanceAttachments.where({
        instanceId: instance.id,
        attachmentId: afterAttachment.id,
      })
        .orderBy((row) => row.elementId.asc())
        .all()
      assert.equal(afterRelations.length, 2)
      assert.deepEqual(
        new Set(afterRelations.map((relation) => relation.elementId)),
        new Set([afterRelation.id, afterRecords[0]!.id]),
      )
      assert.equal(notifications.length, 2)
    } finally {
      await prismaClient.orm.public.ApprovalInstances.where({ tenantId: tenant.id }).deleteAll()
      await prismaClient.orm.public.ApprovalFlows.where({ tenantId: tenant.id }).deleteAll()
      await prismaClient.orm.public.Attachments.where({ tenantId: tenant.id }).deleteAll()
      await prismaClient.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
      await prismaClient.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
      await testDb.close()
    }
  },
)
