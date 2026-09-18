import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { decimalString, numericValue } from '../../prisma/numeric-value'
import { createLegacyId32 } from '../../common/legacy-id'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { ApprovalResourceCaptureService } from './approval-resource-capture.service'

const id32 = () => createLegacyId32()

test('ApprovalResourceCapture 使用 Prisma 8 保持 Contract JSON 快照与租户隔离', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-capture')
  const otherTenant = await createPrismaTestTenant(prisma8Client, 'p8-capture-other')
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
    const organizationId = tenant.id
    const actorVarchar = actorId
    await prisma8Client.orm.public.Customer.create({
      id: customerId,
      name: '快照客户',
      owner: actorVarchar,
      organizationId,
      createTime: now,
      updateTime: now,
      createUser: actorVarchar,
      updateUser: actorVarchar,
    })
    await prisma8Client.orm.public.Contract.create({
      id: contractId,
      name: 'Prisma 8 快照合同',
      customerId,
      owner: actorVarchar,
      amount: numericValue(decimalString(123.45, 14, 2), 14, 2),
      number: `C-${suffix}`.slice(0, 50),
      stage: 'AFOOT',
      startTime: now - 1_000n,
      endTime: now + 1_000n,
      organizationId,
      pos: 4096n,
      createTime: now,
      updateTime: now,
      createUser: actorVarchar,
      updateUser: actorVarchar,
    })
    await prisma8Client.orm.public.ContractField.create({
      id: id32(),
      resourceId: contractId,
      fieldId,
      fieldValue: 'normal-value',
    })
    await prisma8Client.orm.public.ContractFieldBlob.create({
      id: id32(),
      resourceId: contractId,
      fieldId: blobFieldId,
      fieldValue: 'blob-value',
    })
    await prisma8Client.orm.public.ContractSnapshot.create({
      id: id32(),
      contractId,
      contractProp: 'name',
      contractValue: '历史合同名',
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
    await prisma8Client.orm.public.Contract.where({ organizationId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Customer.where({ organizationId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Tenants.where((row) =>
      row.id.in([tenant.id, otherTenant.id]),
    ).deleteAll()
    await testDb.close()
  }
})
