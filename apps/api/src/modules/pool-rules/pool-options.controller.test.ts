import assert from 'node:assert/strict'
import test from 'node:test'
import { toResourcePoolOption } from './pool-options.controller'

test('池 options facade 将直接模型映射为现有页面只读契约', () => {
  const option = toResourcePoolOption('lead', {
    id: 'pool-1',
    name: '线索池',
    scopeId: JSON.stringify(['user:u1']),
    organizationId: 'org-1',
    ownerId: JSON.stringify(['user:m1']),
    enable: true,
    auto: true,
    createTime: 1n,
    updateTime: 1n,
    createUser: 'u1',
    updateUser: 'u1',
    hiddenFields: [{ fieldId: 'field-1' }],
    pickRule: {
      limitOnNumber: true,
      pickNumber: 3,
      limitPreOwner: true,
      pickIntervalDays: 7,
      limitNew: false,
      newPickInterval: null,
    },
    recycleRule: {
      operator: 'OR',
      condition: JSON.stringify([
        {
          column: 'followUpTime',
          operator: 'DYNAMICS',
          value: '7',
        },
      ]),
    },
  })

  assert.deepEqual(option, {
    id: 'pool-1',
    module: 'lead',
    name: '线索池',
    scopeIds: ['user:u1'],
    managerIds: ['user:m1'],
    enabled: true,
    autoRecycle: true,
    hiddenFieldIds: ['field-1'],
    pickRule: {
      limitDailyPick: true,
      dailyPickLimit: 3,
      limitPreviousOwner: true,
      previousOwnerCooldownDays: 7,
      limitNewData: false,
      newDataCooldownDays: null,
    },
    recycleRule: {
      operator: 'OR',
      conditions: [{ column: 'followUpTime', operator: 'DYNAMICS', value: '7' }],
    },
  })
})
