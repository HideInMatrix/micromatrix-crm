import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { ApprovalResourceCaptureService } from './approval-resource-capture.service'
import { ApprovalResourceRestoreService } from './approval-resource-restore.service'
import type { ApprovalJsonValue } from './approval-runtime.types'

const id32 = () => randomUUID().replaceAll('-', '')

test('ApprovalResourceRestore 使用 Prisma 8 原子恢复 Contract 并保留当前审批状态', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-restore-${suffix}`, slug: `p8-restore-${suffix}` },
  })
  const actorId = id32()
  const customerId = id32()
  const contractId = id32()
  const fieldId = id32()
  const blobFieldId = id32()
  const snapshotId = id32()
  const now = BigInt(Date.now())

  try {
    await fixtureDb.customer.create({
      data: {
        id: customerId,
        name: 'Restore 客户',
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
        name: '恢复前合同',
        customerId,
        owner: actorId,
        amount: 123.45,
        number: `R-${suffix}`.slice(0, 50),
        approvalStatus: 'PENDING',
        stage: 'AFOOT',
        startTime: now - 10_000n,
        endTime: now + 10_000n,
        organizationId: tenant.id,
        pos: 4096n,
        approved: false,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      },
    })
    await fixtureDb.contractField.create({
      data: { id: id32(), resourceId: contractId, fieldId, fieldValue: 'old-normal' },
    })
    await fixtureDb.contractFieldBlob.create({
      data: { id: id32(), resourceId: contractId, fieldId: blobFieldId, fieldValue: 'old-blob' },
    })
    await fixtureDb.contractSnapshot.create({
      data: {
        id: snapshotId,
        contractId,
        contractProp: 'entity',
        contractValue: JSON.stringify({
          name: 'snapshot-old',
          approvalStatus: 'PENDING',
          approved: false,
        }),
      },
    })

    const capture = new ApprovalResourceCaptureService(prisma8)
    const restore = new ApprovalResourceRestoreService(prisma8)
    const actor = { id: actorId, tenantId: tenant.id } as never
    const captured = (await capture.capture(actor, 'contract', contractId)) as ApprovalJsonValue

    await fixtureDb.contract.update({
      where: { id: contractId },
      data: {
        name: '恢复中的新值',
        amount: 999.99,
        approvalStatus: 'APPROVED',
        approved: true,
        updateUser: 'current-operator',
      },
    })
    await fixtureDb.contractField.deleteMany({ where: { resourceId: contractId } })
    await fixtureDb.contractField.create({
      data: { id: id32(), resourceId: contractId, fieldId, fieldValue: 'new-normal' },
    })
    await fixtureDb.contractFieldBlob.updateMany({
      where: { resourceId: contractId },
      data: { fieldValue: 'new-blob' },
    })

    const invalid = structuredClone(captured) as unknown as {
      fields: Array<{ fieldValue: string }>
    }
    invalid.fields[0]!.fieldValue = 'x'.repeat(256)
    await assert.rejects(
      () => restore.restore(tenant.id, 'contract', contractId, invalid as ApprovalJsonValue, actorId),
      /varchar\(255\) value is too long/,
    )
    const afterFailedRestore = await fixtureDb.contract.findUniqueOrThrow({ where: { id: contractId } })
    assert.equal(afterFailedRestore.name, '恢复中的新值')
    assert.equal(Number(afterFailedRestore.amount), 999.99)
    assert.equal(
      await fixtureDb.contractField.findFirstOrThrow({ where: { resourceId: contractId } }).then((row) => row.fieldValue),
      'new-normal',
    )

    await restore.restore(tenant.id, 'contract', contractId, captured, actorId)

    const restored = await fixtureDb.contract.findUniqueOrThrow({ where: { id: contractId } })
    assert.equal(restored.name, '恢复前合同')
    assert.equal(Number(restored.amount), 123.45)
    assert.equal(restored.approvalStatus, 'APPROVED')
    assert.equal(restored.approved, true)
    assert.equal(restored.updateUser, actorId)

    const fields = await fixtureDb.contractField.findMany({ where: { resourceId: contractId } })
    const blobs = await fixtureDb.contractFieldBlob.findMany({ where: { resourceId: contractId } })
    assert.deepEqual(fields.map((row) => row.fieldValue), ['old-normal'])
    assert.deepEqual(blobs.map((row) => row.fieldValue), ['old-blob'])

    const restoredSnapshot = await fixtureDb.contractSnapshot.findUniqueOrThrow({
      where: { id: snapshotId },
    })
    assert.ok(restoredSnapshot.contractValue)
    const snapshotJson = JSON.parse(restoredSnapshot.contractValue) as Record<string, unknown>
    assert.equal(snapshotJson.name, 'snapshot-old')
    assert.equal(snapshotJson.approvalStatus, 'APPROVED')
    assert.equal(snapshotJson.approved, true)
  } finally {
    await fixtureDb.contract.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.customer.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.tenant.delete({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
