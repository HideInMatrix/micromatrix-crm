/**
 * 企业设置真实数据库/API Smoke。
 * 前置：API 已启动，当前 migrations 已应用，API production build 已生成 Prisma Client。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')

const base = process.env.API_BASE ?? 'http://localhost:3000/api'
const suffix = Date.now().toString(36)
let passed = 0
let failed = 0

function resolveDatabaseUrl() {
  if (process.env.SMOKE_DATABASE_URL) return process.env.SMOKE_DATABASE_URL
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('企业设置 Smoke 需要 DATABASE_URL 或 apps/api/.env 中的 DATABASE_URL')
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }),
})

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`)
  }
}

async function request(method, path, headers, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    // 404/204 等响应允许没有 JSON body。
  }
  return { response, data }
}

const get = (path, headers) => request('GET', path, headers)
const post = (path, headers, body) => request('POST', path, headers, body)
const put = (path, headers, body) => request('PUT', path, headers, body)
const patch = (path, headers, body) => request('PATCH', path, headers, body)
const remove = (path, headers) => request('DELETE', path, headers)

async function register(label) {
  const { response, data } = await post('/auth/register', undefined, {
    tenantName: `Enterprise Settings ${label} ${suffix}`,
    name: `企业设置 ${label}`,
    email: `enterprise-settings-${label}-${suffix}@smoke.local`,
    password: 'Smoke123!',
  })
  if (!response.ok || !data?.accessToken) {
    throw new Error(`注册 ${label} 失败: ${response.status} ${JSON.stringify(data)}`)
  }
  return {
    user: data.user,
    headers: { Authorization: `Bearer ${data.accessToken}` },
  }
}

async function cleanupTenants(tenantIds) {
  if (!tenantIds.length) return
  await prisma.operationLog.deleteMany({ where: { tenantId: { in: tenantIds } } })
  await prisma.loginLog.deleteMany({ where: { tenantId: { in: tenantIds } } })
  await prisma.notification.deleteMany({ where: { tenantId: { in: tenantIds } } })
  await prisma.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } })
  await prisma.userRole.deleteMany({ where: { tenantId: { in: tenantIds } } })
  await prisma.userExtension.deleteMany({ where: { user: { tenantId: { in: tenantIds } } } })
  await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
  await prisma.department.deleteMany({ where: { tenantId: { in: tenantIds } } })
  await prisma.role.deleteMany({ where: { tenantId: { in: tenantIds } } })
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } })
}

const tenantIds = []

try {
  console.log('\n企业设置 Smoke')
  const primary = await register('primary')
  const isolated = await register('isolated')
  tenantIds.push(primary.user.tenantId, isolated.user.tenantId)

  const legacy = await get('/settings', primary.headers)
  check('旧 /settings API 已删除', legacy.response.status === 404, `${legacy.response.status}`)

  const uiInitial = await get('/enterprise-settings/ui', primary.headers)
  check(
    '界面设置按租户自动建立默认值',
    uiInitial.response.ok && uiInitial.data?.title === 'MicroMatrix CRM',
    JSON.stringify(uiInitial.data),
  )
  const uiSaved = await put('/enterprise-settings/ui', primary.headers, {
    theme: 'custom',
    customTheme: '#123456',
    style: 'custom',
    customStyle: '#f1f2f3',
    title: `Smoke CRM ${suffix}`,
    slogan: '企业设置专项冒烟',
    helpDoc: 'https://example.com/help',
  })
  check(
    '界面设置保存后刷新持久化',
    uiSaved.response.ok && uiSaved.data?.customTheme === '#123456',
    JSON.stringify(uiSaved.data),
  )
  const isolatedUi = await get('/enterprise-settings/ui', isolated.headers)
  check(
    '界面设置租户隔离',
    isolatedUi.response.ok && isolatedUi.data?.title === 'MicroMatrix CRM',
    JSON.stringify(isolatedUi.data),
  )

  const weCom = await get('/enterprise-integrations/wecom', primary.headers)
  check(
    '第三方页签继续复用独立企业集成域',
    weCom.response.ok && weCom.data?.provider === 'WECOM',
    JSON.stringify(weCom.data),
  )

  const mailPayload = {
    host: 'smtp.example.com',
    port: 465,
    account: 'mailer@example.com',
    password: `mail-secret-${suffix}`,
    from: 'mailer@example.com',
    recipient: 'receiver@example.com',
    ssl: true,
    tls: false,
  }
  const mailSaved = await put('/enterprise-settings/mail', primary.headers, mailPayload)
  check(
    '邮件设置保存且不回显密码',
    mailSaved.response.ok &&
      mailSaved.data?.passwordConfigured === true &&
      !('password' in (mailSaved.data ?? {})),
    JSON.stringify(mailSaved.data),
  )
  const mailRow = await prisma.enterpriseMailSetting.findUnique({
    where: { tenantId: primary.user.tenantId },
  })
  check(
    'SMTP 密码实际以密文落库',
    Boolean(mailRow?.passwordCiphertext) && mailRow?.passwordCiphertext !== mailPayload.password,
  )
  const invalidTransport = await post('/enterprise-settings/mail/test', primary.headers, {
    ...mailPayload,
    ssl: true,
    tls: true,
  })
  check('SSL 与 STARTTLS 冲突被后端拒绝', invalidTransport.response.status === 400)

  const modelPayload = {
    displayName: `主模型 ${suffix}`,
    modelName: 'gpt-smoke',
    provider: 'OpenAI',
    apiUrl: 'https://api.example.com/v1',
    apiKey: `model-secret-${suffix}`,
    enable: true,
    temperature: 0.7,
    maxTokens: 2048,
    topP: 0.9,
    globalDailyLimit: 1000,
    userDailyLimit: 100,
  }
  const modelCreated = await post('/enterprise-settings/models', primary.headers, modelPayload)
  check(
    'AI 模型创建且 API Key 不回显',
    modelCreated.response.ok &&
      modelCreated.data?.apiKeyConfigured === true &&
      !('apiKey' in (modelCreated.data ?? {})),
    JSON.stringify(modelCreated.data),
  )
  const modelId = modelCreated.data?.id
  const modelBefore = modelId
    ? await prisma.enterpriseAiModel.findUnique({ where: { id: modelId } })
    : null
  const modelUpdated = modelId
    ? await put(`/enterprise-settings/models/${modelId}`, primary.headers, {
        ...modelPayload,
        apiKey: '',
        displayName: `${modelPayload.displayName} edited`,
      })
    : { response: { ok: false }, data: null }
  const modelAfter = modelId
    ? await prisma.enterpriseAiModel.findUnique({ where: { id: modelId } })
    : null
  check(
    '模型编辑留空保留原 API Key',
    modelUpdated.response.ok &&
      Boolean(modelBefore?.apiKeyCiphertext) &&
      modelBefore?.apiKeyCiphertext === modelAfter?.apiKeyCiphertext,
  )
  const routeSaved = modelId
    ? await put('/enterprise-settings/models/route-strategy', primary.headers, {
        modelIds: [modelId],
      })
    : { response: { ok: false }, data: null }
  check(
    '模型路由策略真实持久化',
    routeSaved.response.ok && routeSaved.data?.modelIds?.[0] === modelId,
    JSON.stringify(routeSaved.data),
  )
  const isolatedModels = await get('/enterprise-settings/models', isolated.headers)
  check(
    'AI 模型列表租户隔离',
    isolatedModels.response.ok && isolatedModels.data?.length === 0,
    JSON.stringify(isolatedModels.data),
  )

  const categoryCreated = await post('/enterprise-settings/term-categories', primary.headers, {
    name: `销售术语 ${suffix}`,
  })
  const categoryId = categoryCreated.data?.id
  check('术语分类可创建', categoryCreated.response.ok && Boolean(categoryId))
  const termCreated = categoryId
    ? await post('/enterprise-settings/terms', primary.headers, {
        categoryId,
        standardTerm: `标准术语 ${suffix}`,
        alsoCalled: '别称',
        avoidThese: '禁用说法',
        useCase: '销售分析',
        systemReference: 'CRM',
        enable: true,
      })
    : { response: { ok: false }, data: null }
  check('术语 CRUD 使用独立领域表', termCreated.response.ok && Boolean(termCreated.data?.id))

  let discoveryId = null
  if (categoryId) {
    const discovery = await prisma.enterpriseTermDiscovery.create({
      data: {
        tenantId: primary.user.tenantId,
        discovered: `AI发现 ${suffix}`,
        source: 'smoke',
        context: '客户沟通',
      },
    })
    discoveryId = discovery.id
  }
  const discoveries = await get('/enterprise-settings/term-discoveries', primary.headers)
  check(
    '待处理术语发现可读取',
    discoveries.response.ok && discoveries.data?.some((item) => item.id === discoveryId),
    JSON.stringify(discoveries.data),
  )
  const adopted = discoveryId
    ? await post(`/enterprise-settings/term-discoveries/${discoveryId}/adopt`, primary.headers, {
        categoryId,
        standardTerm: `AI标准术语 ${suffix}`,
        enable: true,
      })
    : { response: { ok: false }, data: null }
  const discoveryAfter = discoveryId
    ? await prisma.enterpriseTermDiscovery.findUnique({ where: { id: discoveryId } })
    : null
  check(
    '术语发现采纳原子创建术语并标记 ADOPTED',
    adopted.response.ok &&
      discoveryAfter?.status === 'ADOPTED' &&
      discoveryAfter.adoptedTermId === adopted.data?.id,
  )

  const taskCreated = await post('/enterprise-settings/global-tasks', primary.headers, {
    name: `客户巡检 ${suffix}`,
    triggerType: 'manual',
    executionCondition: '客户状态异常',
    executionAction: '生成分析建议',
    confirmationLevel: 'ask',
    applicableModelId: modelId,
    enable: true,
  })
  const taskId = taskCreated.data?.id
  check(
    '全局任务绑定已启用模型',
    taskCreated.response.ok && taskCreated.data?.applicableModelId === modelId,
    JSON.stringify(taskCreated.data),
  )
  let executionId = null
  if (taskId) {
    const execution = await prisma.enterpriseGlobalTaskExecution.create({
      data: {
        tenantId: primary.user.tenantId,
        taskId,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    })
    executionId = execution.id
  }
  const executionList = await get('/enterprise-settings/global-tasks/executions', primary.headers)
  check(
    '全局任务执行记录可查询',
    executionList.response.ok && executionList.data?.some((item) => item.id === executionId),
    JSON.stringify(executionList.data),
  )
  const runningDelete = executionId
    ? await remove(`/enterprise-settings/global-tasks/executions/${executionId}`, primary.headers)
    : { response: { status: 0 } }
  check('运行中执行记录禁止直接删除', runningDelete.response.status === 400)
  const stopped = executionId
    ? await patch(
        `/enterprise-settings/global-tasks/executions/${executionId}/stop`,
        primary.headers,
      )
    : { response: { ok: false }, data: null }
  check('执行记录可停止', stopped.response.ok && stopped.data?.status === 'STOPPED')
  const deletedExecution = executionId
    ? await remove(`/enterprise-settings/global-tasks/executions/${executionId}`, primary.headers)
    : { response: { ok: false } }
  check('停止后的执行记录可删除', deletedExecution.response.ok)
} finally {
  await cleanupTenants(tenantIds).catch((error) =>
    console.error('  ! 企业设置 Smoke 清理失败', error),
  )
  await prisma.$disconnect()
}

console.log(`\n企业设置 Smoke：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
