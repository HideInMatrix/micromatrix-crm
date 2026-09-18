import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ApprovalsService } from './approvals.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '审批 revokeTask 使用 Prisma 8 transaction 原子恢复源 task 并失效下游 PENDING task',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `tenant-${suffix}`
    const approverId = `approver-${suffix}`

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const flow = await fixtureDb.approvalFlow.create({
        data: {
          tenantId,
          number: `AF-${suffix}`,
          formType: 'CONTRACT',
          name: 'Prisma 8 withdraw flow',
          allowWithdraw: true,
        },
      })
      const sourceNodeId = `source-${suffix}`
      const currentNodeId = `current-${suffix}`
      const instance = await fixtureDb.approvalInstance.create({
        data: {
          tenantId,
          flowId: flow.id,
          module: 'contract',
          targetId: `contract-${suffix}`,
          targetName: 'Prisma 8 withdraw contract',
          currentNodeIndex: 1,
          nodesSnapshot: [
            {
              nodeId: sourceNodeId,
              name: 'Source approver',
              approverType: 'USER',
              approverIds: [approverId],
              mode: 'ANY',
            },
            {
              nodeId: currentNodeId,
              name: 'Current approver',
              approverType: 'USER',
              approverIds: [`next-${suffix}`],
              mode: 'ANY',
            },
          ],
          submitterId: `submitter-${suffix}`,
          submitterName: 'Submitter',
        },
      })
      const sourceTask = await fixtureDb.approvalTask.create({
        data: {
          tenantId,
          instanceId: instance.id,
          nodeId: sourceNodeId,
          nodeIndex: 0,
          nodeName: 'Source approver',
          approverId,
          status: 'APPROVED',
          action: 'APPROVE',
          handledAt: new Date(Date.now() - 60_000),
        },
      })
      const downstreamTask = await fixtureDb.approvalTask.create({
        data: {
          tenantId,
          instanceId: instance.id,
          nodeId: currentNodeId,
          nodeIndex: 1,
          nodeName: 'Current approver',
          approverId: `next-${suffix}`,
        },
      })

      const service = new ApprovalsService(
        { client: prisma8Client } as Prisma8Service,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      )
      const result = await service.revokeTask(
        { id: approverId, tenantId, name: 'Approver' } as never,
        sourceTask.id,
      )
      assert.deepEqual(result, {
        id: sourceTask.id,
        name: instance.targetName,
        nodeId: sourceNodeId,
        nodeRound: 1,
      })

      const storedSource = await fixtureDb.approvalTask.findUniqueOrThrow({
        where: { id: sourceTask.id },
      })
      assert.equal(storedSource.status, 'PENDING')
      assert.equal(storedSource.action, null)
      assert.equal(storedSource.handledAt, null)
      assert.ok(storedSource.updatedAt.getTime() >= sourceTask.updatedAt.getTime())

      const storedDownstream = await fixtureDb.approvalTask.findUniqueOrThrow({
        where: { id: downstreamTask.id },
      })
      assert.equal(storedDownstream.status, 'SKIPPED')

      const storedInstance = await fixtureDb.approvalInstance.findUniqueOrThrow({
        where: { id: instance.id },
      })
      assert.equal(storedInstance.status, 'PENDING')
      assert.equal(storedInstance.currentNodeIndex, 0)
      assert.ok(storedInstance.updatedAt.getTime() >= instance.updatedAt.getTime())

      await assert.rejects(
        () =>
          service.revokeTask(
            { id: approverId, tenantId, name: 'Approver' } as never,
            sourceTask.id,
          ),
        /可撤回的已办任务不存在/,
      )
    } finally {
      await fixtureDb.approvalInstance.deleteMany({ where: { tenantId } })
      await fixtureDb.approvalFlow.deleteMany({ where: { tenantId } })
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
