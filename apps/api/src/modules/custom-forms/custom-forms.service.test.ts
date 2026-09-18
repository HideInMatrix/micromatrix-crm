/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { CustomFormsService } from './custom-forms.service'

const databaseUrl = process.env['DATABASE_URL']

function shortId(prefix: string) {
  return `${prefix}${randomUUID().replaceAll('-', '')}`.slice(0, 32)
}

test(
  '自定义表单数据源通过 Prisma 8 raw lane 按组织和 customFormId 隔离',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)

    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const service = new CustomFormsService(
      { client: prisma8Client } as Prisma8Service,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    )
    const rawConsumer = service as unknown as {
      loadDataSourceOptionsByIds(
        tenantId: string,
        sourceType: string,
        ids: string[],
      ): Promise<Array<{ id: string; name: string }>>
      loadDataSourceOptionsByName(
        tenantId: string,
        sourceType: string,
        name: string,
      ): Promise<Array<{ id: string; name: string }>>
      filterDataIds(
        tenantId: string,
        formId: string,
        fields: any[],
        conditions: any[],
        searchMode: 'AND' | 'OR',
      ): Promise<string[]>
    }
    const organizationId = shortId('org')
    const otherOrganizationId = shortId('other')
    const operatorId = shortId('user')
    const timestamp = BigInt(Date.now())
    const createdFormIds: string[] = []

    await fixtureDb.$connect()
    await prisma8Client.connect()

    try {
      const form = await fixtureDb.customForm.create({
        data: {
          name: `Prisma 8 raw ${randomUUID()}`,
          organizationId,
          createTime: timestamp,
          updateTime: timestamp,
          createUser: operatorId,
          updateUser: operatorId,
        },
      })
      const otherForm = await fixtureDb.customForm.create({
        data: {
          name: `Prisma 8 raw other ${randomUUID()}`,
          organizationId,
          createTime: timestamp,
          updateTime: timestamp,
          createUser: operatorId,
          updateUser: operatorId,
        },
      })
      createdFormIds.push(form.id, otherForm.id)

      const exactName = `O'Reilly ${randomUUID()}`
      const first = await fixtureDb.customFormData.create({
        data: {
          customFormId: form.id,
          name: exactName,
          ownerId: operatorId,
          organizationId,
          createTime: timestamp,
          updateTime: timestamp,
          createUser: operatorId,
          updateUser: operatorId,
        },
      })
      const second = await fixtureDb.customFormData.create({
        data: {
          customFormId: form.id,
          name: '第二条',
          ownerId: operatorId,
          organizationId,
          createTime: timestamp,
          updateTime: timestamp,
          createUser: operatorId,
          updateUser: operatorId,
        },
      })
      const otherFormRow = await fixtureDb.customFormData.create({
        data: {
          customFormId: otherForm.id,
          name: exactName,
          ownerId: operatorId,
          organizationId,
          createTime: timestamp,
          updateTime: timestamp,
          createUser: operatorId,
          updateUser: operatorId,
        },
      })
      const otherOrganizationRow = await fixtureDb.customFormData.create({
        data: {
          customFormId: form.id,
          name: exactName,
          ownerId: operatorId,
          organizationId: otherOrganizationId,
          createTime: timestamp,
          updateTime: timestamp,
          createUser: operatorId,
          updateUser: operatorId,
        },
      })

      const scoreFieldId = shortId('score')
      const noteFieldId = shortId('note')
      const dateFieldId = shortId('date')
      const tagsFieldId = shortId('tags')
      await fixtureDb.customFormDataField.createMany({
        data: [
          { resourceId: first.id, fieldId: scoreFieldId, fieldValue: '88' },
          { resourceId: second.id, fieldId: scoreFieldId, fieldValue: '40' },
          { resourceId: first.id, fieldId: noteFieldId, fieldValue: `O'Reilly premium` },
          {
            resourceId: first.id,
            fieldId: dateFieldId,
            fieldValue: '2026-09-15T00:00:00.000Z',
          },
          {
            resourceId: second.id,
            fieldId: dateFieldId,
            fieldValue: '2025-01-01T00:00:00.000Z',
          },
        ],
      })
      await fixtureDb.customFormDataFieldBlob.createMany({
        data: [
          {
            resourceId: first.id,
            fieldId: tagsFieldId,
            fieldValue: JSON.stringify(['vip', `O'Reilly`]),
          },
          {
            resourceId: second.id,
            fieldId: tagsFieldId,
            fieldValue: JSON.stringify(['normal']),
          },
        ],
      })

      const byIds = await rawConsumer.loadDataSourceOptionsByIds(organizationId, form.id, [
        first.id,
        second.id,
        otherFormRow.id,
        otherOrganizationRow.id,
      ])
      assert.deepEqual(
        new Map(byIds.map((row) => [row.id, row.name])),
        new Map([
          [first.id, first.name],
          [second.id, second.name],
        ]),
      )

      const byName = await rawConsumer.loadDataSourceOptionsByName(
        organizationId,
        form.id,
        exactName,
      )
      assert.deepEqual(byName, [{ id: first.id, name: first.name }])

      const filterFields = [
        { id: 'system-name', key: 'name', label: '名称', type: 'text', system: true },
        { id: scoreFieldId, key: 'score', label: '评分', type: 'number', system: false },
        { id: noteFieldId, key: 'note', label: '备注', type: 'text', system: false },
        { id: dateFieldId, key: 'eventDate', label: '日期', type: 'datetime', system: false },
        { id: tagsFieldId, key: 'tags', label: '标签', type: 'multiselect', system: false },
      ]
      const filtered = async (conditions: any[], searchMode: 'AND' | 'OR' = 'AND') =>
        (
          await rawConsumer.filterDataIds(
            organizationId,
            form.id,
            filterFields,
            conditions,
            searchMode,
          )
        ).sort()

      assert.deepEqual(
        await filtered([{ key: 'name', op: 'contains', value: `O'Reilly` }]),
        [first.id],
      )
      assert.deepEqual(await filtered([{ key: 'score', op: 'gte', value: 60 }]), [first.id])
      assert.deepEqual(await filtered([{ key: 'tags', op: 'contains', value: 'vip' }]), [first.id])
      assert.deepEqual(
        await filtered([{ key: 'tags', op: 'in', value: ['missing', `O'Reilly`] }]),
        [first.id],
      )
      assert.deepEqual(await filtered([{ key: 'note', op: 'isEmpty', value: null }]), [second.id])
      assert.deepEqual(
        await filtered([{ key: 'eventDate', op: 'gte', value: '2026-01-01T00:00:00.000Z' }]),
        [first.id],
      )
      assert.deepEqual(
        await filtered(
          [
            { key: 'score', op: 'gte', value: 60 },
            { key: 'tags', op: 'contains', value: 'vip' },
          ],
          'AND',
        ),
        [first.id],
      )
      assert.deepEqual(
        await filtered(
          [
            { key: 'score', op: 'gte', value: 60 },
            { key: 'name', op: 'eq', value: '第二条' },
          ],
          'OR',
        ),
        [first.id, second.id].sort(),
      )

      const builtinSourceTypes = [
        'CUSTOMER',
        'CONTACT',
        'OPPORTUNITY',
        'PRODUCT',
        'CLUE',
        'PRICE',
        'CONTRACT',
        'QUOTATION',
        'PAYMENT_PLAN',
        'CONTRACT_PAYMENT_RECORD',
        'BUSINESS_TITLE',
        'ORDER',
        'INVOICE',
      ] as const
      const emptyOrganizationId = shortId('empty')
      for (const sourceType of builtinSourceTypes) {
        assert.deepEqual(
          await rawConsumer.loadDataSourceOptionsByIds(emptyOrganizationId, sourceType, [
            shortId('missing'),
          ]),
          [],
          `${sourceType} by-id raw branch should execute against the real table`,
        )
        assert.deepEqual(
          await rawConsumer.loadDataSourceOptionsByName(
            emptyOrganizationId,
            sourceType,
            `missing O'Reilly ${randomUUID()}`,
          ),
          [],
          `${sourceType} by-name raw branch should execute against the real table`,
        )
      }
    } finally {
      if (createdFormIds.length) {
        await fixtureDb.customForm.deleteMany({ where: { id: { in: createdFormIds } } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)

test(
  'CustomFormsService 使用 Prisma 8 保持配置、角色、Field/Blob 与批量数据事务语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)

    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const noteField = {
      id: shortId('note'),
      key: 'note',
      label: '备注',
      type: 'text',
      system: false,
      hidden: false,
      required: false,
    }
    const tagsField = {
      id: shortId('tags'),
      key: 'tags',
      label: '标签',
      type: 'multiselect',
      system: false,
      hidden: false,
      required: false,
    }
    const fields = [noteField, tagsField] as any[]
    let tenantId: string | null = null

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Custom forms Prisma8 ${suffix}`, slug: `custom-forms-p8-${suffix}` },
      })
      tenantId = tenant.id
      const [admin, member] = await Promise.all([
        fixtureDb.user.create({
          data: {
            tenantId: tenant.id,
            email: `custom-admin-${suffix}@example.test`,
            passwordHash: 'not-used',
            name: 'Custom Admin',
          },
        }),
        fixtureDb.user.create({
          data: {
            tenantId: tenant.id,
            email: `custom-member-${suffix}@example.test`,
            passwordHash: 'not-used',
            name: 'Custom Member',
          },
        }),
      ])
      const actor = {
        id: admin.id,
        tenantId: tenant.id,
        email: admin.email,
        name: admin.name,
        deptId: null,
        leaderId: null,
        roles: [],
        permissions: ['*'],
      } as any
      const memberActor = {
        ...actor,
        id: member.id,
        email: member.email,
        name: member.name,
      }
      const moduleForms = {
        invalidateFormCache: async () => undefined,
        getConfig: async () => ({ formProp: {}, fields }),
      }
      const metadata = {
        listFields: async () => fields,
        validateCustomData: async (
          _organizationId: string,
          _formId: string,
          values: Record<string, unknown> | undefined,
        ) => values ?? {},
        computeFormulas: () => ({}),
        resolveEditableField: async (_organizationId: string, _formId: string, fieldId: string) => {
          const field = fields.find((item) => item.id === fieldId)
          if (!field) throw new Error(`missing field ${fieldId}`)
          return field
        },
        validateBatchFieldValue: () => undefined,
      }
      const attachments = {
        removeAllFromTargets: async () => undefined,
        removeFromTarget: async () => undefined,
        listByIdsFromTarget: async () => [],
      }
      const service = new CustomFormsService(
        { client: prisma8Client } as Prisma8Service,
        moduleForms as any,
        metadata as any,
        attachments as any,
        {} as any,
        {} as any,
        {} as any,
      )

      const form = await service.create(actor, {
        name: 'Prisma8 自定义表单',
        enable: true,
        formProp: { layout: 'two-column' },
      })
      assert.equal(form.name, 'Prisma8 自定义表单')
      assert.equal(form.isAdmin, true)
      assert.equal(
        await fixtureDb.customForm.count({ where: { id: form.id, organizationId: tenant.id } }),
        1,
      )
      assert.equal(await fixtureDb.sysModuleForm.count({ where: { id: form.id } }), 1)
      assert.equal(await fixtureDb.sysModuleField.count({ where: { formId: form.id } }), 2)
      assert.equal(await fixtureDb.customFormRole.count({ where: { customFormId: form.id } }), 3)
      assert.equal(await fixtureDb.customFormAdmin.count({ where: { customFormId: form.id } }), 1)
      const formBlob = await fixtureDb.sysModuleFormBlob.findUniqueOrThrow({ where: { id: form.id } })
      assert.deepEqual(JSON.parse(formBlob.prop ?? '{}'), { layout: 'two-column' })

      await service.setRoleUsers(actor, form.id, 'MANAGE_OWN', [member.id])
      const memberForms = await service.list(memberActor)
      assert.equal(memberForms.some((item) => item.id === form.id), true)
      assert.equal(memberForms.find((item) => item.id === form.id)?.hasCreateDataPermission, true)

      const created = await service.createData(actor, form.id, {
        name: 'Prisma8 数据一',
        ownerId: admin.id,
        values: { note: '初始备注', tags: ['vip', 'new'] },
      })
      assert.equal(created.name, 'Prisma8 数据一')
      assert.equal(created.values['note'], '初始备注')
      assert.deepEqual(created.values['tags'], ['vip', 'new'])
      const persisted = await fixtureDb.customFormData.findUniqueOrThrow({ where: { id: created.id } })
      assert.equal(persisted.ownerId, admin.id)
      assert.equal(
        await fixtureDb.customFormDataField.count({
          where: { resourceId: created.id, fieldId: noteField.id },
        }),
        1,
      )
      assert.equal(
        await fixtureDb.customFormDataFieldBlob.count({
          where: { resourceId: created.id, fieldId: tagsField.id },
        }),
        1,
      )

      const page = await service.dataPage(actor, form.id, {
        current: 1,
        pageSize: 10,
        keyword: '数据一',
      })
      assert.equal(page.total, 1)
      assert.equal(page.list[0]?.id, created.id)
      assert.equal(page.list[0]?.values['note'], '初始备注')

      const updated = await service.updateData(actor, form.id, created.id, {
        name: 'Prisma8 数据一更新',
        ownerId: admin.id,
        values: { note: '更新备注', tags: ['updated'] },
      })
      assert.equal(updated.name, 'Prisma8 数据一更新')
      assert.equal(updated.values['note'], '更新备注')
      assert.deepEqual(updated.values['tags'], ['updated'])

      const batch = await service.batchUpdateData(actor, form.id, {
        ids: [created.id],
        fieldId: noteField.id,
        fieldValue: '批量备注',
      } as any)
      assert.equal(batch.count, 1)
      const afterBatch = await service.dataDetail(actor, form.id, created.id)
      assert.equal(afterBatch.values['note'], '批量备注')

      const deleted = await service.batchDeleteData(actor, form.id, { ids: [created.id] } as any)
      assert.equal(deleted.count, 1)
      assert.equal(await fixtureDb.customFormData.count({ where: { id: created.id } }), 0)

      await service.remove(actor, form.id)
      assert.equal(await fixtureDb.customForm.count({ where: { id: form.id } }), 0)
      assert.equal(await fixtureDb.sysModuleForm.count({ where: { id: form.id } }), 0)
    } finally {
      if (tenantId) {
        await fixtureDb.customFormData.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.sysModuleForm.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.customForm.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
