import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { prisma8JsonValue } from '../../prisma/prisma8-values'
import {
  createPrismaTestTenant,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { ApprovalsService } from './approvals.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '审批 advance 使用 Prisma 8 transaction 原子写入自动通过与下一节点任务',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const submitterId = `submitter-${suffix}`
    const approverId = `approver-${suffix}`
    const ccUserId = `cc-${suffix}`

    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-approval-advance')
      await prisma8Client.orm.public.Users.createAll([
        {
          id: submitterId,
          tenantId: tenant.id,
          name: 'Submitter',
          passwordHash: 'not-used',
          updatedAt: prisma8Now(),
        },
        {
          id: approverId,
          tenantId: tenant.id,
          name: 'Approver',
          passwordHash: 'not-used',
          updatedAt: prisma8Now(),
        },
        {
          id: ccUserId,
          tenantId: tenant.id,
          name: 'CC User',
          passwordHash: 'not-used',
          updatedAt: prisma8Now(),
        },
      ])
      const flow = await prisma8Client.orm.public.ApprovalFlows
        .select('id')
        .create({
          tenantId: tenant.id,
          number: `FLOW-${suffix}`,
          formType: 'CONTRACT',
          name: 'Prisma 8 advance flow',
          duplicateApproverRule: 'EACH',
          updatedAt: prisma8Now(),
      })
      const firstNodeId = `node-auto-${suffix}`
      const secondNodeId = `node-manual-${suffix}`
      const instance = await prisma8Client.orm.public.ApprovalInstances
        .select('id')
        .create({
          tenantId: tenant.id,
          flowId: flow.id,
          module: 'contract',
          targetId: `contract-${suffix}`,
          targetName: 'Prisma 8 advance contract',
          currentNodeIndex: -1,
          nodesSnapshot: prisma8JsonValue([
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
          ]),
          submitterId,
          submitterName: 'Submitter',
          updatedAt: prisma8Now(),
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

      const persistedInstance = await prisma8Client.orm.public.ApprovalInstances.where({
        id: instance.id,
      }).first()
      assert.ok(persistedInstance)
      assert.equal(persistedInstance.currentNodeIndex, 1)

      const tasks = await prisma8Client.orm.public.ApprovalTasks.where({
        tenantId: tenant.id,
        instanceId: instance.id,
      })
        .orderBy((row) => row.nodeIndex.asc())
        .orderBy((row) => row.taskType.asc())
        .all()
      const skipped = tasks.find(
        (task) => task.nodeId === firstNodeId && task.taskType === 'APPROVAL',
      )
      assert.ok(skipped)
      assert.equal(skipped.approverId, submitterId)
      assert.equal(skipped.status, 'SKIPPED')
      assert.equal(skipped.action, 'APPROVE')
      assert.ok(skipped.handledAt)

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

      const records = await prisma8Client.orm.public.ApprovalRecords.where({
        tenantId: tenant.id,
        instanceId: instance.id,
        nodeId: firstNodeId,
      }).all()
      assert.equal(records.length, 1)
      assert.equal(records[0]?.taskId, skipped.id)
      assert.equal(records[0]?.result, 'APPROVE')
      assert.match(records[0]?.comment ?? '', /同一人|自动通过/)
      assert.deepEqual(
        notified.map((item) => item.recipients),
        [[ccUserId], [approverId]],
      )
    } finally {
      const tenant = await prisma8Client.orm.public.Tenants.where({
        slug: `p8-approval-advance-${suffix}`,
      })
        .select('id')
        .first()
      if (tenant) {
        await prisma8Client.orm.public.ApprovalInstances.where({ tenantId: tenant.id }).deleteAll()
        await prisma8Client.orm.public.ApprovalFlows.where({ tenantId: tenant.id }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
      }
      await testDb.close()
    }
  },
)
