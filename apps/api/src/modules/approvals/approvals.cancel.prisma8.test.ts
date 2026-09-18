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
  '审批 cancel 使用 Prisma 8 transaction 原子跳过 PENDING task 并取消 instance',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `tenant-${suffix}`
    const submitterId = `submitter-${suffix}`
    const resourceCalls: Array<{ action: string; status?: string }> = []

    try {
      const instance = await prisma8Client.orm.public.ApprovalInstances.select(
        'id',
        'updatedAt',
      ).create({
        tenantId,
        module: 'contract',
        targetId: `contract-${suffix}`,
        targetName: 'Prisma 8 cancel contract',
        nodesSnapshot: jsonValue([]),
        submitterId,
        submitterName: 'Submitter',
        updatedAt: prisma8Now(),
      })
      const pendingA = randomUUID()
      const pendingB = randomUUID()
      const approved = randomUUID()
      await prisma8Client.orm.public.ApprovalTasks.createAll([
        {
          id: pendingA,
          tenantId,
          instanceId: instance.id,
          nodeIndex: 0,
          nodeName: 'First approver',
          approverId: `approver-a-${suffix}`,
          updatedAt: prisma8Now(),
        },
        {
          id: pendingB,
          tenantId,
          instanceId: instance.id,
          nodeIndex: 0,
          nodeName: 'Second approver',
          approverId: `approver-b-${suffix}`,
          updatedAt: prisma8Now(),
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
          handledAt: prisma8TimestampFromDate(new Date(Date.now() - 60_000)),
          updatedAt: prisma8Now(),
        },
      ])

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

      const storedInstance = await prisma8Client.orm.public.ApprovalInstances.where({
        id: instance.id,
      }).first()
      assert.ok(storedInstance)
      assert.equal(storedInstance.status, 'CANCELED')
      assert.ok(storedInstance.finishedAt)
      assert.ok(storedInstance.updatedAt.epochMilliseconds >= instance.updatedAt.epochMilliseconds)

      const tasks = await prisma8Client.orm.public.ApprovalTasks.where({
        instanceId: instance.id,
      })
        .orderBy((row) => row.id.asc())
        .all()
      const byId = new Map(tasks.map((task) => [task.id, task]))
      assert.equal(byId.get(pendingA)?.status, 'SKIPPED')
      assert.equal(byId.get(pendingB)?.status, 'SKIPPED')
      assert.equal(byId.get(approved)?.status, 'APPROVED')
      assert.equal(byId.get(approved)?.action, 'APPROVE')
      assert.ok(byId.get(approved)?.handledAt)
      assert.deepEqual(resourceCalls, [
        { action: 'setBizStatus', status: 'REVOKED' },
        { action: 'restore' },
      ])
    } finally {
      await prisma8Client.orm.public.ApprovalInstances.where({ tenantId }).deleteAll()
      await testDb.close()
    }
  },
)
