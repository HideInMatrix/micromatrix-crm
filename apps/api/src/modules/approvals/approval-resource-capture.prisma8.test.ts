import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { ApprovalResourceCaptureService } from './approval-resource-capture.service'

const id32 = () => randomUUID().replaceAll('-', '')

test('ApprovalResourceCapture 使用 Prisma 8 保持 Contract JSON 快照与租户隔离', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-capture-${suffix}`, slug: `p8-capture-${suffix}` },
  })
  const otherTenant = await fixtureDb.tenant.create({
    data: { name: `p8-capture-other-${suffix}`, slug: `p8-capture-other-${suffix}` },
  })
  const actorId = id32()
  const now = BigInt(Date.now())
  const customerId = id32()
  const contractId = id32()
  const fieldId = id32()
  const blobFieldId = id32()

  const actor: AuthUser = {
    id: actorId,
    tenantId: tenant.id,
    email: null,
    name: '快照操作人',
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: [],
  }

  try {
    await fixtureDb.customer.create({
      data: {
        id: customerId,
        name: '快照客户',
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
        name: 'Prisma 8 快照合同',
        customerId,
        owner: actorId,
        amount: 123.45,
        number: `C-${suffix}`.slice(0, 50),
        stage: 'AFOOT',
        startTime: now - 1_000n,
        endTime: now + 1_000n,
        organizationId: tenant.id,
        pos: 4096n,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      },
    })
    await fixtureDb.contractField.create({
      data: { id: id32(), resourceId: contractId, fieldId, fieldValue: 'normal-value' },
    })
    await fixtureDb.contractFieldBlob.create({
      data: { id: id32(), resourceId: contractId, fieldId: blobFieldId, fieldValue: 'blob-value' },
    })
    await fixtureDb.contractSnapshot.create({
      data: {
        id: id32(),
        contractId,
        contractProp: 'name',
        contractValue: '历史合同名',
      },
    })

    const service = new ApprovalResourceCaptureService(prisma8)
    const captured = (await service.capture(actor, 'contract', contractId)) as unknown as {
      contract: Record<string, unknown>
      fields: Array<Record<string, unknown>>
      fieldBlobs: Array<Record<string, unknown>>
      snapshots: Array<Record<string, unknown>>
    }
    assert.equal(captured.contract.name, 'Prisma 8 快照合同')
    assert.equal(captured.contract.amount, '123.45')
    assert.equal(captured.contract.startTime, (now - 1_000n).toString())
    assert.equal(captured.contract.endTime, (now + 1_000n).toString())
    assert.equal(captured.contract.pos, '4096')
    assert.equal(captured.fields.length, 1)
    assert.equal(captured.fields[0]?.fieldValue, 'normal-value')
    assert.equal(captured.fieldBlobs.length, 1)
    assert.equal(captured.fieldBlobs[0]?.fieldValue, 'blob-value')
    assert.equal(captured.snapshots.length, 1)
    assert.equal(captured.snapshots[0]?.contractValue, '历史合同名')

    await assert.rejects(
      () => service.capture({ ...actor, tenantId: otherTenant.id }, 'contract', contractId),
      /合同不存在/,
    )
  } finally {
    await fixtureDb.contract.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.customer.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.tenant.deleteMany({ where: { id: { in: [tenant.id, otherTenant.id] } } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
