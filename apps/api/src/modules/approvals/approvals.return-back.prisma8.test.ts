import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ApprovalsService } from './approvals.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '审批 returnBackTask 使用 Prisma 8 transaction 原子重建目标节点并替换退回记录',
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
        data: { name: `Prisma8 return back ${suffix}`, slug: `p8-return-back-${suffix}` },
      })
      const submitter = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'Submitter', passwordHash: 'not-used' },
      })
      const sourceApprover = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'Source Approver', passwordHash: 'not-used' },
      })
      const targetApprover = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'Target Approver', passwordHash: 'not-used' },
      })
      const ccUser = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'CC User', passwordHash: 'not-used' },
      })
      const targetNodeId = `node-target-${suffix}`
      const sourceNodeId = `node-source-${suffix}`
      const instance = await fixtureDb.approvalInstance.create({
        data: {
          tenantId: tenant.id,
          module: 'contract',
          targetId: `contract-${suffix}`,
          targetName: 'Prisma 8 return back contract',
          currentNodeIndex: 1,
          nodesSnapshot: [
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
          ],
          submitterId: submitter.id,
          submitterName: submitter.name,
        },
      })
      const historicalTask = await fixtureDb.approvalTask.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          nodeId: targetNodeId,
          nodeIndex: 0,
          nodeRound: 1,
          nodeName: '历史审批节点',
          approverId: targetApprover.id,
          status: 'APPROVED',
          action: 'APPROVE',
          handledAt: new Date(Date.now() - 120_000),
        },
      })
      await fixtureDb.approvalRecord.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          taskId: historicalTask.id,
          nodeId: targetNodeId,
          nodeRound: 1,
          result: 'APPROVE',
          comment: '历史审批已通过',
          createdById: targetApprover.id,
        },
      })
      const sourceTask = await fixtureDb.approvalTask.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          nodeId: sourceNodeId,
          nodeIndex: 1,
          nodeRound: 1,
          nodeName: '当前审批节点',
          approverId: sourceApprover.id,
        },
      })
      const peerTask = await fixtureDb.approvalTask.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          nodeId: sourceNodeId,
          nodeIndex: 1,
          nodeRound: 1,
          nodeName: '当前审批节点',
          approverId: `peer-${suffix}`,
        },
      })
      const oldAttachment = await fixtureDb.attachment.create({
        data: {
          tenantId: tenant.id,
          uploaderId: sourceApprover.id,
          name: 'old-return.txt',
          path: `/tmp/${suffix}/old-return.txt`,
        },
      })
      const newAttachment = await fixtureDb.attachment.create({
        data: {
          tenantId: tenant.id,
          uploaderId: sourceApprover.id,
          name: 'new-return.txt',
          path: `/tmp/${suffix}/new-return.txt`,
        },
      })
      const oldReturn = await fixtureDb.approvalReturnBackRecord.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          taskId: sourceTask.id,
          returnToNodeId: targetNodeId,
          returnReason: '旧退回原因',
          returnUserId: sourceApprover.id,
        },
      })
      await fixtureDb.approvalInstanceAttachment.create({
        data: {
          tenantId: tenant.id,
          instanceId: instance.id,
          elementId: oldReturn.id,
          attachmentId: oldAttachment.id,
        },
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

      const storedSource = await fixtureDb.approvalTask.findUniqueOrThrow({ where: { id: sourceTask.id } })
      assert.equal(storedSource.status, 'PENDING')
      assert.equal(storedSource.action, 'BACK')
      assert.ok(storedSource.handledAt instanceof Date)
      assert.equal(
        (await fixtureDb.approvalTask.findUniqueOrThrow({ where: { id: peerTask.id } })).status,
        'SKIPPED',
      )

      const newTargetTasks = await fixtureDb.approvalTask.findMany({
        where: { instanceId: instance.id, nodeId: targetNodeId, nodeRound: 2 },
      })
      assert.equal(newTargetTasks.length, 2)
      assert.ok(newTargetTasks.some((task) => task.taskType === 'APPROVAL' && task.approverId === targetApprover.id))
      assert.ok(newTargetTasks.some((task) => task.taskType === 'CC' && task.approverId === ccUser.id))
      assert.equal(
        (await fixtureDb.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } })).currentNodeIndex,
        0,
      )

      const returnRecords = await fixtureDb.approvalReturnBackRecord.findMany({
        where: { tenantId: tenant.id, instanceId: instance.id, returnToNodeId: targetNodeId },
      })
      assert.equal(returnRecords.length, 1)
      assert.notEqual(returnRecords[0]?.id, oldReturn.id)
      assert.equal(returnRecords[0]?.returnReason, '重新补充资料')
      assert.equal(
        await fixtureDb.approvalInstanceAttachment.count({
          where: { instanceId: instance.id, elementId: oldReturn.id },
        }),
        0,
      )
      const newRelations = await fixtureDb.approvalInstanceAttachment.findMany({
        where: { instanceId: instance.id, elementId: returnRecords[0]!.id },
      })
      assert.equal(newRelations.length, 1)
      assert.equal(newRelations[0]?.attachmentId, newAttachment.id)
      assert.deepEqual(notifications, [[targetApprover.id], [ccUser.id]])
    } finally {
      const tenant = await fixtureDb.tenant.findUnique({
        where: { slug: `p8-return-back-${suffix}` },
        select: { id: true },
      })
      if (tenant) {
        await fixtureDb.approvalInstance.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.attachment.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.tenant.delete({ where: { id: tenant.id } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
