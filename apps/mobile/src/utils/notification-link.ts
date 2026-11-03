/** 将服务端/PC 通知链接转换为移动端路由，并保留业务深链参数。 */
export function resolveMobileNotificationPath(link: string): string | null {
  if (!link.startsWith('/')) return null

  const url = new URL(link, 'https://lore-mobile.invalid')
  let path = url.pathname

  // 兼容已带移动端部署前缀的通知链接。
  if (path.startsWith('/mobile/')) path = path.slice('/mobile'.length)

  // 新格式：/leads?id=xxx、/customers?id=xxx。
  if ((path === '/leads' || path === '/customers') && url.searchParams.has('id')) {
    path = `${path}/detail`
  } else {
    // 兼容历史通知：/leads/:id、/customers/:id。
    // 静态路由（detail/create/pool-detail）不能误判为业务 ID。
    const legacyDetail = path.match(/^\/(leads|customers)\/([^/]+)$/)
    if (legacyDetail) {
      const [, resource, rawId] = legacyDetail
      const reserved = resource === 'leads'
        ? new Set(['detail', 'create', 'pool-detail'])
        : new Set(['detail', 'create'])

      if (!reserved.has(rawId)) {
        if (!url.searchParams.has('id')) {
          try {
            url.searchParams.set('id', decodeURIComponent(rawId))
          } catch {
            url.searchParams.set('id', rawId)
          }
        }
        path = `/${resource}/detail`
      }
    }
  }

  const supported =
    path === '/home' ||
    path === '/leads' ||
    path === '/leads/detail' ||
    path === '/leads/pool-detail' ||
    path === '/leads/create' ||
    path === '/customers' ||
    path === '/customers/detail' ||
    path === '/customers/create' ||
    path === '/follow-plans' ||
    path === '/mine' ||
    path === '/mine/message' ||
    path === '/mine/basic-info' ||
    path === '/mine/change-password' ||
    path === '/search' ||
    path === '/select/search' ||
    /^\/leads\/[^/]+\/(edit|convert)$/.test(path) ||
    /^\/customers\/[^/]+\/edit$/.test(path)

  // PC 专属页面在移动端没有对应视图时，不要落入兜底路由后静默回首页。
  if (!supported) return null

  return `${path}${url.search}${url.hash}`
}
