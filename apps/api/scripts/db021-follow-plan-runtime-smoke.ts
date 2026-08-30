import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { ModuleFormsService } from '../src/modules/metadata/module-forms.service'
import { ResourceFieldValueService } from '../src/modules/metadata/resource-field-value.service'

function id() {
  return randomUUID().replaceAll('-', '').slice(0, 32)
}

async function main() {
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env['DATABASE_URL'] }))
  await prisma.onModuleInit()
  const forms = new ModuleFormsService(prisma)
  const values = new ResourceFieldValueService(prisma, forms)
  const tenantId = id()
  const actorId = id()
  const planId = id()
  const sourceTargetId = id()
  const mergedTargetId = id()

  try {
    const config = await forms.getConfig(tenantId, 'followPlan')
    assert.equal(config.fields.filter((field) => field.system).length, 8)

    const shortField = await forms.createField(
      tenantId,
      'followPlan',
      { label: 'DB021 短字段', type: 'text' },
      actorId,
    )
    const blobField = await forms.createField(
      tenantId,
      'followPlan',
      { label: 'DB021 长备注', type: 'textarea' },
      actorId,
    )

    await prisma.$transaction(async (tx) => {
      await tx.followUpPlan.create({
        data: {
          id: planId,
          tenantId,
          targetType: 'customer',
          targetId: sourceTargetId,
          content: 'DB-021 runtime smoke',
          ownerId: actorId,
          createdById: actorId,
        },
      })
      await values.save(
        tenantId,
        'followPlan',
        planId,
        {
          [shortField.key]: 'NORMAL-OK',
          [blobField.key]: 'BLOB-OK',
        },
        'create',
        tx,
      )
    })

    assert.equal(await prisma.followUpPlanField.count({ where: { resourceId: planId } }), 1)
    assert.equal(await prisma.followUpPlanFieldBlob.count({ where: { resourceId: planId } }), 1)

    const loaded = await values.load(tenantId, 'followPlan', [planId])
    assert.deepEqual(loaded.get(planId), {
      [shortField.key]: 'NORMAL-OK',
      [blobField.key]: 'BLOB-OK',
    })

    assert.deepEqual(
      await values.filterResourceIds(tenantId, 'followPlan', [
        { key: shortField.key, op: 'eq', value: 'NORMAL-OK' },
        { key: blobField.key, op: 'contains', value: 'BLOB' },
      ]),
      [planId],
    )

    await prisma.followUpPlan.update({
      where: { id: planId },
      data: { targetId: mergedTargetId },
    })
    assert.equal(
      (await prisma.followUpPlan.findUniqueOrThrow({ where: { id: planId } })).targetId,
      mergedTargetId,
    )
    assert.equal(await prisma.followUpPlanField.count({ where: { resourceId: planId } }), 1)
    assert.equal(await prisma.followUpPlanFieldBlob.count({ where: { resourceId: planId } }), 1)
    assert.deepEqual(await values.load(tenantId, 'followPlan', [planId]), new Map([
      [planId, { [shortField.key]: 'NORMAL-OK', [blobField.key]: 'BLOB-OK' }],
    ]))

    await prisma.followUpPlan.delete({ where: { id: planId } })
    assert.equal(await prisma.followUpPlanField.count({ where: { resourceId: planId } }), 0)
    assert.equal(await prisma.followUpPlanFieldBlob.count({ where: { resourceId: planId } }), 0)

    console.log('DB-021 FollowPlan runtime smoke: 12 assertions passed')
  } finally {
    await prisma.followUpPlan.deleteMany({ where: { tenantId } })
    await prisma.sysModuleForm.deleteMany({ where: { organizationId: tenantId } })
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
