export function isWeComWorkbenchBrowser(userAgent = window.navigator.userAgent): boolean {
  return userAgent.toLowerCase().includes('wxwork')
}
