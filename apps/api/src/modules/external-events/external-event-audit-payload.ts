/** Preserve business request parameters for audit while excluding credentials.
 * OperationLogBlobs are retained according to the system operation-log policy.
 */
const SECRET_FIELD =
  /(?:password|passwd|pwd|secret|token|authorization|credential|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)/i
const MAX_DEPTH = 8
const MAX_ITEMS = 100
const MAX_STRING_LENGTH = 16_384
const MAX_JSON_LENGTH = 128_000

export function auditExternalEventRequest(payload: Record<string, unknown>): unknown {
  function sanitize(value: unknown, depth: number): unknown {
    if (depth >= MAX_DEPTH) return '[嵌套层级过深]'
    if (typeof value === 'string') {
      return value.length > MAX_STRING_LENGTH
        ? value.slice(0, MAX_STRING_LENGTH) + '[内容已截断]'
        : value
    }
    if (Array.isArray(value)) {
      return [
        ...value.slice(0, MAX_ITEMS).map((item) => sanitize(item, depth + 1)),
        ...(value.length > MAX_ITEMS ? ['[数组其余元素已省略]'] : []),
      ]
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value)
      const cleaned = Object.fromEntries(
        entries
          .slice(0, MAX_ITEMS)
          .map(([key, item]) => [
            key,
            SECRET_FIELD.test(key) ? '[已脱敏]' : sanitize(item, depth + 1),
          ]),
      )
      if (entries.length > MAX_ITEMS) cleaned['__omittedFields'] = entries.length - MAX_ITEMS
      return cleaned
    }
    return value ?? null
  }
  const safe = sanitize(payload, 0)
  const json = JSON.stringify(safe)
  return json.length > MAX_JSON_LENGTH
    ? { __truncated: true, preview: json.slice(0, MAX_JSON_LENGTH) }
    : safe
}
