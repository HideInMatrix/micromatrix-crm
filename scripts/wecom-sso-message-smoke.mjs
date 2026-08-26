import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = resolve(root, 'apps/api')
const apiPort = 3012
const fixturePort = 4012
const apiBase = `http://127.0.0.1:${apiPort}/api`
const stamp = Date.now().toString(36)
const memberEmail = `w33-member-${stamp}@smoke.local`
let messageAttempts = 0
let apiOutput = ''

const fixture = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${fixturePort}`)
  response.setHeader('Content-Type', 'application/json')
  if (url.pathname === '/cgi-bin/gettoken') {
    response.end(JSON.stringify({ errcode: 0, errmsg: 'ok', access_token: 'fixture-token' }))
    return
  }
  if (url.pathname === '/cgi-bin/agent/get') {
    response.end(JSON.stringify({ errcode: 0, errmsg: 'ok', agentid: 1000001 }))
    return
  }
  if (url.pathname === '/cgi-bin/department/list') {
    response.end(
      JSON.stringify({
        errcode: 0,
        department: [
          { id: 1, name: 'W3.3 隔离企业', parentid: 0, order: 100 },
          { id: 2, name: '销售部', parentid: 1, order: 80 },
        ],
      }),
    )
    return
  }
  if (url.pathname === '/cgi-bin/user/list') {
    response.end(
      JSON.stringify({
        errcode: 0,
        userlist:
          url.searchParams.get('department_id') === '2'
            ? [
                {
                  userid: 'w33-member',
                  name: 'W3.3 企微成员',
                  email: memberEmail,
                  mobile: '13800000033',
                  department: [2],
                  main_department: 2,
                  is_leader_in_dept: [1],
                },
              ]
            : [],
      }),
    )
    return
  }
  if (url.pathname === '/cgi-bin/auth/getuserinfo') {
    const code = url.searchParams.get('code')
    response.end(
      JSON.stringify(
        code === 'unknown-code'
          ? { errcode: 0, UserId: 'unknown-member' }
          : code === 'workbench-code'
            ? { errcode: 0, UserId: 'w33-member', user_ticket: 'workbench-ticket' }
            : { errcode: 0, UserId: 'w33-member' },
      ),
    )
    return
  }
  if (url.pathname === '/cgi-bin/auth/getuserdetail') {
    for await (const _chunk of request) {
      // 消费请求体，模拟 user_ticket 换取工作台授权资料。
    }
    response.end(
      JSON.stringify({
        errcode: 0,
        userid: 'w33-member',
        mobile: '13800000034',
        avatar: 'https://fixture.local/w33-avatar.png',
        gender: 2,
      }),
    )
    return
  }
  if (url.pathname === '/cgi-bin/message/send') {
    for await (const _chunk of request) {
      // 消费请求体，模拟真实 HTTP 服务。
    }
    messageAttempts += 1
    response.end(
      JSON.stringify(
        messageAttempts === 1
          ? { errcode: 45009, errmsg: 'api freq out of limit' }
          : { errcode: 0, errmsg: 'ok', msgid: `fixture-message-${messageAttempts}` },
      ),
    )
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ errcode: 404, errmsg: 'not found' }))
})

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ✓ ${message}`)
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...(options.body && typeof options.body !== 'string'
      ? { body: JSON.stringify(options.body) }
      : {}),
  })
  const text = await response.text()
  const body = (() => {
    try {
      return text ? JSON.parse(text) : null
    } catch {
      return text
    }
  })()
  return { response, body }
}

async function waitForApi() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${apiBase}/health`)
      if (response.ok) return
    } catch {
      // API 仍在启动。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error(`API 启动超时\n${apiOutput.slice(-4_000)}`)
}

async function waitForDelivery(headers, expectedStatus) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await request('/message-deliveries?page=1&pageSize=20&event=CUSTOMER_ADD', {
      headers,
    })
    const item = result.body?.items?.[0]
    if (item?.status === expectedStatus) return item
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`等待投递状态 ${expectedStatus} 超时`)
}

await new Promise((resolveListen) => fixture.listen(fixturePort, '127.0.0.1', resolveListen))
const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: apiDir,
  env: {
    ...process.env,
    PORT: String(apiPort),
    SWAGGER_ENABLED: 'false',
    WECOM_API_BASE_URL: `http://127.0.0.1:${fixturePort}`,
    WECOM_LOGIN_BASE_URL: `http://127.0.0.1:${fixturePort}/wwlogin/sso/login`,
    WEB_PUBLIC_URL: 'http://127.0.0.1:5173',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
api.stdout.on('data', (chunk) => {
  apiOutput += String(chunk)
})
api.stderr.on('data', (chunk) => {
  apiOutput += String(chunk)
})

try {
  console.log('== W3.3 企微统一登录与消息通道 Smoke ==')
  await waitForApi()
  const registration = await request('/auth/register', {
    method: 'POST',
    body: {
      tenantName: `W3.3隔离租户-${stamp}`,
      name: 'W3.3 管理员',
      email: `w33-admin-${stamp}@smoke.local`,
      password: 'smoke123',
    },
  })
  assert(registration.response.ok && registration.body.accessToken, '隔离租户注册成功')
  const tenantSlug = registration.body.user.tenantSlug
  const adminHeaders = { Authorization: `Bearer ${registration.body.accessToken}` }

  const defaultRole = await request('/roles', {
    method: 'POST',
    headers: adminHeaders,
    body: {
      name: '企微默认成员',
      permissions: ['menu:customer'],
      dataScope: 'SELF',
      remark: 'W3.3 smoke',
    },
  })
  const departments = await request('/departments/tree', { headers: adminHeaders })
  const localMember = await request('/members', {
    method: 'POST',
    headers: adminHeaders,
    body: {
      email: memberEmail,
      name: '本地待绑定成员',
      password: 'localpass123',
      roleIds: [defaultRole.body.id],
      deptId: departments.body[0].id,
    },
  })
  assert(localMember.response.ok, '本地成员创建成功')

  await request('/enterprise-integrations/wecom', {
    method: 'PUT',
    headers: adminHeaders,
    body: { corpId: 'ww-fixture', agentId: '1000001', appSecret: 'fixture-secret' },
  })
  const tested = await request('/enterprise-integrations/wecom/test', {
    method: 'POST',
    headers: adminHeaders,
    body: { corpId: 'ww-fixture', agentId: '1000001' },
  })
  assert(tested.body.success, '企业微信连接测试通过')
  await request('/enterprise-integrations/wecom/sync', {
    method: 'PUT',
    headers: adminHeaders,
    body: { enabled: true, defaultRoleId: defaultRole.body.id },
  })
  const preview = await request('/organization-sync/wecom/previews', {
    method: 'POST',
    headers: adminHeaders,
    body: { targetDepartmentId: departments.body[0].id },
  })
  const conflicts = await request(
    `/organization-sync/wecom/batches/${preview.body.id}/items?action=CONFLICT&pageSize=20`,
    { headers: adminHeaders },
  )
  await request(`/organization-sync/wecom/batches/${preview.body.id}/resolutions`, {
    method: 'PUT',
    headers: adminHeaders,
    body: {
      items: [
        {
          itemId: conflicts.body.items[0].id,
          resolution: 'BIND',
          localId: localMember.body.id,
        },
      ],
    },
  })
  const applied = await request(`/organization-sync/wecom/batches/${preview.body.id}/apply`, {
    method: 'POST',
    headers: adminHeaders,
  })
  assert(applied.body.status === 'SUCCEEDED', 'W3.2 成员映射作为登录和消息唯一来源')

  const discovery = await request(`/auth/wecom/discovery?tenant=${tenantSlug}`)
  assert(discovery.body.available && discovery.body.corpId === 'ww-fixture', '登录页可发现企微入口')
  const started = await request('/auth/wecom/start', {
    method: 'POST',
    body: { tenantSlug, returnPath: '/customers' },
  })
  const nonceCookie = started.response.headers.get('set-cookie')?.split(';')[0]
  assert(started.body.state && nonceCookie, 'OAuth state 与 HttpOnly 浏览器 cookie 已签发')
  const callback = await request('/auth/wecom/callback', {
    method: 'POST',
    headers: { Cookie: nonceCookie },
    body: { code: 'valid-code', state: started.body.state },
  })
  assert(callback.response.ok && callback.body.returnPath === '/customers', '企微回调签发本地 JWT')
  const replay = await request('/auth/wecom/callback', {
    method: 'POST',
    headers: { Cookie: nonceCookie },
    body: { code: 'valid-code', state: started.body.state },
  })
  assert(replay.response.status === 401, '已消费 state 无法重放')

  const workbenchStarted = await request('/auth/wecom/workbench/start', {
    method: 'POST',
    body: { tenantSlug, returnPath: '/home' },
  })
  const workbenchCookie = workbenchStarted.response.headers.get('set-cookie')?.split(';')[0]
  const workbenchUrl = new URL(
    workbenchStarted.body.authorizationUrl.replace('#wechat_redirect', ''),
  )
  assert(
    workbenchStarted.body.state.startsWith('wecom.') &&
      workbenchUrl.pathname === '/connect/oauth2/authorize' &&
      workbenchUrl.searchParams.get('scope') === 'snsapi_privateinfo' &&
      workbenchCookie,
    '工作台 H5 使用独立 wecom state、nonce 和 privateinfo OAuth 地址',
  )
  const crossFlow = await request('/auth/wecom/callback', {
    method: 'POST',
    headers: { Cookie: workbenchCookie },
    body: { code: 'workbench-code', state: workbenchStarted.body.state },
  })
  assert(crossFlow.response.status === 401, '工作台 state 不能进入 PC 扫码回调')
  const workbenchCallback = await request('/auth/wecom/workbench/callback', {
    method: 'POST',
    headers: { Cookie: workbenchCookie },
    body: { code: 'workbench-code', state: workbenchStarted.body.state },
  })
  assert(
    workbenchCallback.response.ok &&
      workbenchCallback.body.returnPath === '/home' &&
      workbenchCallback.body.user.gender === true &&
      workbenchCallback.body.user.avatarUrl === 'https://fixture.local/w33-avatar.png',
    '工作台回调签发本地 JWT 并补充授权成员资料',
  )

  const identity = await request(`/external-identities/wecom/users/${localMember.body.id}`, {
    headers: adminHeaders,
  })
  assert(identity.body.status === 'ACTIVE', '成员企微登录身份已自动绑定')
  const loginLogs = await request('/logs/logins?page=1&pageSize=30', { headers: adminHeaders })
  assert(
    loginLogs.body.items.some((item) => item.authType === 'WECOM' && item.success),
    '企微成功登录写入认证类型审计',
  )

  const enabled = await request('/message-settings/CUSTOMER_ADD', {
    method: 'PATCH',
    headers: adminHeaders,
    body: { module: 'CUSTOMER', weComEnabled: true },
  })
  assert(enabled.body.weComEnabled, '客户新增场景企业微信通道已开启')
  const customer = await request('/customers', {
    method: 'POST',
    headers: adminHeaders,
    body: {
      name: `W3.3 消息客户-${stamp}`,
      ownerId: localMember.body.id,
      customData: {},
    },
  })
  assert(customer.response.ok, '业务操作成功且不被企微通道失败影响')
  const failedDelivery = await waitForDelivery(adminHeaders, 'FAILED')
  assert(failedDelivery.attempts === 1, '临时错误进入可重试投递审计')
  await request(`/message-deliveries/${failedDelivery.id}/retry`, {
    method: 'POST',
    headers: adminHeaders,
  })
  const succeededDelivery = await waitForDelivery(adminHeaders, 'SUCCEEDED')
  assert(succeededDelivery.providerMessageId, '手工重试后消息投递成功')

  const unbound = await request(`/external-identities/wecom/users/${localMember.body.id}/unbind`, {
    method: 'POST',
    headers: adminHeaders,
  })
  assert(unbound.body.status === 'REVOKED', '有密码登录方式的成员可安全解绑企微身份')
  const rebound = await request(`/external-identities/wecom/users/${localMember.body.id}/bind`, {
    method: 'POST',
    headers: adminHeaders,
  })
  assert(rebound.body.status === 'ACTIVE', '管理员可按同步映射恢复企微身份')

  console.log('== W3.3 Smoke 全部通过 ==')
} catch (error) {
  console.error(error)
  console.error(apiOutput.slice(-6_000))
  process.exitCode = 1
} finally {
  api.kill('SIGTERM')
  await new Promise((resolveClose) => fixture.close(resolveClose))
}
