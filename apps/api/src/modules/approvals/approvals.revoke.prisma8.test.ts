import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampFromDate } from '../../prisma/prisma8-temporal'
import { jsonValue } from '../../prisma/json-value'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { ApprovalsService } from './approvals.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '审批 revokeTask 使用 Prisma 8 transaction 原子恢复源 task 并失效下游 PENDING task',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `tenant-${suffix}`
    const approverId = `approver-${suffix}`

    try {
      const flow = await prisma8Client.orm.public.ApprovalFlows.select('id').create({
        tenantId,
        number: `AF-${suffix}`,
        formType: 'CONTRACT',
        name: 'Prisma 8 withdraw flow',
        allowWithdraw: true,
        updatedAt: prisma8Now(),
      })
      const sourceNodeId = `source-${suffix}`
      const currentNodeId = `current-${suffix}`
      const instance = await prisma8Client.orm.public.ApprovalInstances.select(
        'id',
        'targetName',
        'updatedAt',
      ).create({
        tenantId,
        flowId: flow.id,
        module: 'contract',
        targetId: `contract-${suffix}`,
        targetName: 'Prisma 8 withdraw contract',
        currentNodeIndex: 1,
        nodesSnapshot: jsonValue([
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
        ]),
        submitterId: `submitter-${suffix}`,
        submitterName: 'Submitter',
        updatedAt: prisma8Now(),
      })
      const sourceTask = await prisma8Client.orm.public.ApprovalTasks.select(
        'id',
        'updatedAt',
      ).create({
        tenantId,
        instanceId: instance.id,
        nodeId: sourceNodeId,
        nodeIndex: 0,
        nodeName: 'Source approver',
        approverId,
        status: 'APPROVED',
        action: 'APPROVE',
        handledAt: prisma8TimestampFromDate(new Date(Date.now() - 60_000)),
        updatedAt: prisma8Now(),
      })
      const downstreamTask = await prisma8Client.orm.public.ApprovalTasks.select('id').create({
        tenantId,
        instanceId: instance.id,
        nodeId: currentNodeId,
        nodeIndex: 1,
        nodeName: 'Current approver',
        approverId: `next-${suffix}`,
        updatedAt: prisma8Now(),
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

      const storedSource = await prisma8Client.orm.public.ApprovalTasks.where({
        id: sourceTask.id,
      }).first()
      assert.ok(storedSource)
      assert.equal(storedSource.status, 'PENDING')
      assert.equal(storedSource.action, null)
      assert.equal(storedSource.handledAt, null)
      assert.ok(storedSource.updatedAt.epochMilliseconds >= sourceTask.updatedAt.epochMilliseconds)

      const storedDownstream = await prisma8Client.orm.public.ApprovalTasks.where({
        id: downstreamTask.id,
      }).first()
      assert.ok(storedDownstream)
      assert.equal(storedDownstream.status, 'SKIPPED')

      const storedInstance = await prisma8Client.orm.public.ApprovalInstances.where({
        id: instance.id,
      }).first()
      assert.ok(storedInstance)
      assert.equal(storedInstance.status, 'PENDING')
      assert.equal(storedInstance.currentNodeIndex, 0)
      assert.ok(storedInstance.updatedAt.epochMilliseconds >= instance.updatedAt.epochMilliseconds)

      await assert.rejects(
        () =>
          service.revokeTask(
            { id: approverId, tenantId, name: 'Approver' } as never,
            sourceTask.id,
          ),
        /可撤回的已办任务不存在/,
      )
    } finally {
      await prisma8Client.orm.public.ApprovalInstances.where({ tenantId }).deleteAll()
      await prisma8Client.orm.public.ApprovalFlows.where({ tenantId }).deleteAll()
      await testDb.close()
    }
  },
)
