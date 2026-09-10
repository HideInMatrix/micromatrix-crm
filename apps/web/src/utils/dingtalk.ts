export function isDingTalkWorkbenchBrowser(userAgent = window.navigator.userAgent): boolean {
  return userAgent.toLowerCase().includes('dingtalk')
}
