import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { ModuleFormsService } from '../src/modules/metadata/module-forms.service'
import { ResourceFieldValueService } from '../src/modules/metadata/resource-field-value.service'

async function main() {
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env['DATABASE_URL'] }))
  await prisma.onModuleInit()
  const forms = new ModuleFormsService(prisma)
  const values = new ResourceFieldValueService(prisma, forms)
  const organizationId = randomUUID().replaceAll('-', '').slice(0, 32)
  const actorId = randomUUID().replaceAll('-', '').slice(0, 32)
  const customerA = randomUUID().replaceAll('-', '').slice(0, 32)
  const customerB = randomUUID().replaceAll('-', '').slice(0, 32)
  const rollbackCustomer = randomUUID().replaceAll('-', '').slice(0, 32)
  const clueId = randomUUID().replaceAll('-', '').slice(0, 32)

  try {
    const initial = await forms.getConfig(organizationId, 'customer')
    assert.equal(
      initial.fields.some((field) => field.key === 'name' && field.system),
      true,
    )
    assert.equal(
      initial.fields.some((field) => field.key === 'cf_industry' && !field.system),
      true,
    )

    const code = await forms.createField(
      organizationId,
      'customer',
      { label: '审计编码', type: 'text', required: true, config: { unique: true } },
      actorId,
    )
    const note = await forms.createField(
      organizationId,
      'customer',
      { label: '审计备注', type: 'textarea' },
      actorId,
    )

    const status = await forms.createField(
      organizationId,
      'contact',
      {
        label: '业务状态',
        type: 'multiselect',
        options: [
          { label: '启用', value: 'enabled' },
          { label: '停用', value: 'disabled' },
        ],
      },
      actorId,
    )
    const statusBlob = await prisma.sysModuleFieldBlob.findUniqueOrThrow({ where: { id: status.id } })
    const malformedStatusProp = JSON.parse(statusBlob.prop ?? '{}') as Record<string, unknown>
    await prisma.sysModuleFieldBlob.update({
      where: { id: status.id },
      data: { prop: JSON.stringify({ ...malformedStatusProp, options: [[], []] }) },
    })
    const malformedStatus = (await forms.listFields(organizationId, 'contact')).find(
      (field) => field.id === status.id,
    )
    assert.deepEqual(malformedStatus?.options, [])
    await assert.rejects(
      () =>
        forms.updateField(
          organizationId,
          status.id,
          { options: [[], []] as unknown as NonNullable<typeof status.options> },
          actorId,
        ),
      /选项格式不正确/,
    )
    const repairedStatus = await forms.updateField(
      organizationId,
      status.id,
      {
        options: [
          { label: '启用', value: 'enabled' },
          { label: '停用', value: 'disabled' },
        ],
      },
      actorId,
    )
    assert.deepEqual(repairedStatus.options, [
      { label: '启用', value: 'enabled' },
      { label: '停用', value: 'disabled' },
    ])
    assert.deepEqual(
      (await forms.listFields(organizationId, 'contact')).find((field) => field.id === status.id)?.options,
      repairedStatus.options,
    )

    await prisma.$transaction(async (tx) => {
      const now = BigInt(Date.now())
      await tx.customer.create({
        data: {
          id: customerA,
          name: '字段审计客户 A',
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      await values.save(
        organizationId,
        'customer',
        customerA,
        { [code.key]: 'AUDIT-001', [note.key]: '普通/Blob 路由验证' },
        'create',
        tx,
      )
    })

    const loaded = await values.load(organizationId, 'customer', [customerA])
    assert.equal(loaded.get(customerA)?.[code.key], 'AUDIT-001')
    assert.equal(loaded.get(customerA)?.[note.key], '普通/Blob 路由验证')
    assert.deepEqual(
      await values.filterResourceIds(organizationId, 'customer', [
        { key: code.key, op: 'eq', value: 'AUDIT-001' },
        { key: note.key, op: 'contains', value: 'Blob' },
      ]),
      [customerA],
    )

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          const now = BigInt(Date.now())
          await tx.customer.create({
            data: {
              id: customerB,
              name: '字段审计客户 B',
              organizationId,
              createTime: now,
              updateTime: now,
              createUser: actorId,
              updateUser: actorId,
            },
          })
          await values.save(
            organizationId,
            'customer',
            customerB,
            { [code.key]: 'AUDIT-001' },
            'create',
            tx,
          )
        }),
      /不能重复/,
    )
    assert.equal(await prisma.customer.count({ where: { id: customerB } }), 0)

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          const now = BigInt(Date.now())
          await tx.customer.create({
            data: {
              id: rollbackCustomer,
              name: '事务回滚客户',
              organizationId,
              createTime: now,
              updateTime: now,
              createUser: actorId,
              updateUser: actorId,
            },
          })
          await values.save(
            organizationId,
            'customer',
            rollbackCustomer,
            { [code.key]: 'AUDIT-ROLLBACK' },
            'create',
            tx,
          )
          throw new Error('ROLLBACK_AUDIT')
        }),
      /ROLLBACK_AUDIT/,
    )
    assert.equal(await prisma.customer.count({ where: { id: rollbackCustomer } }), 0)

    await forms.deleteField(organizationId, note.id)
    assert.equal(await prisma.customerFieldBlob.count({ where: { fieldId: note.id } }), 0)

    const leadText = await forms.createField(
      organizationId,
      'lead',
      { label: '待删除文本', type: 'text' },
      actorId,
    )
    const leadMulti = await forms.createField(
      organizationId,
      'lead',
      {
        label: '待删除多选',
        type: 'multiselect',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
      },
      actorId,
    )
    await prisma.$transaction(async (tx) => {
      const now = BigInt(Date.now())
      await tx.clue.create({
        data: {
          id: clueId,
          name: '字段删除回归线索',
          stage: 'NEW',
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      await values.save(
        organizationId,
        'clue',
        clueId,
        { [leadText.key]: 'hello', [leadMulti.key]: ['a', 'b'] },
        'create',
        tx,
      )
    })
    assert.equal(await prisma.clueField.count({ where: { fieldId: leadText.id } }), 1)
    assert.equal(await prisma.clueFieldBlob.count({ where: { fieldId: leadMulti.id } }), 1)
    await forms.deleteField(organizationId, leadText.id)
    await forms.deleteField(organizationId, leadMulti.id)
    assert.equal(await prisma.clueField.count({ where: { fieldId: leadText.id } }), 0)
    assert.equal(await prisma.clueFieldBlob.count({ where: { fieldId: leadMulti.id } }), 0)
    assert.equal(
      (await forms.listFields(organizationId, 'lead')).some((field) =>
        [leadText.id, leadMulti.id].includes(field.id),
      ),
      false,
    )
    console.log('W3.4 module forms/field values smoke: 21 assertions passed')
  } finally {
    await prisma.clue.deleteMany({ where: { organizationId } })
    await prisma.customer.deleteMany({ where: { organizationId } })
    await prisma.sysModuleForm.deleteMany({ where: { organizationId } })
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
