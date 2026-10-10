import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModuleFormProp, QuickSearchQueryGroup } from '@micromatrix/shared'
import { resolveQuickSearchGroupIds, validateQuickSearchGroups } from '../../common/quick-search-groups'
import { MetadataService } from './metadata.service'
import type { ModuleFormsService } from './module-forms.service'

test('预设下拉选项内部 OR、多个下拉控件之间 AND，结果不错误展平', async () => {
  const groups: QuickSearchQueryGroup[] = [
    { mode: 'OR', conditions: [
      { key: 'name', op: 'contains', value: '张' },
      { key: 'phone', op: 'contains', value: '138' },
    ] },
    { mode: 'AND', conditions: [{ key: 'name', op: 'contains', value: '学生' }] },
  ]
  const result = await resolveQuickSearchGroupIds(groups, async (conditions, mode) => {
    if (mode === 'OR') return ['a', 'b', 'c']
    assert.equal(conditions[0]?.value, '学生')
    return ['b', 'd']
  })
  assert.deepEqual(result, ['b'])
  const fieldList = [
    { key: 'name', type: 'text', hidden: false },
    { key: 'phone', type: 'phone', hidden: false },
  ] as import('@micromatrix/shared').FieldVO[]
  assert.deepEqual(validateQuickSearchGroups(groups, fieldList), groups)
  assert.throws(() => validateQuickSearchGroups([
    { mode: 'OR', conditions: [{ key: 'unknown', op: 'eq', value: 'x' }] },
  ], fieldList), /不存在的字段/)
})

test('PC 快捷搜索 PATCH 校验字段与操作符且保留其它 formProp', async () => {
  const original: ModuleFormProp = { layout: 2, futureFlag: { enabled: true } }
  let saved: ModuleFormProp | undefined
  const fields = [{ key: 'name', label: '姓名', type: 'text', hidden: false }]
  const moduleForms = {
    getConfig: async () => ({ formKey: 'lead', formProp: original, fields }),
    saveFormProp: async (_tenant: string, _module: string, value: ModuleFormProp) => {
      saved = value
      return { formProp: value, fields }
    },
  } as unknown as ModuleFormsService
  const service = new MetadataService(moduleForms)
  const quickSearch = {
    enabled: true,
    showAdvancedFilter: false,
    showSavedViews: false,
    items: [{ id: 'name', kind: 'field' as const, label: '姓名', fieldKey: 'name', operator: 'contains' as const }],
  }
  await service.updateFormProp('tenant-a', 'lead', { quickSearch }, 'admin')
  assert.deepEqual(saved, { ...original, quickSearch })
  await assert.rejects(service.updateFormProp('tenant-a', 'lead', {
    quickSearch: { ...quickSearch, items: [{ ...quickSearch.items[0]!, fieldKey: 'not_exists' }] },
  }, 'admin'), /字段不存在/)
  await assert.rejects(service.updateFormProp('tenant-a', 'lead', {
    quickSearch: { ...quickSearch, items: [{ ...quickSearch.items[0]!, operator: 'gte' }] },
  }, 'admin'), /操作符不支持/)
  await assert.rejects(service.updateFormProp('tenant-a', 'lead', {
    quickSearch: {
      ...quickSearch,
      items: [{ id: 'old-keyword', kind: 'keyword' as unknown as 'field', label: '旧版关键词框' }],
    },
  }, 'admin'), /快捷搜索项无效或重复/)
})

test('一个预设下拉框的选项能保存 AND/OR 多条件组合，非法字段被拒绝', async () => {
  const current: ModuleFormProp = { layout: 2 }
  let saved: ModuleFormProp | null = null
  const fields = [
    { key: 'name', label: '学生姓名', type: 'text', hidden: false },
    { key: 'phone', label: '联系电话', type: 'phone', hidden: false },
  ]
  const moduleForms = {
    getConfig: async () => ({ formKey: 'lead', formProp: current, fields }),
    saveFormProp: async (_tenant: string, _module: string, formProp: ModuleFormProp) => {
      saved = formProp
      return { formKey: 'lead', formProp, fields }
    },
  } as unknown as ModuleFormsService
  const service = new MetadataService(moduleForms)
  const quickSearch = {
    enabled: true, showAdvancedFilter: false, showSavedViews: false,
    items: [{
      id: 'quick-select', kind: 'preset_select' as const, label: '重点学生',
      options: [{
        id: 'focus', label: '需要联系', searchMode: 'OR' as const,
        conditions: [
          { key: 'name', op: 'contains' as const, value: '张' },
          { key: 'phone', op: 'contains' as const, value: '138' },
        ],
      }],
    }],
  }
  await service.updateFormProp('tenant-a', 'lead', { quickSearch }, 'admin')
  assert.deepEqual(saved, { ...current, quickSearch })
  await assert.rejects(service.updateFormProp('tenant-a', 'lead', {
    quickSearch: { ...quickSearch, items: [{
      ...quickSearch.items[0]!, options: [{
        ...quickSearch.items[0]!.options[0]!,
        conditions: [{ key: 'missing', op: 'eq', value: '1' }],
      }],
    }] },
  }, 'admin'), /不存在的字段/)
})

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
