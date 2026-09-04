const MOBILE_USER_AGENT_PATTERN =
  /Mobile|Android|iPhone|iPod|iPad|MicroMessenger|wxwork|DingTalk|Lark/i

export function isMobileUserAgent(userAgent: string): boolean {
  return MOBILE_USER_AGENT_PATTERN.test(userAgent)
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return isMobileUserAgent(navigator.userAgent)
}

interface DeviceRedirectOptions {
  targetOrigin?: string
}

function buildTargetUrl(pathname: string, targetOrigin?: string): string {
  const url = new URL(pathname, targetOrigin ?? window.location.origin)
  url.search = window.location.search
  url.hash = window.location.hash
  return url.toString()
}

export function redirectMobileDeviceToMobileApp(options: DeviceRedirectOptions = {}): void {
  if (typeof window === 'undefined' || !isMobileDevice()) return
  if (window.location.pathname.startsWith('/mobile')) return
  window.location.replace(buildTargetUrl('/mobile/', options.targetOrigin))
}

export function redirectDesktopDeviceToWebApp(options: DeviceRedirectOptions = {}): void {
  if (typeof window === 'undefined' || isMobileDevice()) return
  if (!window.location.pathname.startsWith('/mobile')) return
  window.location.replace(buildTargetUrl('/', options.targetOrigin))
}
