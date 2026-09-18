import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import { Prisma8Service } from '../../prisma/prisma8.service'
import type { ApprovalResourceInstance } from './approval-runtime.types'
import { ApprovalResourceService } from './approval-resource.service'

const id32 = () => randomUUID().replaceAll('-', '')

test('ApprovalResource production 状态/删除路径使用 Prisma 8 并同步业务快照', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-approval-resource-${suffix}`, slug: `p8-approval-resource-${suffix}` },
  })
  const actorId = id32()
  const customerId = id32()
  const contractId = id32()
  const snapshotId = id32()
  const now = BigInt(Date.now())

  try {
    await fixtureDb.customer.create({
      data: {
        id: customerId,
        name: '审批资源客户',
        owner: actorId,
        organizationId: tenant.id,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      },
    })
    await fixtureDb.contract.create({
      data: {
        id: contractId,
        name: 'Prisma 8 审批合同',
        customerId,
        owner: actorId,
        amount: 321.45,
        number: `APR-${suffix}`.slice(0, 50),
        approvalStatus: 'NONE',
        stage: 'AFOOT',
        organizationId: tenant.id,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      },
    })
    await fixtureDb.contractSnapshot.create({
      data: {
        id: snapshotId,
        contractId,
        contractProp: 'approval',
        contractValue: JSON.stringify({ approvalStatus: 'NONE', approved: false }),
      },
    })

    const service = new ApprovalResourceService(
      prisma8,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )

    assert.deepEqual(await service.targetInfo(tenant.id, 'contract', contractId), {
      name: '合同 Prisma 8 审批合同',
      amount: 321.45,
      approvalStatus: 'NONE',
    })

    await service.setBizStatus(tenant.id, 'contract', contractId, 'PENDING')
    let contract = await fixtureDb.contract.findUniqueOrThrow({ where: { id: contractId } })
    assert.equal(contract.approvalStatus, 'APPROVING')
    assert.equal(contract.approved, false)
    let snapshot = await fixtureDb.contractSnapshot.findUniqueOrThrow({ where: { id: snapshotId } })
    assert.deepEqual(JSON.parse(snapshot.contractValue ?? '{}'), {
      approvalStatus: 'APPROVING',
      approved: false,
    })

    await service.setBizStatus(tenant.id, 'contract', contractId, 'APPROVED')
    contract = await fixtureDb.contract.findUniqueOrThrow({ where: { id: contractId } })
    assert.equal(contract.approvalStatus, 'APPROVED')
    assert.equal(contract.approved, true)
    snapshot = await fixtureDb.contractSnapshot.findUniqueOrThrow({ where: { id: snapshotId } })
    assert.deepEqual(JSON.parse(snapshot.contractValue ?? '{}'), {
      approvalStatus: 'APPROVED',
      approved: true,
    })

    await service.effectApproved({
      id: `instance-${suffix}`,
      tenantId: tenant.id,
      module: 'contract',
      targetId: contractId,
      executeTiming: 'DELETE',
    } as ApprovalResourceInstance)
    assert.equal(await fixtureDb.contract.count({ where: { id: contractId } }), 0)
    assert.equal(await fixtureDb.contractSnapshot.count({ where: { contractId } }), 0)
  } finally {
    await fixtureDb.contract.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.customer.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.tenant.delete({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
