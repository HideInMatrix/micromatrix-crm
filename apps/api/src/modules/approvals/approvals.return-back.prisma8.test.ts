import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampFromDate } from '../../prisma/prisma8-temporal'
import { jsonValue } from '../../prisma/json-value'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { ApprovalsService } from './approvals.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '审批 returnBackTask 使用 Prisma 8 transaction 原子重建目标节点并替换退回记录',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    const tenant = await createPrismaTestTenant(prisma8Client, 'p8-return-back')
    const submitter = await createPrismaTestUser(prisma8Client, {
      tenantId: tenant.id,
      name: 'Submitter',
    })
    const sourceApprover = await createPrismaTestUser(prisma8Client, {
      tenantId: tenant.id,
      name: 'Source Approver',
    })
    const targetApprover = await createPrismaTestUser(prisma8Client, {
      tenantId: tenant.id,
      name: 'Target Approver',
    })
    const ccUser = await createPrismaTestUser(prisma8Client, {
      tenantId: tenant.id,
      name: 'CC User',
    })

    const targetNodeId = `node-target-${suffix}`
    const sourceNodeId = `node-source-${suffix}`

    try {
      const instance = await prisma8Client.orm.public.ApprovalInstances.select('id').create({
        tenantId: tenant.id,
        module: 'contract',
        targetId: `contract-${suffix}`,
        targetName: 'Prisma 8 return back contract',
        currentNodeIndex: 1,
        nodesSnapshot: jsonValue([
          {
            nodeId: targetNodeId,
            name: '历史审批节点',
            approverType: 'USER',
            approverIds: [targetApprover.id],
            ccUserIds: [ccUser.id],
            mode: 'ANY',
          },
          {
            nodeId: sourceNodeId,
            name: '当前审批节点',
            approverType: 'USER',
            approverIds: [sourceApprover.id],
            ccUserIds: [],
            mode: 'ANY',
          },
        ]),
        submitterId: submitter.id,
        submitterName: submitter.name,
        updatedAt: prisma8Now(),
      })

      const historicalTask = await prisma8Client.orm.public.ApprovalTasks.select('id').create({
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: targetNodeId,
        nodeIndex: 0,
        nodeRound: 1,
        nodeName: '历史审批节点',
        approverId: targetApprover.id,
        status: 'APPROVED',
        action: 'APPROVE',
        handledAt: prisma8TimestampFromDate(new Date(Date.now() - 120_000)),
        updatedAt: prisma8Now(),
      })
      await prisma8Client.orm.public.ApprovalRecords.create({
        tenantId: tenant.id,
        instanceId: instance.id,
        taskId: historicalTask.id,
        nodeId: targetNodeId,
        nodeRound: 1,
        result: 'APPROVE',
        comment: '历史审批已通过',
        createdById: targetApprover.id,
        updatedAt: prisma8Now(),
      })

      const sourceTask = await prisma8Client.orm.public.ApprovalTasks.select('id').create({
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: sourceNodeId,
        nodeIndex: 1,
        nodeRound: 1,
        nodeName: '当前审批节点',
        approverId: sourceApprover.id,
        updatedAt: prisma8Now(),
      })
      const peerTask = await prisma8Client.orm.public.ApprovalTasks.select('id').create({
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: sourceNodeId,
        nodeIndex: 1,
        nodeRound: 1,
        nodeName: '当前审批节点',
        approverId: `peer-${suffix}`,
        updatedAt: prisma8Now(),
      })

      const oldAttachment = await prisma8Client.orm.public.Attachments.select('id').create({
        tenantId: tenant.id,
        uploaderId: sourceApprover.id,
        name: 'old-return.txt',
        path: `/tmp/${suffix}/old-return.txt`,
      })
      const newAttachment = await prisma8Client.orm.public.Attachments.select('id').create({
        tenantId: tenant.id,
        uploaderId: sourceApprover.id,
        name: 'new-return.txt',
        path: `/tmp/${suffix}/new-return.txt`,
      })

      const oldReturn = await prisma8Client.orm.public.ApprovalReturnBackRecords.select(
        'id',
      ).create({
        tenantId: tenant.id,
        instanceId: instance.id,
        taskId: sourceTask.id,
        returnToNodeId: targetNodeId,
        returnReason: '旧退回原因',
        returnUserId: sourceApprover.id,
        updatedAt: prisma8Now(),
      })
      await prisma8Client.orm.public.ApprovalInstanceAttachments.create({
        tenantId: tenant.id,
        instanceId: instance.id,
        elementId: oldReturn.id,
        attachmentId: oldAttachment.id,
      })

      const notifications: string[][] = []
      const service = new ApprovalsService(
        { client: prisma8Client } as Prisma8Service,
        {
          notifyMany: async (_tenantId: string, userIds: string[]) => {
            notifications.push(userIds)
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
      )

      const result = await service.returnBackTask(
        { id: sourceApprover.id, tenantId: tenant.id, name: sourceApprover.name } as never,
        sourceTask.id,
        {
          returnToNodeId: targetNodeId,
          comment: '  重新补充资料  ',
          attachmentIds: [newAttachment.id],
        },
      )
      assert.equal(result.returnToNodeId, targetNodeId)
      assert.equal(result.nodeRound, 2)

      const storedSource = await prisma8Client.orm.public.ApprovalTasks.where({
        id: sourceTask.id,
      }).first()
      assert.ok(storedSource)
      assert.equal(storedSource.status, 'PENDING')
      assert.equal(storedSource.action, 'BACK')
      assert.ok(storedSource.handledAt)

      const storedPeer = await prisma8Client.orm.public.ApprovalTasks.where({
        id: peerTask.id,
      }).first()
      assert.ok(storedPeer)
      assert.equal(storedPeer.status, 'SKIPPED')

      const newTargetTasks = await prisma8Client.orm.public.ApprovalTasks.where({
        instanceId: instance.id,
        nodeId: targetNodeId,
        nodeRound: 2,
      }).all()
      assert.equal(newTargetTasks.length, 2)
      assert.ok(
        newTargetTasks.some(
          (task) => task.taskType === 'APPROVAL' && task.approverId === targetApprover.id,
        ),
      )
      assert.ok(
        newTargetTasks.some((task) => task.taskType === 'CC' && task.approverId === ccUser.id),
      )

      const storedInstance = await prisma8Client.orm.public.ApprovalInstances.where({
        id: instance.id,
      }).first()
      assert.ok(storedInstance)
      assert.equal(storedInstance.currentNodeIndex, 0)

      const returnRecords = await prisma8Client.orm.public.ApprovalReturnBackRecords.where({
        tenantId: tenant.id,
        instanceId: instance.id,
        returnToNodeId: targetNodeId,
      }).all()
      assert.equal(returnRecords.length, 1)
      assert.notEqual(returnRecords[0]?.id, oldReturn.id)
      assert.equal(returnRecords[0]?.returnReason, '重新补充资料')

      const oldRelations = await prisma8Client.orm.public.ApprovalInstanceAttachments.where({
        instanceId: instance.id,
        elementId: oldReturn.id,
      }).all()
      assert.equal(oldRelations.length, 0)

      const newRelations = await prisma8Client.orm.public.ApprovalInstanceAttachments.where({
        instanceId: instance.id,
        elementId: returnRecords[0]!.id,
      }).all()
      assert.equal(newRelations.length, 1)
      assert.equal(newRelations[0]?.attachmentId, newAttachment.id)
      assert.deepEqual(notifications, [[targetApprover.id], [ccUser.id]])
    } finally {
      await prisma8Client.orm.public.ApprovalInstances.where({ tenantId: tenant.id }).deleteAll()
      await prisma8Client.orm.public.Attachments.where({ tenantId: tenant.id }).deleteAll()
      await prisma8Client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
      await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
      await testDb.close()
    }
  },
)
