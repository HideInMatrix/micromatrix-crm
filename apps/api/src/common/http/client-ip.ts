import { isIP } from 'node:net'

const MAX_TRUST_PROXY_HOPS = 10

export function parseTrustProxyHops(value: string | undefined): false | number {
  const normalized = value?.trim()
  if (!normalized || normalized === '0') return false
  if (!/^\d+$/.test(normalized)) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10')
  }

  const hops = Number(normalized)
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > MAX_TRUST_PROXY_HOPS) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 10')
  }
  return hops === 0 ? false : hops
}

export function normalizeClientIp(ip: string | undefined): string | undefined {
  const normalized = ip?.trim()
  if (!normalized) return undefined

  const mappedPrefix = '::ffff:'
  if (normalized.toLowerCase().startsWith(mappedPrefix)) {
    const ipv4 = normalized.slice(mappedPrefix.length)
    if (isIP(ipv4) === 4) return ipv4
  }

  return normalized
}
