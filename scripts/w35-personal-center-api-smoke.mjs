import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')
const bcrypt = requireFromApi('bcryptjs')

const base = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`)
  }
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('缺少 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })

async function login(email, password) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json().catch(() => null)
  return { response, data }
}

async function request(method, path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  const data = (() => {
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  })()
  return { response, data, text }
}

async function apiKeyRequest(method, path, accessKey, secretKey, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'X-Access-Key': accessKey,
      'X-Secret-Key': secretKey,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  const data = (() => {
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  })()
  return { response, data, text }
}

console.log('\nW3.5 用户个人中心 API Smoke')

const original = await prisma.user.findFirst({
  where: { email: 'admin@demo.com' },
  select: {
    id: true,
    tenantId: true,
    email: true,
    phone: true,
    passwordHash: true,
    defaultPwd: true,
    authVersion: true,
    updatedAt: true,
  },
})
if (!original) throw new Error('缺少 admin@demo.com')

const manager = await prisma.user.findFirst({
  where: { email: 'zhangwei@demo.com' },
  select: { id: true, phone: true },
})
if (!manager) throw new Error('缺少 zhangwei@demo.com')

const stamp = Date.now().toString(36)
const tempEmail = `personal-${stamp}@example.com`
const tempPhone = `139${String(Date.now()).slice(-8)}`.slice(0, 11)
const duplicatePhone = '13800009999'
const crossTenantPhone = `137${String(Date.now() + 17).slice(-8)}`.slice(0, 11)
const tempPassword = `Tmp${String(Date.now()).slice(-6)}`
let crossTenantId = ''
let crossTenantUserId = ''
let apiKeyRoleId = ''
let apiKeyUserId = ''
let apiKeyReadRoleId = ''
let apiKeyReadUserId = ''
let foreignApiKeyId = ''

try {
  if (!manager.phone) {
    await prisma.user.update({ where: { id: manager.id }, data: { phone: duplicatePhone } })
  }

  const adminLogin = await login('admin@demo.com', 'admin123')
  check('管理员可登录个人中心验收账号', adminLogin.response.ok && Boolean(adminLogin.data?.accessToken))
  const token = adminLogin.data?.accessToken ?? ''

  const removedLegacyApiToken = await request('POST', '/auth/api-token', token)
  check(
    '企业设置旧 365 天 API Token 接口已破坏性移除',
    removedLegacyApiToken.response.status === 404,
    removedLegacyApiToken.text,
  )

  const info = await request('GET', '/personal/center/info', token)
  check(
    'GET /personal/center/info 返回 Cordys 个人信息字段',
    info.response.ok &&
      info.data?.userName === '系统管理员' &&
      Array.isArray(info.data?.roles) &&
      'phone' in (info.data ?? {}) &&
      'departmentName' in (info.data ?? {}),
    info.text,
  )

  const updated = await request('POST', '/personal/center/update', token, {
    phone: tempPhone,
    email: tempEmail,
  })
  check(
    '个人信息可自助更新手机号和邮箱',
    updated.response.ok && updated.data?.phone === tempPhone && updated.data?.email === tempEmail,
    updated.text,
  )
  const profileLog = await prisma.operationLog.findFirst({
    where: {
      tenantId: original.tenantId,
      userId: original.id,
      module: 'systemOrganization',
      action: 'update',
      targetId: original.id,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: 'desc' },
  })
  const profileChanges = Array.isArray(profileLog?.detail?.changes)
    ? profileLog.detail.changes
    : []
  check(
    '个人信息修改写入手机号/邮箱操作日志',
    Boolean(profileLog) &&
      ['phone', 'email'].every((field) =>
        profileChanges.some((change) => change?.field === field),
      ),
    JSON.stringify(profileLog?.detail ?? null),
  )

  const me = await request('GET', '/auth/me', token)
  check('CurrentUser 同步返回 phone', me.response.ok && me.data?.phone === tempPhone, me.text)

  const duplicateEmail = await request('POST', '/personal/center/update', token, {
    phone: tempPhone,
    email: 'zhangwei@demo.com',
  })
  check('个人中心拒绝重复邮箱', duplicateEmail.response.status === 409, duplicateEmail.text)

  const duplicatePhoneResult = await request('POST', '/personal/center/update', token, {
    phone: manager.phone ?? duplicatePhone,
    email: tempEmail,
  })
  check('个人中心拒绝当前租户重复手机号', duplicatePhoneResult.response.status === 409, duplicatePhoneResult.text)

  const crossTenant = await prisma.tenant.create({
    data: { name: `W35跨租户-${stamp}`, slug: `w35-personal-${stamp}` },
  })
  crossTenantId = crossTenant.id
  const crossTenantUser = await prisma.user.create({
    data: {
      tenantId: crossTenant.id,
      name: 'W35跨租户成员',
      email: `cross-${stamp}@example.com`,
      phone: crossTenantPhone,
      passwordHash: 'not-used-by-smoke',
    },
  })
  crossTenantUserId = crossTenantUser.id
  const crossTenantDuplicatePhone = await request('POST', '/personal/center/update', token, {
    phone: crossTenantPhone,
    email: tempEmail,
  })
  check(
    '个人中心按 Cordys 全局拒绝跨租户重复手机号',
    crossTenantDuplicatePhone.response.status === 409,
    crossTenantDuplicatePhone.text,
  )

  const plans = await request('POST', '/personal/center/follow/plan/list', token, {
    current: 1,
    pageSize: 10,
  })
  check(
    '我的计划 facade 返回 Cordys Pager 且只走当前用户计划',
    plans.response.ok && Array.isArray(plans.data?.list) && plans.data?.current === 1,
    plans.text,
  )

  const apiKeyPassword = `ApiKey${String(Date.now()).slice(-6)}`
  const apiKeyPasswordHash = await bcrypt.hash(apiKeyPassword, 10)
  const apiKeyRole = await prisma.role.create({
    data: {
      tenantId: original.tenantId,
      name: `W35 API Key Full ${stamp}`,
      permissions: [
        'PERSONAL_API_KEY:READ',
        'PERSONAL_API_KEY:ADD',
        'PERSONAL_API_KEY:UPDATE',
        'PERSONAL_API_KEY:DELETE',
      ],
      dataScope: 'SELF',
    },
  })
  apiKeyRoleId = apiKeyRole.id
  const apiKeyUser = await prisma.user.create({
    data: {
      tenantId: original.tenantId,
      name: 'W35 API Key Full User',
      email: `w35-api-key-${stamp}@example.com`,
      passwordHash: apiKeyPasswordHash,
      userRoles: { create: { tenantId: original.tenantId, roleId: apiKeyRole.id } },
    },
  })
  apiKeyUserId = apiKeyUser.id

  const apiKeyReadRole = await prisma.role.create({
    data: {
      tenantId: original.tenantId,
      name: `W35 API Key Read ${stamp}`,
      permissions: ['PERSONAL_API_KEY:READ'],
      dataScope: 'SELF',
    },
  })
  apiKeyReadRoleId = apiKeyReadRole.id
  const apiKeyReadUser = await prisma.user.create({
    data: {
      tenantId: original.tenantId,
      name: 'W35 API Key Read User',
      email: `w35-api-key-read-${stamp}@example.com`,
      passwordHash: apiKeyPasswordHash,
      userRoles: { create: { tenantId: original.tenantId, roleId: apiKeyReadRole.id } },
    },
  })
  apiKeyReadUserId = apiKeyReadUser.id

  const fullLogin = await login(apiKeyUser.email, apiKeyPassword)
  const fullToken = fullLogin.data?.accessToken ?? ''
  check('API Key 全权限临时用户可登录', fullLogin.response.ok && Boolean(fullToken))

  const readLogin = await login(apiKeyReadUser.email, apiKeyPassword)
  const readToken = readLogin.data?.accessToken ?? ''
  const readList = await request('GET', '/user/api/key/list', readToken)
  check(
    'PERSONAL_API_KEY:READ 可读取自己的空列表',
    readList.response.ok && Array.isArray(readList.data) && readList.data.length === 0,
    readList.text,
  )
  const readAdd = await request('GET', '/user/api/key/add', readToken)
  check('只有 READ 权限不能新增 API Key', readAdd.response.status === 403, readAdd.text)

  for (let index = 0; index < 5; index += 1) {
    const added = await request('GET', '/user/api/key/add', fullToken)
    check(`API Key 可新增第 ${index + 1} 个`, added.response.ok, added.text)
  }
  const sixth = await request('GET', '/user/api/key/add', fullToken)
  check('每个用户最多 5 个 API Key', sixth.response.status === 409, sixth.text)

  let keyList = await request('GET', '/user/api/key/list', fullToken)
  check(
    'API Key 列表返回 Cordys 字段且数量为 5',
    keyList.response.ok &&
      keyList.data?.length === 5 &&
      [
        'id',
        'createUser',
        'accessKey',
        'secretKey',
        'createTime',
        'enable',
        'forever',
        'expireTime',
        'description',
      ].every((field) => field in keyList.data[0]),
    keyList.text,
  )
  const firstKey = keyList.data[0]

  const keyMe = await apiKeyRequest('GET', '/auth/me', firstKey.accessKey, firstKey.secretKey)
  check(
    'X-Access-Key / X-Secret-Key 可真实调用受保护 API',
    keyMe.response.ok && keyMe.data?.id === apiKeyUser.id,
    keyMe.text,
  )
  const badSecret = await apiKeyRequest('GET', '/auth/me', firstKey.accessKey, `${firstKey.secretKey}x`)
  check('错误 Secret Key 被拒绝', badSecret.response.status === 401, badSecret.text)

  const future = Date.now() + 86_400_000
  const updatedKey = await request('POST', '/user/api/key/update', fullToken, {
    id: firstKey.id,
    forever: false,
    expireTime: future,
    description: 'W35 API Key Smoke',
  })
  check('API Key 可更新描述和自定义有效期', updatedKey.response.ok, updatedKey.text)
  keyList = await request('GET', '/user/api/key/list', fullToken)
  const futureKey = keyList.data.find((item) => item.id === firstKey.id)
  check(
    '更新后列表返回自定义有效期和描述',
    futureKey?.forever === false &&
      futureKey?.description === 'W35 API Key Smoke' &&
      futureKey?.expireTime >= future - 1000,
  )

  const disabled = await request('GET', `/user/api/key/disable/${firstKey.id}`, fullToken)
  check('API Key 可停用', disabled.response.ok, disabled.text)
  const disabledCall = await apiKeyRequest('GET', '/auth/me', firstKey.accessKey, firstKey.secretKey)
  check('停用 API Key 立即失效', disabledCall.response.status === 401, disabledCall.text)
  const enabled = await request('GET', `/user/api/key/enable/${firstKey.id}`, fullToken)
  check('API Key 可重新启用', enabled.response.ok, enabled.text)
  const enabledCall = await apiKeyRequest('GET', '/auth/me', firstKey.accessKey, firstKey.secretKey)
  check('重新启用 API Key 可继续调用', enabledCall.response.ok, enabledCall.text)

  const expiredUpdate = await request('POST', '/user/api/key/update', fullToken, {
    id: firstKey.id,
    forever: false,
    expireTime: Date.now() - 60_000,
    description: 'expired',
  })
  check('API Key 可设置自定义到期时间', expiredUpdate.response.ok, expiredUpdate.text)
  const expiredCall = await apiKeyRequest('GET', '/auth/me', firstKey.accessKey, firstKey.secretKey)
  check('已过期 API Key 被拒绝', expiredCall.response.status === 401, expiredCall.text)
  const foreverUpdate = await request('POST', '/user/api/key/update', fullToken, {
    id: firstKey.id,
    forever: true,
    description: 'forever',
  })
  check('API Key 可恢复永久有效', foreverUpdate.response.ok, foreverUpdate.text)
  const foreverCall = await apiKeyRequest('GET', '/auth/me', firstKey.accessKey, firstKey.secretKey)
  check('恢复永久有效后 API Key 再次可用', foreverCall.response.ok, foreverCall.text)

  const foreignKey = await prisma.userApiKey.create({
    data: {
      userId: apiKeyReadUser.id,
      accessKey: `ak_foreign_${stamp}`,
      secretKey: `sk_foreign_${stamp}`,
    },
  })
  foreignApiKeyId = foreignKey.id
  const crossDelete = await request('GET', `/user/api/key/delete/${foreignKey.id}`, fullToken)
  check('API Key 删除严格按当前用户隔离', crossDelete.response.status === 404, crossDelete.text)
  const foreignStillExists = await prisma.userApiKey.findUnique({ where: { id: foreignKey.id } })
  check('越权删除不会影响其他用户 Key', Boolean(foreignStillExists))

  const removedKey = await request('GET', `/user/api/key/delete/${firstKey.id}`, fullToken)
  check('API Key 可删除', removedKey.response.ok, removedKey.text)
  keyList = await request('GET', '/user/api/key/list', fullToken)
  check('删除后本人列表减少为 4 个', keyList.response.ok && keyList.data?.length === 4, keyList.text)

  const apiKeyLogs = await prisma.operationLog.count({
    where: { userId: apiKeyUser.id, module: 'personalApiKey' },
  })
  check('API Key 新增/更新/启停/删除写入操作日志', apiKeyLogs >= 6)

  const wrongPassword = await request('POST', '/personal/center/info/reset', token, {
    originPassword: 'wrong-password',
    password: tempPassword,
  })
  check('修改密码必须校验原密码', wrongPassword.response.status === 401, wrongPassword.text)

  const reset = await request('POST', '/personal/center/info/reset', token, {
    originPassword: 'admin123',
    password: tempPassword,
  })
  check('个人中心可修改当前用户密码', reset.response.ok && reset.data?.success === true, reset.text)

  const staleAccess = await request('GET', '/personal/center/info', token)
  check('修改密码后旧 access token 立即失效', staleAccess.response.status === 401, staleAccess.text)

  const staleRefreshResponse = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: adminLogin.data?.refreshToken }),
  })
  check('修改密码后旧 refresh token 立即失效', staleRefreshResponse.status === 401)

  const oldLogin = await login(tempEmail, 'admin123')
  check('修改密码后旧密码失效', oldLogin.response.status === 401)

  const tempLogin = await login(tempEmail, tempPassword)
  check('修改密码后新密码可登录', tempLogin.response.ok && Boolean(tempLogin.data?.accessToken))

  const restorePassword = await request(
    'POST',
    '/personal/center/info/reset',
    tempLogin.data.accessToken,
    { originPassword: tempPassword, password: 'admin123' },
  )
  check('Smoke 可通过真实 API 恢复管理员密码', restorePassword.response.ok)
} finally {
  await prisma.user.update({
    where: { id: original.id },
    data: {
      email: original.email,
      phone: original.phone,
      passwordHash: original.passwordHash,
      defaultPwd: original.defaultPwd,
      authVersion: original.authVersion,
    },
  })
  if (!manager.phone) {
    await prisma.user.update({ where: { id: manager.id }, data: { phone: null } })
  }
  if (foreignApiKeyId) {
    await prisma.userApiKey.deleteMany({ where: { id: foreignApiKeyId } })
  }
  const apiKeyUserIds = [apiKeyUserId, apiKeyReadUserId].filter(Boolean)
  if (apiKeyUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: apiKeyUserIds } } })
  }
  const apiKeyRoleIds = [apiKeyRoleId, apiKeyReadRoleId].filter(Boolean)
  if (apiKeyRoleIds.length > 0) {
    await prisma.role.deleteMany({ where: { id: { in: apiKeyRoleIds } } })
  }
  if (crossTenantUserId) {
    await prisma.user.deleteMany({ where: { id: crossTenantUserId } })
  }
  if (crossTenantId) {
    await prisma.tenant.deleteMany({ where: { id: crossTenantId } })
  }
  await prisma.$disconnect()
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exitCode = 1
