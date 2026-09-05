import { CHINA_PCD, COUNTRIES_TREE, getCountriesByLevel } from './location-data/options.js'
import type { LocationOption } from './location-data/types.js'

export type LocationScope = 'ALL' | 'CN'
export type LocationType = 'C' | 'P' | 'PC' | 'PCD' | 'detail'

export interface ParsedLocationValue {
  code: string
  detail: string
}

export function getLocationOptions(
  scope: LocationScope = 'ALL',
  locationType: LocationType = 'PCD',
): LocationOption[] {
  return getCountriesByLevel(locationType, scope) as LocationOption[]
}

const locationPathByCode = new Map<string, string[]>()

function indexLocationTree(nodes: LocationOption[], parent: string[] = []) {
  for (const node of nodes) {
    const path = [...parent, node.label]
    locationPathByCode.set(node.value, path)
    if (node.children?.length) indexLocationTree(node.children, path)
  }
}

indexLocationTree([CHINA_PCD as LocationOption, ...COUNTRIES_TREE])

export function splitLocationValue(value: unknown): ParsedLocationValue | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const [code = '', ...detailParts] = value.trim().split('-')
  if (!code) return null
  return { code, detail: detailParts.join('-') }
}

export function locationPath(code: string): string[] | null {
  return locationPathByCode.get(code) ?? null
}

const scopedPathCache = new Map<string, Map<string, string[]>>()

function scopedLocationPath(
  code: string,
  scope: LocationScope,
  locationType: LocationType,
): string[] | null {
  const cacheKey = `${scope}:${locationType}`
  let pathMap = scopedPathCache.get(cacheKey)
  if (!pathMap) {
    pathMap = new Map(
      flattenOptions(getLocationOptions(scope, locationType)).map((item) => [item.code, item.path]),
    )
    scopedPathCache.set(cacheKey, pathMap)
  }
  return pathMap.get(code) ?? null
}

export function formatLocationValue(
  value: unknown,
  separator = '/',
  detailSeparator = ' ',
  scope: LocationScope = 'ALL',
  locationType: LocationType = 'PCD',
): string {
  const parsed = splitLocationValue(value)
  if (!parsed) return ''
  const path = scopedLocationPath(parsed.code, scope, locationType) ?? locationPath(parsed.code)
  const base = path?.join(separator) ?? parsed.code
  return parsed.detail ? `${base}${detailSeparator}${parsed.detail}` : base
}

function flattenOptions(nodes: LocationOption[], parent: string[] = []) {
  const output: Array<{ code: string; path: string[] }> = []
  for (const node of nodes) {
    const path = [...parent, node.label]
    output.push({ code: node.value, path })
    if (node.children?.length) output.push(...flattenOptions(node.children, path))
  }
  return output
}

const parserCache = new Map<string, Array<{ code: string; aliases: string[] }>>()

function parserEntries(scope: LocationScope, locationType: LocationType) {
  const cacheKey = `${scope}:${locationType}`
  const cached = parserCache.get(cacheKey)
  if (cached) return cached
  const entries = flattenOptions(getLocationOptions(scope, locationType))
    .map(({ code, path }) => ({
      code,
      aliases: [path.join('/'), path.join('>'), path.join(' '), path.join('-')],
    }))
    .sort(
      (a, b) =>
        Math.max(...b.aliases.map((item) => item.length)) -
        Math.max(...a.aliases.map((item) => item.length)),
    )
  parserCache.set(cacheKey, entries)
  return entries
}

export function isLocationCodeAllowed(
  code: string,
  scope: LocationScope = 'ALL',
  locationType: LocationType = 'PCD',
): boolean {
  return flattenOptions(getLocationOptions(scope, locationType)).some((item) => item.code === code)
}

/**
 * 将 Excel/文本中的可读地区转换回 Cordys-compatible `<code>-<detail>`。
 * 同时接受已经是合法编码的值，便于 API 集成。
 */
export function parseLocationText(
  value: unknown,
  scope: LocationScope = 'ALL',
  locationType: LocationType = 'PCD',
): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  const direct = splitLocationValue(text)
  if (direct && isLocationCodeAllowed(direct.code, scope, locationType)) return text

  for (const entry of parserEntries(scope, locationType)) {
    for (const alias of entry.aliases) {
      if (text === alias) return `${entry.code}-`
      if (locationType === 'detail') {
        for (const detailSeparator of [' ', '-']) {
          if (text.startsWith(`${alias}${detailSeparator}`)) {
            return `${entry.code}-${text.slice(alias.length + detailSeparator.length)}`
          }
        }
      }
    }
  }
  return null
}

export type { LocationOption }
