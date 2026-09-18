import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { decimalString, numericValue } from '../../prisma/numeric-value'
import { createLegacyId32 } from '../../common/legacy-id'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { ApprovalResourceInstance } from './approval-runtime.types'
import { ApprovalResourceService } from './approval-resource.service'

const id32 = () => randomUUID().replaceAll('-', '')

test('ApprovalResource production 状态/删除路径使用 Prisma 8 并同步业务快照', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-approval-resource')
  const actorId = id32()
  const customerId = createLegacyId32()
  const contractId = createLegacyId32()
  const snapshotId = createLegacyId32()
  const organizationId = tenant.id
  const now = BigInt(Date.now())

  try {
    await prisma8Client.orm.public.Customer.create({
      id: customerId,
      name: '审批资源客户',
      owner: actorId,
      organizationId,
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
    })
    await prisma8Client.orm.public.Contract.create({
      id: contractId,
      name: 'Prisma 8 审批合同',
      customerId,
      owner: actorId,
      amount: numericValue(decimalString(321.45, 14, 2), 14, 2),
      number: `APR-${suffix}`.slice(0, 50),
      approvalStatus: 'NONE',
      stage: 'AFOOT',
      organizationId,
      createTime: now,
      updateTime: now,
      createUser: actorId,
      updateUser: actorId,
    })
    await prisma8Client.orm.public.ContractSnapshot.create({
      id: snapshotId,
      contractId,
      contractProp: 'approval',
      contractValue: JSON.stringify({ approvalStatus: 'NONE', approved: false }),
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
    let contract = await prisma8Client.orm.public.Contract.where({ id: contractId }).first()
    assert.ok(contract)
    assert.equal(contract.approvalStatus, 'APPROVING')
    assert.equal(contract.approved, false)
    let snapshot = await prisma8Client.orm.public.ContractSnapshot.where({ id: snapshotId }).first()
    assert.ok(snapshot)
    assert.deepEqual(JSON.parse(snapshot.contractValue ?? '{}'), {
      approvalStatus: 'APPROVING',
      approved: false,
    })

    await service.setBizStatus(tenant.id, 'contract', contractId, 'APPROVED')
    contract = await prisma8Client.orm.public.Contract.where({ id: contractId }).first()
    assert.ok(contract)
    assert.equal(contract.approvalStatus, 'APPROVED')
    assert.equal(contract.approved, true)
    snapshot = await prisma8Client.orm.public.ContractSnapshot.where({ id: snapshotId }).first()
    assert.ok(snapshot)
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
    assert.equal(
      (await prisma8Client.orm.public.Contract.where({ id: contractId }).select('id').all()).length,
      0,
    )
    assert.equal(
      (await prisma8Client.orm.public.ContractSnapshot.where({ contractId }).select('id').all())
        .length,
      0,
    )
  } finally {
    await prisma8Client.orm.public.Contract.where({ organizationId }).deleteAll()
    await prisma8Client.orm.public.Customer.where({ organizationId }).deleteAll()
    await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
