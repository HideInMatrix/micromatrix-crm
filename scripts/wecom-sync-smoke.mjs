import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = resolve(root, 'apps/api')
const apiPort = 3011
const fixturePort = 4011
const apiBase = `http://127.0.0.1:${apiPort}/api`
let phase = 1
let apiOutput = ''
const stamp = Date.now().toString(36)
const boundEmail = `bound.user.${stamp}@smoke.local`
const createdEmail = `created.user.${stamp}@smoke.local`

const fixture = createServer((request, response) => {
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
        errmsg: 'ok',
        department: [
          { id: 1, name: '企微隔离企业', parentid: 0, order: 100 },
          { id: 2, name: phase === 1 ? '企微销售部' : '企微销售中心', parentid: 1, order: 80 },
        ],
      }),
    )
    return
  }
  if (url.pathname === '/cgi-bin/user/list') {
    const departmentId = url.searchParams.get('department_id')
    const users =
      departmentId === '2'
        ? [
            {
              userid: 'bound-user',
              name: phase === 1 ? '企微绑定成员' : '企微绑定成员已更新',
              email: boundEmail,
              mobile: '13800000001',
              position: '销售主管',
              department: [2],
              main_department: 2,
              is_leader_in_dept: [1],
            },
            ...(phase === 1
              ? [
                  {
                    userid: 'created-user',
                    name: '企微新增成员',
                    email: createdEmail,
                    mobile: '13800000002',
                    position: '销售专员',
                    department: [2],
                    main_department: 2,
                    is_leader_in_dept: [0],
                  },
                ]
              : []),
          ]
        : []
    response.end(JSON.stringify({ errcode: 0, errmsg: 'ok', userlist: users }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ errcode: 404, errmsg: 'not found' }))
})

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ✓ ${message}`)
}

function findDepartmentByName(nodes, name) {
  for (const node of nodes ?? []) {
    if (node.name === name) return node
    const child = findDepartmentByName(node.children, name)
    if (child) return child
  }
  return null
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
  const body = text ? JSON.parse(text) : null
  return { response, body }
}

async function waitForApi() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${apiBase}/health`)
      if (response.ok) return
    } catch {
      // API 仍在启动。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`API 启动超时\n${apiOutput.slice(-4_000)}`)
}

await new Promise((resolveListen) => fixture.listen(fixturePort, '127.0.0.1', resolveListen))
const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: apiDir,
  env: {
    ...process.env,
    PORT: String(apiPort),
    SWAGGER_ENABLED: 'false',
    WECOM_API_BASE_URL: `http://127.0.0.1:${fixturePort}`,
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
  console.log('== W3.2 企业微信组织同步 Smoke ==')
  await waitForApi()
  const registration = await request('/auth/register', {
    method: 'POST',
    body: {
      tenantName: `W3.2隔离租户-${stamp}`,
      name: 'W3.2 管理员',
      email: `w32-admin-${stamp}@smoke.local`,
      password: 'smoke123',
    },
  })
  assert(registration.response.ok && registration.body.accessToken, '隔离租户注册成功')
  const adminHeaders = { Authorization: `Bearer ${registration.body.accessToken}` }

  const roles = await request('/roles', { headers: adminHeaders })
  const rootRole = roles.body.find((role) => role.isSystem)
  const defaultRoleResponse = await request('/roles', {
    method: 'POST',
    headers: adminHeaders,
    body: {
      name: '企微默认成员',
      permissions: ['system:dept'],
      dataScope: 'SELF',
      remark: 'W3.2 smoke',
    },
  })
  assert(defaultRoleResponse.response.ok, '新成员默认角色创建成功')
  const defaultRole = defaultRoleResponse.body

  const departments = await request('/departments/tree', { headers: adminHeaders })
  const rootDepartment = departments.body[0]
  const localMemberResponse = await request('/members', {
    method: 'POST',
    headers: adminHeaders,
    body: {
      email: boundEmail,
      name: '本地待绑定成员',
      password: 'localpass123',
      roleIds: [defaultRole.id],
      deptId: rootDepartment.id,
    },
  })
  assert(localMemberResponse.response.ok, '本地冲突成员创建成功')
  const localMember = localMemberResponse.body

  const localLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: boundEmail, password: 'localpass123' },
  })
  const localHeaders = { Authorization: `Bearer ${localLogin.body.accessToken}` }
  const forbiddenStatus = await request('/organization-sync/wecom/status', {
    headers: localHeaders,
  })
  assert(forbiddenStatus.response.status === 403, '无 system:dept:sync 权限成员不能读取同步状态')

  const saveConfig = await request('/enterprise-integrations/wecom', {
    method: 'PUT',
    headers: adminHeaders,
    body: { corpId: 'ww-fixture', agentId: '1000001', appSecret: 'fixture-secret' },
  })
  assert(saveConfig.response.ok && saveConfig.body.secretConfigured, '企微配置保存且响应脱敏')
  const testConfig = await request('/enterprise-integrations/wecom/test', {
    method: 'POST',
    headers: adminHeaders,
    body: { corpId: 'ww-fixture', agentId: '1000001' },
  })
  assert(testConfig.response.ok && testConfig.body.success, '企微连接测试通过')
  const enableSync = await request('/enterprise-integrations/wecom/sync', {
    method: 'PUT',
    headers: adminHeaders,
    body: { enabled: true, defaultRoleId: defaultRole.id },
  })
  assert(enableSync.response.ok && enableSync.body.syncEnabled, '同步开关与默认角色保存成功')

  const firstPreview = await request('/organization-sync/wecom/previews', {
    method: 'POST',
    headers: adminHeaders,
    body: { targetDepartmentId: rootDepartment.id },
  })
  assert(
    firstPreview.response.ok &&
      firstPreview.body.status === 'PREVIEW_READY' &&
      firstPreview.body.counts.conflict === 1,
    '首次预览识别新增、更新和邮箱冲突',
  )
  const conflictItems = await request(
    `/organization-sync/wecom/batches/${firstPreview.body.id}/items?action=CONFLICT&pageSize=20`,
    { headers: adminHeaders },
  )
  const conflict = conflictItems.body.items[0]
  assert(conflict?.externalId === 'bound-user', '冲突项指向企微待绑定成员')
  const keywordItems = await request(
    `/organization-sync/wecom/batches/${firstPreview.body.id}/items?keyword=${encodeURIComponent('企微绑定成员')}&pageSize=20`,
    { headers: adminHeaders },
  )
  assert(keywordItems.response.ok && keywordItems.body.total === 1, '同步差异支持按资源名称搜索')
  const resolveConflict = await request(
    `/organization-sync/wecom/batches/${firstPreview.body.id}/resolutions`,
    {
      method: 'PUT',
      headers: adminHeaders,
      body: {
        items: [{ itemId: conflict.id, resolution: 'BIND', localId: localMember.id }],
      },
    },
  )
  assert(
    resolveConflict.response.ok && resolveConflict.body.counts.conflict === 0,
    '冲突绑定后批次可应用',
  )

  const firstApply = await request(
    `/organization-sync/wecom/batches/${firstPreview.body.id}/apply`,
    { method: 'POST', headers: adminHeaders },
  )
  assert(firstApply.response.ok && firstApply.body.status === 'SUCCEEDED', '首次同步原子应用成功')
  const repeatedApply = await request(
    `/organization-sync/wecom/batches/${firstPreview.body.id}/apply`,
    { method: 'POST', headers: adminHeaders },
  )
  assert(
    repeatedApply.response.ok && repeatedApply.body.status === 'SUCCEEDED',
    '重复应用成功批次保持幂等',
  )

  const memberList = await request('/members?page=1&pageSize=100', { headers: adminHeaders })
  const bound = memberList.body.items.find((member) => member.id === localMember.id)
  const created = memberList.body.items.find((member) => member.email === createdEmail)
  assert(bound?.name === '企微绑定成员' && bound.roles.length === 1, '绑定成员更新资料且保留原角色')
  assert(
    created?.status === 'ACTIVE' && created.roles[0]?.id === defaultRole.id,
    '企微新成员获得默认角色',
  )
  const generatedPasswordLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: createdEmail, password: 'smoke123' },
  })
  assert(generatedPasswordLogin.response.status === 401, '企微新成员不能使用普通密码登录')

  const firstTree = await request('/departments/tree', { headers: adminHeaders })
  const salesDepartment = findDepartmentByName(firstTree.body, '企微销售部')
  assert(salesDepartment?.leaderId === localMember.id, '企微部门负责人同步成功')

  phase = 2
  const secondPreview = await request('/organization-sync/wecom/previews', {
    method: 'POST',
    headers: adminHeaders,
    body: { targetDepartmentId: rootDepartment.id },
  })
  assert(
    secondPreview.response.ok && secondPreview.body.counts.disable === 1,
    '后续预览只禁用企微中缺失的已映射成员',
  )
  const secondApply = await request(
    `/organization-sync/wecom/batches/${secondPreview.body.id}/apply`,
    { method: 'POST', headers: adminHeaders },
  )
  assert(secondApply.response.ok && secondApply.body.status === 'SUCCEEDED', '后续同步应用成功')
  const secondMembers = await request('/members?page=1&pageSize=100', { headers: adminHeaders })
  const disabled = secondMembers.body.items.find((member) => member.id === created.id)
  assert(disabled?.status === 'DISABLED', '企微缺失的映射成员已禁用且记录保留')

  const notifications = await request('/notifications?page=1&pageSize=20', {
    headers: adminHeaders,
  })
  assert(
    notifications.body.items.some((item) => item.title === '企业微信组织架构同步完成'),
    '同步完成站内通知已送达操作人',
  )
  await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  const logs = await request('/logs/operations?page=1&pageSize=100&module=organizationSync', {
    headers: adminHeaders,
  })
  assert(
    logs.body.items.some((item) => item.action === 'applyWeCom'),
    '同步应用操作日志已记录',
  )
  assert(rootRole.permissions.includes('*'), '隔离租户系统管理员权限保持完整')

  console.log('== W3.2 Smoke 全部通过 ==')
} catch (error) {
  console.error(error)
  console.error(apiOutput.slice(-4_000))
  process.exitCode = 1
} finally {
  api.kill('SIGTERM')
  await new Promise((resolveClose) => fixture.close(resolveClose))
}
