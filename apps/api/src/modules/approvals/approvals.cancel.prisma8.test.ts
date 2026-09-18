import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ApprovalsService } from './approvals.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '审批 cancel 使用 Prisma 8 transaction 原子跳过 PENDING task 并取消 instance',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `tenant-${suffix}`
    const submitterId = `submitter-${suffix}`
    const resourceCalls: Array<{ action: string; status?: string }> = []

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const instance = await fixtureDb.approvalInstance.create({
        data: {
          tenantId,
          module: 'contract',
          targetId: `contract-${suffix}`,
          targetName: 'Prisma 8 cancel contract',
          nodesSnapshot: [],
          submitterId,
          submitterName: 'Submitter',
        },
      })
      const pendingA = randomUUID()
      const pendingB = randomUUID()
      const approved = randomUUID()
      await fixtureDb.approvalTask.createMany({
        data: [
          {
            id: pendingA,
            tenantId,
            instanceId: instance.id,
            nodeIndex: 0,
            nodeName: 'First approver',
            approverId: `approver-a-${suffix}`,
          },
          {
            id: pendingB,
            tenantId,
            instanceId: instance.id,
            nodeIndex: 0,
            nodeName: 'Second approver',
            approverId: `approver-b-${suffix}`,
          },
          {
            id: approved,
            tenantId,
            instanceId: instance.id,
            nodeIndex: 0,
            nodeName: 'Historical approver',
            approverId: `approver-old-${suffix}`,
            status: 'APPROVED',
            action: 'APPROVE',
            handledAt: new Date(Date.now() - 60_000),
          },
        ],
      })

      const resources = {
        setBizStatus: async (
          _tenantId: string,
          _module: string,
          _targetId: string,
          status: string,
        ) => {
          resourceCalls.push({ action: 'setBizStatus', status })
        },
        restore: async () => {
          resourceCalls.push({ action: 'restore' })
        },
      }
      const service = new ApprovalsService(
        { client: prisma8Client } as Prisma8Service,
        {} as never,
        {} as never,
        resources as never,
        {} as never,
      )

      const result = await service.cancel(
        { id: submitterId, tenantId, name: 'Submitter' } as never,
        instance.id,
      )
      assert.deepEqual(result, { id: instance.id, name: 'Prisma 8 cancel contract' })

      const storedInstance = await fixtureDb.approvalInstance.findUniqueOrThrow({
        where: { id: instance.id },
      })
      assert.equal(storedInstance.status, 'CANCELED')
      assert.ok(storedInstance.finishedAt instanceof Date)
      assert.ok(storedInstance.updatedAt.getTime() >= instance.updatedAt.getTime())

      const tasks = await fixtureDb.approvalTask.findMany({
        where: { instanceId: instance.id },
        orderBy: { id: 'asc' },
      })
      const byId = new Map(tasks.map((task) => [task.id, task]))
      assert.equal(byId.get(pendingA)?.status, 'SKIPPED')
      assert.equal(byId.get(pendingB)?.status, 'SKIPPED')
      assert.equal(byId.get(approved)?.status, 'APPROVED')
      assert.equal(byId.get(approved)?.action, 'APPROVE')
      assert.ok(byId.get(approved)?.handledAt instanceof Date)
      assert.deepEqual(resourceCalls, [
        { action: 'setBizStatus', status: 'REVOKED' },
        { action: 'restore' },
      ])
    } finally {
      await fixtureDb.approvalInstance.deleteMany({ where: { tenantId } })
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
