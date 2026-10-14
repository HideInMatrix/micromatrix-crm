import assert from 'node:assert/strict'
import test from 'node:test'
import type { FieldVO, ModuleQuickSearchConfig } from '@micromatrix/shared'
import { buildQuickSearchPayload } from '../../apps/web/src/utils/quick-search-query'

const fields = [
  { key: 'name', label: '学生姓名', type: 'text', hidden: false },
  { key: 'phone', label: '手机号', type: 'phone', hidden: false },
  { key: 'notes', label: '备注', type: 'textarea', hidden: true },
  { key: 'grade', label: '年级', type: 'select', hidden: false },
] as FieldVO[]

test('同一个关键字命中手机号或学生姓名即进入 OR 组，旧单字段查询保持独立', () => {
  const config: ModuleQuickSearchConfig = {
    enabled: true,
    showAdvancedFilter: true,
    showSavedViews: true,
    items: [
      {
        id: 'keyword',
        kind: 'field',
        label: '关键字',
        fieldKey: 'name',
        fieldKeys: ['phone'],
        operator: 'contains',
      },
      { id: 'grade', kind: 'field', label: '年级', fieldKey: 'grade', operator: 'eq' },
    ],
  }
  assert.deepEqual(buildQuickSearchPayload(config, fields, { keyword: ' 张三 ', grade: '3' }), {
    filters: [{ key: 'grade', op: 'eq', value: '3' }],
    quickGroups: [
      {
        mode: 'OR',
        conditions: [
          { key: 'name', op: 'contains', value: '张三' },
          { key: 'phone', op: 'contains', value: '张三' },
        ],
      },
    ],
  })
  assert.deepEqual(
    buildQuickSearchPayload(config, fields, { keyword: '1381234' }).quickGroups[0]?.conditions,
    [
      { key: 'name', op: 'contains', value: '1381234' },
      { key: 'phone', op: 'contains', value: '1381234' },
    ],
  )
})

test('输入框没有额外字段时兼容单字段；多个控件和预设正确构成独立条件', () => {
  const config: ModuleQuickSearchConfig = {
    enabled: true,
    showAdvancedFilter: true,
    showSavedViews: true,
    items: [
      { id: 'name', kind: 'field', label: '姓名', fieldKey: 'name', operator: 'contains' },
      {
        id: 'keyword',
        kind: 'field',
        label: '查询',
        fieldKey: 'phone',
        fieldKeys: ['name', 'notes'],
        operator: 'eq',
      },
      {
        id: 'preset',
        kind: 'preset_select',
        label: '预设',
        options: [
          {
            id: 'active',
            label: '指定',
            searchMode: 'AND',
            conditions: [{ key: 'grade', op: 'eq', value: '3' }],
          },
        ],
      },
    ],
  }
  assert.deepEqual(
    buildQuickSearchPayload(config, fields, { name: '李', keyword: '138', preset: 'active' }),
    {
      filters: [{ key: 'name', op: 'contains', value: '李' }],
      quickGroups: [
        {
          mode: 'OR',
          conditions: [
            { key: 'phone', op: 'eq', value: '138' },
            { key: 'name', op: 'eq', value: '138' },
          ],
        },
        { mode: 'AND', conditions: [{ key: 'grade', op: 'eq', value: '3' }] },
      ],
    },
  )
})
