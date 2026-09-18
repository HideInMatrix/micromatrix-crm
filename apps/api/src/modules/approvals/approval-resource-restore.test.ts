import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { decimalString, numericValue } from '../../prisma/numeric-value'
import { createLegacyId32 } from '../../common/legacy-id'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { ApprovalResourceCaptureService } from './approval-resource-capture.service'
import { ApprovalResourceRestoreService } from './approval-resource-restore.service'
import type { ApprovalJsonValue } from './approval-runtime.types'

const id32 = () => createLegacyId32()

test('ApprovalResourceRestore 使用 Prisma 原子恢复 Contract 并保留当前审批状态', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prismaClient = testDb.client
  const prisma = { client: prismaClient } as PrismaService

  const suffix = String(Date.now()) + '-' + Math.random().toString(16).slice(2)
  const tenant = await createPrismaTestTenant(prismaClient, 'p8-restore')
  const actorId = id32()
  const customerId = id32()
  const contractId = id32()
  const fieldId = id32()
  const blobFieldId = id32()
  const snapshotId = id32()
  const now = BigInt(Date.now())

  try {
    const organizationId = tenant.id
    const actorVarchar = actorId
    await prismaClient.orm.public.Customer.create({
      id: customerId,
      name: 'Restore 客户',
      owner: actorVarchar,
      organizationId,
      createTime: now,
      updateTime: now,
      createUser: actorVarchar,
      updateUser: actorVarchar,
    })
    await prismaClient.orm.public.Contract.create({
      id: contractId,
      name: '恢复前合同',
      customerId,
      owner: actorVarchar,
      amount: numericValue(decimalString(123.45, 14, 2), 14, 2),
      number: `R-${suffix}`.slice(0, 50),
      approvalStatus: 'PENDING',
      stage: 'AFOOT',
      startTime: now - 10_000n,
      endTime: now + 10_000n,
      organizationId,
      pos: 4096n,
      approved: false,
      createTime: now,
      updateTime: now,
      createUser: actorVarchar,
      updateUser: actorVarchar,
    })
    await prismaClient.orm.public.ContractField.create({
      id: id32(),
      resourceId: contractId,
      fieldId,
      fieldValue: 'old-normal',
    })
    await prismaClient.orm.public.ContractFieldBlob.create({
      id: id32(),
      resourceId: contractId,
      fieldId: blobFieldId,
      fieldValue: 'old-blob',
    })
    await prismaClient.orm.public.ContractSnapshot.create({
      id: snapshotId,
      contractId,
      contractProp: 'entity',
      contractValue: JSON.stringify({
        name: 'snapshot-old',
        approvalStatus: 'PENDING',
        approved: false,
      }),
    })

    const capture = new ApprovalResourceCaptureService(prisma)
    const restore = new ApprovalResourceRestoreService(prisma)
    const actor = { id: actorId, tenantId: tenant.id } as never
    const captured = (await capture.capture(actor, 'contract', contractId)) as ApprovalJsonValue

    await prismaClient.orm.public.Contract.where({ id: contractId }).update({
      name: '恢复中的新值',
      amount: numericValue(decimalString(999.99, 14, 2), 14, 2),
      approvalStatus: 'APPROVED',
      approved: true,
      updateUser: 'current-operator',
    })
    await prismaClient.orm.public.ContractField.where({ resourceId: contractId }).deleteAll()
    await prismaClient.orm.public.ContractField.create({
      id: id32(),
      resourceId: contractId,
      fieldId,
      fieldValue: 'new-normal',
    })
    await prismaClient.orm.public.ContractFieldBlob.where({ resourceId: contractId }).update({
      fieldValue: 'new-blob',
    })

    const invalid = structuredClone(captured) as unknown as {
      fields: Array<{ fieldValue: string }>
    }
    invalid.fields[0]!.fieldValue = 'x'.repeat(256)
    await assert.rejects(
      () =>
        restore.restore(tenant.id, 'contract', contractId, invalid as ApprovalJsonValue, actorId),
      /violates check constraint/,
    )
    const afterFailedRestore = await prismaClient.orm.public.Contract.where({
      id: contractId,
    }).first()
    assert.ok(afterFailedRestore)
    assert.equal(afterFailedRestore.name, '恢复中的新值')
    assert.equal(Number(afterFailedRestore.amount), 999.99)
    const afterFailedField = await prismaClient.orm.public.ContractField.where({
      resourceId: contractId,
    }).first()
    assert.equal(afterFailedField?.fieldValue, 'new-normal')

    await restore.restore(tenant.id, 'contract', contractId, captured, actorId)

    const restored = await prismaClient.orm.public.Contract.where({ id: contractId }).first()
    assert.ok(restored)
    assert.equal(restored.name, '恢复前合同')
    assert.equal(Number(restored.amount), 123.45)
    assert.equal(restored.approvalStatus, 'APPROVED')
    assert.equal(restored.approved, true)
    assert.equal(restored.updateUser, actorId)

    const fields = await prismaClient.orm.public.ContractField.where({
      resourceId: contractId,
    }).all()
    const blobs = await prismaClient.orm.public.ContractFieldBlob.where({
      resourceId: contractId,
    }).all()
    assert.deepEqual(
      fields.map((row) => row.fieldValue),
      ['old-normal'],
    )
    assert.deepEqual(
      blobs.map((row) => row.fieldValue),
      ['old-blob'],
    )

    const restoredSnapshot = await prismaClient.orm.public.ContractSnapshot.where({
      id: snapshotId,
    }).first()
    assert.ok(restoredSnapshot)
    assert.ok(restoredSnapshot.contractValue)
    const snapshotJson = JSON.parse(restoredSnapshot.contractValue) as Record<string, unknown>
    assert.equal(snapshotJson.name, 'snapshot-old')
    assert.equal(snapshotJson.approvalStatus, 'APPROVED')
    assert.equal(snapshotJson.approved, true)
  } finally {
    await prismaClient.orm.public.Contract.where({
      organizationId: tenant.id,
    }).deleteAll()
    await prismaClient.orm.public.Customer.where({
      organizationId: tenant.id,
    }).deleteAll()
    await prismaClient.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
