export function isLarkBrowser(userAgent = window.navigator.userAgent): boolean {
  const normalized = userAgent.toLowerCase()
  return normalized.includes('feishu') || normalized.includes('lark')
}
