import assert from 'node:assert/strict'
import test from 'node:test'
import type { FieldVO, ModuleFormProp } from '@micromatrix/shared'
import {
  DEFAULT_ALERT_TEXT,
  mergeAlertFields,
  serializeAlertFields,
} from '../src/components/form-engine/form-presentation'

function field(id: string): FieldVO {
  return {
    id,
    key: id,
    module: 'lead',
    label: id,
    type: 'text',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: {},
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: null,
  }
}

test('Alert 保存后恢复位置和样式，不改变业务字段集合', () => {
  const businessFields = [field('student'), field('phone')]
  const formProp: ModuleFormProp = {
    alerts: [
      {
        id: 'notice-a',
        position: 0,
        icon: 'info',
        text: DEFAULT_ALERT_TEXT,
        color: '#409eff',
        fontSize: 14,
      },
    ],
  }
  const combined = mergeAlertFields(businessFields, formProp)
  assert.deepEqual(
    combined.map((item) => item.type),
    ['alert', 'text', 'text'],
  )
  assert.equal(combined[0]?.config?.alertText, DEFAULT_ALERT_TEXT)
  assert.deepEqual(serializeAlertFields(combined), formProp.alerts)
  assert.deepEqual(
    combined.filter((item) => item.type !== 'alert'),
    businessFields,
  )
})

test('新建 Alert 临时 ID 序列化成后端允许的稳定 ID', () => {
  const alerts = serializeAlertFields([
    {
      ...field('draft:abcdef-1234'),
      type: 'alert',
      config: {
        alertIcon: 'triangle-alert',
        alertText: '重复录入将被拦截',
        alertColor: '#ff0000',
        alertFontSize: 16,
      },
    },
  ])
  assert.equal(alerts[0]?.id, 'abcdef-1234')
  assert.equal(alerts[0]?.position, 0)
  assert.equal(alerts[0]?.icon, 'triangle-alert')
  assert.equal(alerts[0]?.color, '#ff0000')
  assert.equal(alerts[0]?.fontSize, 16)
  assert.equal(alerts[0]?.backgroundColor, undefined)
})

test('Alert 背景色在保存与重新加载后保持一致，兼容无背景色的旧配置', () => {
  const backgroundColor = '#f7f1cc'
  const newAlert = {
    ...field('draft:background-alert'),
    type: 'alert' as const,
    config: {
      alertIcon: 'info',
      alertText: DEFAULT_ALERT_TEXT,
      alertColor: '#409eff',
      alertFontSize: 14,
      alertBackgroundColor: backgroundColor,
    },
  }
  const serialized = serializeAlertFields([newAlert])
  assert.equal(serialized[0]?.backgroundColor, backgroundColor)
  const restored = mergeAlertFields([field('student')], { alerts: serialized })
  assert.equal(restored[0]?.config?.alertBackgroundColor, backgroundColor)
  assert.deepEqual(serializeAlertFields(restored), serialized)

  const oldConfig: ModuleFormProp = {
    alerts: [
      { id: 'old-notice', position: 0, icon: 'info', text: '提示', color: '#409eff', fontSize: 14 },
    ],
  }
  const oldAlert = mergeAlertFields([field('student')], oldConfig)
  assert.equal(oldAlert[0]?.config?.alertBackgroundColor, undefined)
  assert.deepEqual(serializeAlertFields(oldAlert), oldConfig.alerts)
})

test('多 Alert 排序及移除后不会残留旧展示项', () => {
  const businessFields = [field('student'), field('phone')]
  const config: ModuleFormProp = {
    alerts: [
      { id: 'last', position: 3, icon: 'bell', text: '后置', color: '#222222', fontSize: 14 },
      { id: 'first', position: 0, icon: 'info', text: '前置', color: '#333333', fontSize: 13 },
    ],
  }
  const merged = mergeAlertFields(businessFields, config)
  assert.deepEqual(
    merged.map((item) => item.id),
    ['alert:first', 'student', 'phone', 'alert:last'],
  )
  const withoutFirst = merged.filter((item) => item.id !== 'alert:first')
  assert.deepEqual(serializeAlertFields(withoutFirst), [
    { id: 'last', position: 2, icon: 'bell', text: '后置', color: '#222222', fontSize: 14 },
  ])
})
