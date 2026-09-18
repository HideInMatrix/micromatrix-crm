import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ApprovalsService } from './approvals.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '审批 advance 使用 Prisma 8 transaction 原子写入自动通过与下一节点任务',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const submitterId = `submitter-${suffix}`
    const approverId = `approver-${suffix}`
    const ccUserId = `cc-${suffix}`

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 approval advance ${suffix}`, slug: `p8-approval-advance-${suffix}` },
      })
      await fixtureDb.user.createMany({
        data: [
          {
            id: submitterId,
            tenantId: tenant.id,
            name: 'Submitter',
            passwordHash: 'not-used',
          },
          {
            id: approverId,
            tenantId: tenant.id,
            name: 'Approver',
            passwordHash: 'not-used',
          },
          {
            id: ccUserId,
            tenantId: tenant.id,
            name: 'CC User',
            passwordHash: 'not-used',
          },
        ],
      })
      const flow = await fixtureDb.approvalFlow.create({
        data: {
          tenantId: tenant.id,
          number: `FLOW-${suffix}`,
          formType: 'CONTRACT',
          name: 'Prisma 8 advance flow',
          duplicateApproverRule: 'EACH',
        },
      })
      const firstNodeId = `node-auto-${suffix}`
      const secondNodeId = `node-manual-${suffix}`
      const instance = await fixtureDb.approvalInstance.create({
        data: {
          tenantId: tenant.id,
          flowId: flow.id,
          module: 'contract',
          targetId: `contract-${suffix}`,
          targetName: 'Prisma 8 advance contract',
          currentNodeIndex: -1,
          nodesSnapshot: [
            {
              nodeId: firstNodeId,
              name: '提交人自动跳过',
              approverType: 'USER',
              approverIds: [submitterId],
              ccUserIds: [ccUserId],
              mode: 'ANY',
              sameSubmitterAction: 'SKIP',
            },
            {
              nodeId: secondNodeId,
              name: '人工审批',
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

      const notified: Array<{ recipients: string[]; title: string }> = []
      const service = new ApprovalsService(
        { client: prisma8Client } as Prisma8Service,
        {
          notifyMany: async (_tenantId: string, recipients: string[], message: { title: string }) => {
            notified.push({ recipients, title: message.title })
          },
        } as never,
        {} as never,
        {} as never,
        {} as never,
      )
      const internals = service as unknown as {
        advance(instanceId: string, operatorId?: string): Promise<void>
        applyNodePostFieldUpdates(): Promise<void>
      }
      internals.applyNodePostFieldUpdates = async () => undefined

      await internals.advance(instance.id, submitterId)

      const persistedInstance = await fixtureDb.approvalInstance.findUniqueOrThrow({
        where: { id: instance.id },
      })
      assert.equal(persistedInstance.currentNodeIndex, 1)

      const tasks = await fixtureDb.approvalTask.findMany({
        where: { tenantId: tenant.id, instanceId: instance.id },
        orderBy: [{ nodeIndex: 'asc' }, { taskType: 'asc' }],
      })
      const skipped = tasks.find(
        (task) => task.nodeId === firstNodeId && task.taskType === 'APPROVAL',
      )
      assert.ok(skipped)
      assert.equal(skipped.approverId, submitterId)
      assert.equal(skipped.status, 'SKIPPED')
      assert.equal(skipped.action, 'APPROVE')
      assert.ok(skipped.handledAt instanceof Date)

      const ccTask = tasks.find((task) => task.nodeId === firstNodeId && task.taskType === 'CC')
      assert.ok(ccTask)
      assert.equal(ccTask.approverId, ccUserId)
      assert.equal(ccTask.status, 'PENDING')

      const pending = tasks.find(
        (task) => task.nodeId === secondNodeId && task.taskType === 'APPROVAL',
      )
      assert.ok(pending)
      assert.equal(pending.approverId, approverId)
      assert.equal(pending.status, 'PENDING')

      const records = await fixtureDb.approvalRecord.findMany({
        where: { tenantId: tenant.id, instanceId: instance.id, nodeId: firstNodeId },
      })
      assert.equal(records.length, 1)
      assert.equal(records[0]?.taskId, skipped.id)
      assert.equal(records[0]?.result, 'APPROVE')
      assert.match(records[0]?.comment ?? '', /同一人|自动通过/)
      assert.deepEqual(
        notified.map((item) => item.recipients),
        [[ccUserId], [approverId]],
      )
    } finally {
      const tenant = await fixtureDb.tenant.findUnique({
        where: { slug: `p8-approval-advance-${suffix}` },
        select: { id: true },
      })
      if (tenant) {
        await fixtureDb.approvalInstance.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.approvalFlow.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.tenant.delete({ where: { id: tenant.id } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
