import assert from 'node:assert/strict'
import test from 'node:test'
import type { FieldVO, SubTableFieldType } from '@micromatrix/shared'
import type { PrismaService } from '../../prisma/prisma.service'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { SaveFormFieldDto } from './dto/field.dto'
import { ModuleFormsService } from './module-forms.service'

const databaseUrl = process.env['DATABASE_URL']

function toSaveField(field: FieldVO): SaveFormFieldDto {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options ?? undefined,
    config: field.config ?? undefined,
    span: field.span,
    showInList: field.showInList,
    listWidth: field.listWidth ?? undefined,
    hidden: field.hidden,
    mobile: field.mobile ?? true,
    subFields: field.subFields?.map((subField) => ({
      id: subField.id,
      key: subField.key,
      label: subField.label,
      type: subField.type as SubTableFieldType,
      required: subField.required,
      options: subField.options ?? undefined,
      config: subField.config ?? undefined,
    })),
  }
}

test(
  'ModuleForms 整表单保存保持字段 ID、统一排序与系统字段保护',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'form-design-save')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '表单设计管理员',
      })
      const service = new ModuleFormsService({ client: prismaClient } as PrismaService)
      const initial = await service.getConfig(tenant.id, 'lead')
      assert.ok(initial.fields.length > 0)

      const firstSystemField = initial.fields.find((field) => field.system)
      assert.ok(firstSystemField)
      const initialIds = new Set(initial.fields.map((field) => field.id))
      const saved = await service.saveDesign(
        tenant.id,
        'lead',
        [
          ...initial.fields.map(toSaveField).reverse(),
          {
            label: '渠道备注',
            type: 'text',
            required: false,
            config: { placeholder: '请输入渠道备注' },
            span: 12,
            showInList: true,
            hidden: false,
            mobile: true,
          },
        ],
        { ...initial.formProp, layout: 3, labelPos: 'left', viewSize: 'large' },
        actor.id,
      )

      assert.equal(saved.formProp.layout, 3)
      assert.equal(saved.formProp.labelPos, 'left')
      assert.equal(saved.formProp.viewSize, 'large')
      assert.deepEqual(
        saved.fields.slice(0, initial.fields.length).map((field) => field.id),
        initial.fields
          .map((field) => field.id)
          .reverse(),
      )
      const created = saved.fields.find((field) => field.label === '渠道备注')
      assert.ok(created)
      assert.equal(initialIds.has(created.id), false)
      assert.equal(created.config?.placeholder, '请输入渠道备注')
      assert.ok(saved.fields.some((field) => field.id === firstSystemField.id))

      const beforeRejectedSave = await service.getConfig(tenant.id, 'lead')
      await assert.rejects(
        () =>
          service.saveDesign(
            tenant.id,
            'lead',
            beforeRejectedSave.fields
              .filter((field) => field.id !== firstSystemField.id)
              .map(toSaveField),
            { ...beforeRejectedSave.formProp, labelPos: 'top' },
            actor.id,
          ),
        /系统字段不可删除/,
      )
      const afterRejectedSave = await service.getConfig(tenant.id, 'lead')
      assert.equal(afterRejectedSave.formProp.labelPos, 'left')
      assert.deepEqual(
        afterRejectedSave.fields.map((field) => field.id),
        beforeRejectedSave.fields.map((field) => field.id),
      )
    } finally {
      if (tenantId) {
        await prismaClient.orm.public.SysModuleForm.where({ organizationId: tenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
