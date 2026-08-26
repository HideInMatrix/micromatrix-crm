import type { EnterpriseUiStyle, EnterpriseUiTheme } from '@micromatrix/shared'

interface EnterpriseUiThemeSetting {
  theme: EnterpriseUiTheme
  customTheme: string
  style: EnterpriseUiStyle
  customStyle: string
}

const PRIMARY_VARS = [
  '--el-color-primary',
  '--el-color-primary-light-3',
  '--el-color-primary-light-5',
  '--el-color-primary-light-7',
  '--el-color-primary-light-8',
  '--el-color-primary-light-9',
  '--el-color-primary-dark-2',
] as const

function mix(hex: string, target: '#ffffff' | '#000000', weight: number) {
  const parse = (value: string) =>
    [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16))
  const [r, g, b] = parse(hex)
  const [tr, tg, tb] = parse(target)
  const channel = (from: number, to: number) => Math.round(from + (to - from) * weight)
  return `#${[channel(r, tr), channel(g, tg), channel(b, tb)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
}

export function applyEnterpriseUiTheme(setting: EnterpriseUiThemeSetting) {
  const root = document.documentElement
  const primary = setting.theme === 'custom' ? setting.customTheme : ''
  if (!primary) {
    PRIMARY_VARS.forEach((name) => root.style.removeProperty(name))
  } else {
    root.style.setProperty('--el-color-primary', primary)
    root.style.setProperty('--el-color-primary-light-3', mix(primary, '#ffffff', 0.3))
    root.style.setProperty('--el-color-primary-light-5', mix(primary, '#ffffff', 0.5))
    root.style.setProperty('--el-color-primary-light-7', mix(primary, '#ffffff', 0.7))
    root.style.setProperty('--el-color-primary-light-8', mix(primary, '#ffffff', 0.8))
    root.style.setProperty('--el-color-primary-light-9', mix(primary, '#ffffff', 0.9))
    root.style.setProperty('--el-color-primary-dark-2', mix(primary, '#000000', 0.2))
  }

  if (setting.style === 'custom') {
    root.style.setProperty('--el-bg-color-page', setting.customStyle)
  } else if (setting.style === 'follow' && primary) {
    root.style.setProperty('--el-bg-color-page', mix(primary, '#ffffff', 0.96))
  } else {
    root.style.removeProperty('--el-bg-color-page')
  }
}
