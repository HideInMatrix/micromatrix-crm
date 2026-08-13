/** 生成业务单号：如 QT20260813-4F2A（前缀 + 日期 + 随机段） */
export function generateBizCode(prefix: string): string {
  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  const random = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${prefix}${date}-${random}`
}
