import type { FieldVO, FormAlertConfig, ModuleFormProp } from '@micromatrix/shared'

export const DEFAULT_ALERT_TEXT = '家长手机号为全局查重主键，重复录入将被拦截并提示归属人。'

export const DEFAULT_ALERT_CONFIG = {
  icon: 'info',
  text: DEFAULT_ALERT_TEXT,
  color: '#409eff',
  fontSize: 14,
} as const

/** Alert 为纯展示组件，仅保存在 formProp，不生成或修改任何业务字段。 */
export function createAlertField(alert: FormAlertConfig, module = 'lead'): FieldVO {
  return {
    id: `alert:${alert.id}`,
    key: `alert:${alert.id}`,
    module,
    label: 'Alert 提示',
    type: 'alert',
    required: false,
    system: false,
    hidden: false,
    mobile: true,
    options: null,
    config: {
      alertIcon: alert.icon,
      alertText: alert.text,
      alertColor: alert.color,
      alertFontSize: alert.fontSize,
    },
    sort: alert.position,
    span: 24,
    showInList: false,
    listWidth: null,
    origin: 'CUSTOM',
  }
}

export function mergeAlertFields(fields: FieldVO[], formProp?: ModuleFormProp): FieldVO[] {
  const result = [...fields]
  for (const alert of [...(formProp?.alerts ?? [])].sort((a, b) => a.position - b.position)) {
    const position = Number.isInteger(alert.position) ? alert.position : result.length
    result.splice(
      Math.max(0, Math.min(position, result.length)),
      0,
      createAlertField(alert, fields[0]?.module),
    )
  }
  return result
}

export function serializeAlertFields(fields: FieldVO[]): FormAlertConfig[] {
  return fields.flatMap((field, position) => {
    if (field.type !== 'alert') return []
    return [
      {
        id:
          field.id.startsWith('alert:') || field.id.startsWith('draft:')
            ? field.id.slice(field.id.indexOf(':') + 1)
            : field.id,
        position,
        icon: field.config?.alertIcon || DEFAULT_ALERT_CONFIG.icon,
        text: field.config?.alertText || DEFAULT_ALERT_CONFIG.text,
        color: field.config?.alertColor || DEFAULT_ALERT_CONFIG.color,
        fontSize: field.config?.alertFontSize ?? DEFAULT_ALERT_CONFIG.fontSize,
      },
    ]
  })
}
