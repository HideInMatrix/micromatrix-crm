import type { EnterpriseUiStyle, EnterpriseUiTheme } from '@micromatrix/shared'

interface EnterpriseUiThemeSetting {
  theme: EnterpriseUiTheme
  customTheme: string
  style: EnterpriseUiStyle
  customStyle: string
}

const PRIMARY_VARS = [
  '--primary-0',
  '--primary-1',
  '--primary-2',
  '--primary-3',
  '--primary-4',
  '--primary-5',
  '--primary-6',
  '--primary-7',
  '--primary-8',
  '--van-primary-color',
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

export function useEnterpriseUiTheme() {
  function applyEnterpriseUiTheme(setting: EnterpriseUiThemeSetting) {
    const root = document.documentElement
    const primary = setting.theme === 'custom' ? setting.customTheme : ''
    if (!primary) {
      PRIMARY_VARS.forEach((name) => root.style.removeProperty(name))
    } else {
      root.style.setProperty('--primary-0', mix(primary, '#000000', 0.15))
      root.style.setProperty('--primary-1', mix(primary, '#ffffff', 0.15))
      root.style.setProperty('--primary-2', mix(primary, '#ffffff', 0.3))
      root.style.setProperty('--primary-3', mix(primary, '#ffffff', 0.4))
      root.style.setProperty('--primary-4', mix(primary, '#ffffff', 0.7))
      root.style.setProperty('--primary-5', mix(primary, '#ffffff', 0.8))
      root.style.setProperty('--primary-6', mix(primary, '#ffffff', 0.9))
      root.style.setProperty('--primary-7', mix(primary, '#ffffff', 0.95))
      root.style.setProperty('--primary-8', primary)
      root.style.setProperty('--van-primary-color', primary)
    }

    if (setting.style === 'custom') {
      root.style.setProperty('--mobile-page-background', setting.customStyle)
    } else if (setting.style === 'follow' && primary) {
      root.style.setProperty('--mobile-page-background', mix(primary, '#ffffff', 0.96))
    } else {
      root.style.removeProperty('--mobile-page-background')
    }
  }

  return { applyEnterpriseUiTheme }
}
