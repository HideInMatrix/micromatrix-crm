import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDataSourceRecordLinks,
  evaluateFormRuntime,
  type DataSourceRecordVO,
  type FieldVO,
} from '@micromatrix/shared'

function field(
  overrides: Partial<FieldVO> & Pick<FieldVO, 'id' | 'key' | 'label' | 'type'>,
): FieldVO {
  return {
    module: 'runtime-test',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: null,
    subFields: null,
    ...overrides,
  }
}

test('显隐规则按多个控制字段 OR 命中且 permanent hidden 优先', () => {
  const target = field({ id: 'target', key: 'cf_target', label: '目标', type: 'text' })
  const alwaysHidden = field({
    id: 'always-hidden',
    key: 'cf_hidden',
    label: '永久隐藏',
    type: 'text',
    hidden: true,
  })
  const a = field({
    id: 'a',
    key: 'cf_a',
    label: '控制A',
    type: 'select',
    config: { showControlRules: [{ value: 'yes', fieldIds: [target.id, alwaysHidden.id] }] },
  })
  const b = field({
    id: 'b',
    key: 'cf_b',
    label: '控制B',
    type: 'select',
    config: { showControlRules: [{ value: 'open', fieldIds: [target.id] }] },
  })

  const state = evaluateFormRuntime([a, b, target, alwaysHidden], {
    cf_a: 'no',
    cf_b: 'open',
  })
  assert.equal(state.visibleByFieldId[target.id], true)
  assert.equal(state.visibleByFieldId[alwaysHidden.id], false)
})

test('AUTO 联动写入目标字段并支持级联', () => {
  const a = field({
    id: 'a',
    key: 'cf_a',
    label: 'A',
    type: 'select',
    options: [{ label: '一', value: '1' }],
    config: {
      linkProp: {
        targetField: 'b',
        linkOptions: [{ current: '1', method: 'AUTO', target: '2' }],
      },
    },
  })
  const b = field({
    id: 'b',
    key: 'cf_b',
    label: 'B',
    type: 'select',
    options: [{ label: '二', value: '2' }],
    config: {
      linkProp: {
        targetField: 'c',
        linkOptions: [{ current: '2', method: 'AUTO', target: ['3'] }],
      },
    },
  })
  const c = field({
    id: 'c',
    key: 'cf_c',
    label: 'C',
    type: 'multiselect',
    options: [{ label: '三', value: '3' }],
  })

  const state = evaluateFormRuntime([a, b, c], { cf_a: '1' })
  assert.equal(state.values.cf_b, '2')
  assert.deepEqual(state.values.cf_c, ['3'])
})

test('HIDDEN 联动只限制目标可选范围而不改变字段可见性', () => {
  const source = field({
    id: 'source',
    key: 'cf_source',
    label: '来源',
    type: 'select',
    config: {
      linkProp: {
        targetField: 'target',
        linkOptions: [{ current: 'a', method: 'HIDDEN', target: ['x', 'y'] }],
      },
    },
  })
  const target = field({ id: 'target', key: 'cf_target', label: '目标', type: 'multiselect' })
  const state = evaluateFormRuntime([source, target], { cf_source: 'a', cf_target: ['x'] })
  assert.deepEqual(state.optionRangesByFieldId[target.id], ['x', 'y'])
  assert.equal(state.visibleByFieldId[target.id], true)
  assert.deepEqual(state.values.cf_target, ['x'])
})

test('显隐控制支持多选控制字段包含匹配', () => {
  const target = field({ id: 'target', key: 'cf_target', label: '目标', type: 'text' })
  const source = field({
    id: 'source',
    key: 'cf_source',
    label: '来源',
    type: 'multiselect',
    config: { showControlRules: [{ value: 'b', fieldIds: [target.id] }] },
  })
  const state = evaluateFormRuntime([source, target], { cf_source: ['a', 'b'] })
  assert.equal(state.visibleByFieldId[target.id], true)
})

test('MULTISELECT 字段联动按完整选择集合命中，不把子集误判为命中', () => {
  const source = field({
    id: 'source-link-multi',
    key: 'cf_source_link_multi',
    label: '来源',
    type: 'multiselect',
    config: {
      linkProp: {
        targetField: 'target-link-multi',
        linkOptions: [{ current: ['a', 'b'], method: 'AUTO', target: 'x' }],
      },
    },
  })
  const target = field({
    id: 'target-link-multi',
    key: 'cf_target_link_multi',
    label: '目标',
    type: 'select',
    options: [{ label: 'X', value: 'x' }],
  })

  assert.equal(
    evaluateFormRuntime([source, target], { cf_source_link_multi: ['a'] }).values
      .cf_target_link_multi,
    undefined,
  )
  assert.equal(
    evaluateFormRuntime([source, target], { cf_source_link_multi: ['a', 'b'] }).values
      .cf_target_link_multi,
    'x',
  )
})

test('DATA_SOURCE linkFields 按字段类型填充并按选项标签映射目标值', () => {
  const sourceName = field({
    id: 'source-name',
    key: 'cf_source_name',
    label: '来源名称',
    type: 'text',
  })
  const sourceStatus = field({
    id: 'source-status',
    key: 'cf_source_status',
    label: '来源状态',
    type: 'select',
    options: [{ label: '重点', value: 'important' }],
  })
  const targetName = field({
    id: 'target-name',
    key: 'cf_target_name',
    label: '目标名称',
    type: 'text',
  })
  const targetStatus = field({
    id: 'target-status',
    key: 'cf_target_status',
    label: '目标状态',
    type: 'select',
    options: [{ label: '重点', value: 'priority' }],
  })
  const dataSource = field({
    id: 'data-source',
    key: 'cf_data_source',
    label: '数据源',
    type: 'data_source',
    config: {
      dataSourceType: 'source-form',
      linkFields: [
        { current: targetName.id, link: sourceName.id, method: 'fill', enable: true },
        { current: targetStatus.id, link: sourceStatus.id, method: 'fill', enable: true },
      ],
    },
  })
  const record: DataSourceRecordVO = {
    id: 'row-1',
    name: '来源记录',
    fields: [sourceName, sourceStatus],
    values: {
      [sourceName.id]: '来源名称值',
      [sourceStatus.id]: 'important',
    },
  }

  const values = applyDataSourceRecordLinks(
    [dataSource, targetName, targetStatus],
    dataSource,
    record,
    { cf_data_source: record.id },
  )
  assert.equal(values.cf_target_name, '来源名称值')
  assert.equal(values.cf_target_status, 'priority')
})

test('DATA_SOURCE childLinkFields 按源 SUB_PRODUCT 行重建目标子表', () => {
  const sourceQty = field({ id: 'source-qty', key: 'cf_source_qty', label: '数量', type: 'number' })
  const sourceTag = field({
    id: 'source-tag',
    key: 'cf_source_tag',
    label: '标签',
    type: 'select',
    options: [{ label: '重点', value: 'important' }],
  })
  const sourceParent = field({
    id: 'source-parent',
    key: 'cf_source_parent',
    label: '来源明细',
    type: 'sub_product',
    subFields: [sourceQty, sourceTag],
  })
  const targetQty = field({ id: 'target-qty', key: 'cf_target_qty', label: '数量', type: 'number' })
  const targetTag = field({
    id: 'target-tag',
    key: 'cf_target_tag',
    label: '标签',
    type: 'select',
    options: [{ label: '重点', value: 'priority' }],
  })
  const targetParent = field({
    id: 'target-parent',
    key: 'cf_target_parent',
    label: '目标明细',
    type: 'sub_product',
    subFields: [targetQty, targetTag],
  })
  const dataSource = field({
    id: 'data-source-child',
    key: 'cf_data_source_child',
    label: '数据源',
    type: 'data_source',
    config: {
      dataSourceType: 'source-form',
      childLinkFields: [
        {
          current: targetParent.id,
          link: sourceParent.id,
          method: 'fill',
          enable: true,
          childLinks: [
            {
              current: targetQty.id,
              link: sourceQty.id,
              method: 'fill',
              enable: true,
              childLinks: [],
            },
            {
              current: targetTag.id,
              link: sourceTag.id,
              method: 'fill',
              enable: true,
              childLinks: [],
            },
          ],
        },
      ],
    },
  })
  const record: DataSourceRecordVO = {
    id: 'row-child-1',
    name: '来源记录',
    fields: [sourceParent],
    values: {
      [sourceParent.id]: [
        { cf_source_qty: 2, cf_source_tag: 'important' },
        { cf_source_qty: 3, cf_source_tag: 'important' },
      ],
    },
  }

  const values = applyDataSourceRecordLinks([dataSource, targetParent], dataSource, record, {
    cf_data_source_child: record.id,
  })
  assert.deepEqual(values.cf_target_parent, [
    { cf_target_qty: 2, cf_target_tag: 'priority' },
    { cf_target_qty: 3, cf_target_tag: 'priority' },
  ])
})
