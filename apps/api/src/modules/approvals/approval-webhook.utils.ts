import { BlockList, isIP } from 'node:net'
import type { ApprovalWebhookConfig } from '@micromatrix/shared'

export const APPROVAL_WEBHOOK_HEADER_MAX_BYTES = 16 * 1024
export const APPROVAL_WEBHOOK_BODY_MAX_BYTES = 64 * 1024
export const APPROVAL_WEBHOOK_RESPONSE_MAX_BYTES = 64 * 1024
export const APPROVAL_WEBHOOK_TIMEOUT_MS = 5_000

const BLOCKED_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const nonPublicAddresses = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:db8::', 32],
  ['2001:10::', 28],
  ['2002::', 16],
  ['3fff::', 20],
] as const) {
  nonPublicAddresses.addSubnet(network, prefix, 'ipv6')
}

const loopbackAddresses = new BlockList()
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
loopbackAddresses.addAddress('::1', 'ipv6')

export class ApprovalWebhookConfigError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApprovalWebhookConfigError'
  }
}

export function normalizeApprovalWebhookConfig(
  config: ApprovalWebhookConfig | undefined,
): ApprovalWebhookConfig | undefined {
  if (!config) return undefined
  return {
    webHookEnable: Boolean(config.webHookEnable),
    webHookUrl: config.webHookUrl.trim(),
    webHookMethod: config.webHookMethod,
    webHookHeader: config.webHookHeader.trim(),
    webHookBody: config.webHookBody.trim(),
    webHookDescribe: config.webHookDescribe.trim(),
  }
}

export function validateApprovalWebhookConfig(config: ApprovalWebhookConfig | undefined) {
  if (!config) return
  const normalized = normalizeApprovalWebhookConfig(config)!
  if (Buffer.byteLength(normalized.webHookHeader, 'utf8') > APPROVAL_WEBHOOK_HEADER_MAX_BYTES) {
    throw new ApprovalWebhookConfigError('HEADER_TOO_LARGE', 'Webhook 请求头不能超过 16 KiB')
  }
  if (Buffer.byteLength(normalized.webHookBody, 'utf8') > APPROVAL_WEBHOOK_BODY_MAX_BYTES) {
    throw new ApprovalWebhookConfigError('BODY_TOO_LARGE', 'Webhook 请求体不能超过 64 KiB')
  }

  if (normalized.webHookHeader) parseApprovalWebhookHeaders(normalized.webHookHeader)
  if (normalized.webHookBody && normalized.webHookMethod === 'POST') {
    parseApprovalWebhookJsonBody(normalized.webHookBody)
  }

  if (!normalized.webHookEnable) return
  if (!normalized.webHookUrl) {
    throw new ApprovalWebhookConfigError('URL_REQUIRED', '启用 Webhook 后地址不能为空')
  }
  parseApprovalWebhookUrl(normalized.webHookUrl)
  if (normalized.webHookMethod === 'POST' && !normalized.webHookBody) {
    throw new ApprovalWebhookConfigError('BODY_REQUIRED', 'POST Webhook 请求体不能为空')
  }
}

export function parseApprovalWebhookUrl(rawUrl: string) {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ApprovalWebhookConfigError('INVALID_URL', 'Webhook 地址格式无效')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApprovalWebhookConfigError('INVALID_PROTOCOL', 'Webhook 仅允许 HTTP/HTTPS')
  }
  if (!url.hostname) {
    throw new ApprovalWebhookConfigError('INVALID_HOST', 'Webhook 地址缺少主机名')
  }
  if (url.username || url.password) {
    throw new ApprovalWebhookConfigError('URL_USERINFO_FORBIDDEN', 'Webhook 地址禁止包含用户名或密码')
  }
  if (url.hash) {
    throw new ApprovalWebhookConfigError('URL_FRAGMENT_FORBIDDEN', 'Webhook 地址禁止包含 fragment')
  }
  return url
}

export function parseApprovalWebhookHeaders(raw: string): Record<string, string> {
  if (!raw.trim()) return {}
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new ApprovalWebhookConfigError('INVALID_HEADERS', 'Webhook 请求头必须是合法 JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApprovalWebhookConfigError('INVALID_HEADERS', 'Webhook 请求头必须是 JSON 对象')
  }
  const result: Record<string, string> = {}
  for (const [name, headerValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedName = name.trim().toLowerCase()
    if (!normalizedName || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalizedName)) {
      throw new ApprovalWebhookConfigError('INVALID_HEADER_NAME', 'Webhook 请求头包含非法名称')
    }
    if (BLOCKED_REQUEST_HEADERS.has(normalizedName) || normalizedName.startsWith('proxy-')) {
      throw new ApprovalWebhookConfigError('FORBIDDEN_HEADER', `Webhook 禁止配置请求头 ${name}`)
    }
    if (typeof headerValue !== 'string' || /[\r\n]/.test(headerValue)) {
      throw new ApprovalWebhookConfigError('INVALID_HEADER_VALUE', `Webhook 请求头 ${name} 必须是单行字符串`)
    }
    result[normalizedName] = headerValue
  }
  return result
}

export function parseApprovalWebhookJsonBody(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new ApprovalWebhookConfigError('INVALID_BODY', 'Webhook POST 请求体必须是合法 JSON')
  }
}

export function isLoopbackWebhookAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return loopbackAddresses.check(address, 'ipv4')
  if (family === 6) return loopbackAddresses.check(address, 'ipv6')
  return false
}

export function isPublicWebhookAddress(address: string): boolean {
  const mapped = mappedIpv4Address(address)
  if (mapped) return isPublicWebhookAddress(mapped)
  const family = isIP(address)
  if (family === 4) return !nonPublicAddresses.check(address, 'ipv4')
  if (family === 6) return !nonPublicAddresses.check(address, 'ipv6')
  return false
}

function mappedIpv4Address(address: string): string | null {
  const normalized = address.toLowerCase()
  if (!normalized.startsWith('::ffff:')) return null
  const tail = normalized.slice('::ffff:'.length)
  if (isIP(tail) === 4) return tail
  const groups = tail.split(':')
  if (groups.length !== 2) return null
  const high = Number.parseInt(groups[0], 16)
  const low = Number.parseInt(groups[1], 16)
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) return null
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
}

export function allowApprovalWebhookLoopbackForTest(address: string): boolean {
  return (
    process.env.NODE_ENV === 'test' &&
    process.env.APPROVAL_WEBHOOK_TEST_ALLOW_LOOPBACK === '1' &&
    isLoopbackWebhookAddress(address)
  )
}
