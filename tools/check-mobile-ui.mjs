import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const mobileSrcDir = join(rootDir, 'apps/mobile/src')
const mobileStylesDir = join(mobileSrcDir, 'styles')

const violations = []
const sourceRules = [
  {
    name: '禁止原生 select，统一使用 Vant Picker/Popup',
    pattern: /<select(?:\s|>)/i,
  },
  {
    name: '禁止原生 input，统一使用 Vant Field/Picker',
    pattern: /<input(?:\s|>)/i,
  },
  {
    name: '禁止原生 button，统一使用 Vant Button',
    pattern: /<button(?:\s|>)/i,
  },
  {
    name: '禁止 Mobile SFC 页面级 style，视觉样式使用 UnoCSS presetWind4 utility',
    pattern: /<style(?:\s|>)/i,
  },
  {
    name: '禁止自定义 crm-* 页面样式类',
    pattern: /class\s*=\s*["'][^"']*\bcrm-[\w-]*/i,
  },
  {
    name: '禁止 top-bar 语义 CSS 类，直接使用 UnoCSS utility',
    pattern: /class\s*=\s*["'][^"']*\btop-bar\b/i,
  },
  {
    name: '禁止 filter-buttons 语义 CSS 类，直接使用 UnoCSS utility',
    pattern: /class\s*=\s*["'][^"']*\bfilter-buttons\b/i,
  },
]

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else files.push(path)
  }
  return files
}

function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length
}

for (const file of await walk(mobileSrcDir)) {
  if (!['.vue', '.ts', '.tsx', '.js', '.jsx'].includes(extname(file))) continue
  const content = await readFile(file, 'utf8')
  for (const rule of sourceRules) {
    const match = rule.pattern.exec(content)
    if (!match) continue
    violations.push(
      `${relative(rootDir, file)}:${lineNumber(content, match.index)} ${rule.name}`,
    )
  }
}

for (const file of await walk(mobileStylesDir)) {
  if (extname(file) !== '.css') continue
  const content = await readFile(file, 'utf8')
  const match = /\.crm-[\w-]+/.exec(content)
  if (match) {
    violations.push(
      `${relative(rootDir, file)}:${lineNumber(content, match.index)} 禁止在 Mobile 全局 CSS 中新增 crm-* 页面样式类`,
    )
  }
}

if (violations.length) {
  console.error('Mobile UI 规范检查失败：')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Mobile UI 规范检查通过：Vant UI + UnoCSS presetWind4')
