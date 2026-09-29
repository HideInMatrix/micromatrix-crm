import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModuleFormProp } from '@micromatrix/shared'
import { MetadataService } from './metadata.service'
import type { ModuleFormsService } from './module-forms.service'

test('formProp PATCH 只覆盖提交属性并保留既有 linkProp/扩展键', async () => {
  const original: ModuleFormProp = {
    layout: 2,
    labelPos: 'top',
    viewSize: 'small',
    linkProp: {
      lead: [{ key: 'CLUE_TO_RECORD', linkFields: [] }],
    },
    futureFlag: { enabled: true },
  }
  let saved: ModuleFormProp | undefined
  const moduleForms = {
    getConfig: async () => ({ formKey: 'followPlan', formProp: original, fields: [] }),
    saveFormProp: async (_tenant: string, _module: string, formProp: ModuleFormProp) => {
      saved = formProp
      return { formKey: 'followPlan', formProp, fields: [] }
    },
  } as unknown as ModuleFormsService

  const service = new MetadataService(moduleForms)
  await service.updateFormProp(
    'tenant-1',
    'followPlan',
    { layout: 3, labelPos: 'left', viewSize: 'large' },
    'user-1',
  )

  assert.deepEqual(saved, {
    ...original,
    layout: 3,
    labelPos: 'left',
    viewSize: 'large',
  })
})

test('Lead 判重范围 PATCH 保留表单布局和其它 formProp 扩展配置', async () => {
  const original: ModuleFormProp = {
    layout: 2,
    labelPos: 'left',
    viewSize: 'medium',
    linkProp: {
      customer: [{ key: 'CLUE_TO_CUSTOMER', linkFields: [] }],
    },
    futureFlag: { enabled: true },
  }
  let saved: ModuleFormProp | undefined
  const moduleForms = {
    getConfig: async () => ({ formKey: 'lead', formProp: original, fields: [] }),
    saveFormProp: async (_tenant: string, _module: string, formProp: ModuleFormProp) => {
      saved = formProp
      return { formKey: 'lead', formProp, fields: [] }
    },
  } as unknown as ModuleFormsService

  const service = new MetadataService(moduleForms)
  await service.updateFormProp(
    'tenant-1',
    'lead',
    { leadUniqueScope: 'RESOURCE_POOL' },
    'user-1',
  )

  assert.deepEqual(saved, {
    ...original,
    leadUniqueScope: 'RESOURCE_POOL',
  })
})


test('Lead 阶段 PATCH 保留既有判重、布局和扩展配置', async () => {
  const original: ModuleFormProp = {
    layout: 2,
    labelPos: 'left',
    leadUniqueScope: 'RESOURCE_POOL',
    futureFlag: { enabled: true },
  }
  let saved: ModuleFormProp | undefined
  const moduleForms = {
    getConfig: async () => ({ formKey: 'lead', formProp: original, fields: [] }),
    saveFormProp: async (_tenant: string, _module: string, formProp: ModuleFormProp) => {
      saved = formProp
      return { formKey: 'lead', formProp, fields: [] }
    },
  } as unknown as ModuleFormsService
  const service = new MetadataService(moduleForms)
  const leadStages = [
    { key: 'NEW', name: '待联系', kind: 'ACTIVE' as const, enabled: true },
    { key: 'VISITED', name: '已到访', kind: 'ACTIVE' as const, enabled: true },
  ]

  await service.updateFormProp('tenant-1', 'lead', { leadStages }, 'user-1')

  assert.deepEqual(saved, { ...original, leadStages })
})

test('首页分析 PATCH 在 Lead 与 Customer 各自表单属性中保持模块归属', async () => {
  const original: ModuleFormProp = {
    layout: 2,
    labelPos: 'left',
    leadUniqueScope: 'RESOURCE_POOL',
    leadStages: [{ key: 'NEW', name: '待联系', kind: 'ACTIVE', enabled: true }],
    futureFlag: { enabled: true },
  }
  const customerOriginal: ModuleFormProp = {
    layout: 2,
    futureCustomerFlag: true,
  }
  const saved = new Map<string, ModuleFormProp>()
  const moduleForms = {
    getConfig: async (_tenant: string, module: string) => ({
      formKey: module,
      formProp: module === 'customer' ? customerOriginal : original,
      fields: [],
    }),
    saveFormProp: async (_tenant: string, module: string, formProp: ModuleFormProp) => {
      saved.set(module, formProp)
      return { formKey: module, formProp, fields: [] }
    },
  } as unknown as ModuleFormsService
  const service = new MetadataService(moduleForms)
  const leadAnalytics = { leadSourceFieldKey: 'cf_source' }
  const customerAnalytics = {
    customerResultFieldKey: 'cf_status',
    customerResultValues: ['PAID'],
    customerResultTimeFieldKey: 'cf_paid_at',
    customerResultAmountFieldKey: 'cf_amount',
  }

  await service.updateFormProp('tenant-1', 'lead', { homeAnalytics: leadAnalytics }, 'user-1')
  await service.updateFormProp('tenant-1', 'customer', { homeAnalytics: customerAnalytics }, 'user-1')

  assert.deepEqual(saved.get('lead'), { ...original, homeAnalytics: leadAnalytics })
  assert.deepEqual(saved.get('customer'), {
    ...customerOriginal,
    homeAnalytics: customerAnalytics,
  })
})
