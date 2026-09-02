import assert from 'node:assert/strict'
import { explicitApprovalFlowRequest } from '../../../scripts/helpers/approval-flow-graph.mjs'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

const repoRoot = new URL('../../../', import.meta.url)
const apiRoot = new URL('../', import.meta.url)
const requireFromApi = createRequire(new URL('../package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.7 DB-012 webhook smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db012_hook_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 41000 + Math.floor(Math.random() * 250)
const hookPort = port + 1000
const base = `http://127.0.0.1:${port}/api`
const hookBase = `http://127.0.0.1:${hookPort}`
const nodeDir = new URL('.', `file://${process.execPath}`).pathname
const env = {
  ...process.env,
  DATABASE_URL: target.toString(),
  PORT: String(port),
  NODE_ENV: 'test',
  APPROVAL_WEBHOOK_TEST_ALLOW_LOOPBACK: '1',
  SWAGGER_ENABLED: 'false',
  PATH: `${nodeDir}:${process.env.PATH ?? ''}`,
}

function run(program, args, cwd = repoRoot, customEnv = env) {
  const result = spawnSync(program, args, { cwd, env: customEnv, encoding: 'utf8' })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} failed: ${result.status}`)
}

async function request(path, { method = 'GET', token, body, expected = 200 } = {}) {
  body = explicitApprovalFlowRequest(path, method, body)
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}: ${text}`)
  return data
}

async function waitHealth(child) {
  let output = ''
  child.stdout?.on('data', (chunk) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk) => { output += chunk.toString() })
  for (let i = 0; i < 160; i += 1) {
    if (child.exitCode !== null) throw new Error(`isolated API exited ${child.exitCode}\n${output}`)
    try { if ((await fetch(`${base}/health`)).ok) return } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 125))
  }
  throw new Error(`isolated API health timeout\n${output}`)
}

async function login(email, password) {
  const data = await request('/auth/login', { method: 'POST', body: { email, password } })
  assert(data?.accessToken && data?.user?.id, `login failed: ${email}`)
  return data
}

function settings(name) {
  return {
    name,
    description: 'W3.7-9.4E webhook isolated smoke',
    enabled: true,
    createExecute: true,
    updateExecute: false,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: true,
    allowAddSign: true,
    duplicateApproverRule: 'EACH',
    requireComment: false,
    condition: null,
  }
}

function webhook(path, method = 'POST', body = '{"ok":true}', header = '{"Content-Type":"application/json"}') {
  return {
    webHookEnable: true,
    webHookUrl: `${hookBase}${path}`,
    webHookMethod: method,
    webHookHeader: header,
    webHookBody: body,
    webHookDescribe: `hook ${path}`,
  }
}

function post(fieldUpdateConfigs, webHookConfig) {
  return { fieldUpdateConfigs, webHookConfig }
}

function node(approverIds, mode, passPostConfig, rejectPostConfig) {
  return {
    name: 'Webhook 审批',
    approverType: 'USER',
    approverIds,
    ccUserIds: [],
    mode,
    emptyApproverAction: 'AUTO_PASS',
    fallbackApprover: null,
    sameSubmitterAction: 'ALLOW',
    approverDirection: 'BOTTOM_UP',
    passPostConfig,
    rejectPostConfig,
  }
}

async function createOrder(token, ownerId, suffix, moduleFields = []) {
  const form = await request('/order/module/form', { token })
  const customer = await request('/account/add', {
    method: 'POST', token, expected: 201, body: { name: `W370_HOOK_CUSTOMER_${suffix}` },
  })
  return request('/order/add', {
    method: 'POST', token, expected: 201,
    body: {
      name: `W370_HOOK_ORDER_${suffix}`,
      customerId: customer.id,
      owner: ownerId,
      amount: 100,
      moduleFields,
      moduleFormConfigDTO: form,
    },
  })
}

async function pending(token, targetId) {
  const page = await request('/approvals/my-pending?page=1&pageSize=100', { token })
  const item = page.items.find((entry) => entry.module === 'order' && entry.targetId === targetId)
  assert(item?.myPendingTaskId, `order ${targetId} should have pending task`)
  return item
}

async function waitUntil(fn, message, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timeout: ${message}`)
}

const hookRequests = []
const hookServer = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    hookRequests.push({ method: req.method, url: req.url, headers: req.headers, body })
    if (req.url?.startsWith('/large')) {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('x'.repeat(70 * 1024))
      return
    }
    if (req.url?.startsWith('/redirect')) {
      res.writeHead(302, { location: `${hookBase}/redirect-target` })
      res.end('redirect')
      return
    }
    if (req.url?.startsWith('/slow')) {
      setTimeout(() => {
        if (!res.destroyed) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
        }
      }, 5_500)
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
})

let management
let targetClient
let api
try {
  console.log(`W3.7 DB-012 webhook HTTP smoke: ${database}`)
  await new Promise((resolve, reject) => {
    hookServer.once('error', reject)
    hookServer.listen(hookPort, '127.0.0.1', resolve)
  })

  run('pnpm', ['--filter', '@micromatrix/shared', 'build'], repoRoot, process.env)
  run('pnpm', ['--filter', '@micromatrix/api', 'build'], repoRoot, process.env)
  const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')
  const client = (connectionString) => new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  management = client(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'prisma', 'migrate', 'deploy'])
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])
  targetClient = client(target.toString())
  const migrations = await targetClient.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
  assert.equal(migrations[0]?.count, 68, '9.4E isolated DB must apply exactly 68 migrations')

  api = spawn(process.execPath, ['dist/main.js'], { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitHealth(api)
  const [admin, manager, lina] = await Promise.all([
    login('admin@demo.com', 'admin123'),
    login('zhangwei@demo.com', 'admin123'),
    login('lina@demo.com', 'demo123'),
  ])
  const suffix = Date.now().toString(36)
  const adminToken = admin.accessToken

  await request('/approvals/flows/webhook/test', {
    method: 'POST', token: lina.accessToken, expected: 403, body: webhook('/permission'),
  })

  const testSecret = `Bearer TEST_${suffix}`
  const testBodySecret = `BODY_${suffix}`
  const postTest = webhook('/test-post', 'POST', JSON.stringify({ secret: testBodySecret }), JSON.stringify({
    'Content-Type': 'application/json', Authorization: testSecret,
  }))
  const testResult = await request('/approvals/flows/webhook/test', {
    method: 'POST', token: adminToken, expected: 201, body: postTest,
  })
  assert.equal(testResult.ok, true)
  assert.equal(testResult.httpStatus, 200)
  await request('/approvals/flows/webhook/test', {
    method: 'POST', token: adminToken, expected: 201,
    body: webhook('/test-get?probe=1', 'GET', ''),
  })
  const testDeliveries = await targetClient.approvalWebhookDelivery.findMany({
    where: { source: 'TEST' }, orderBy: { createdAt: 'asc' },
  })
  assert.equal(testDeliveries.length, 2)
  assert(testDeliveries.every((row) => row.status === 'SENT' && row.httpStatus === 200))
  assert(testDeliveries.every((row) => row.targetPath === '[redacted-path]'))
  const auditText = JSON.stringify(testDeliveries)
  assert.equal(auditText.includes(testSecret), false)
  assert.equal(auditText.includes(testBodySecret), false)

  await request('/approvals/flows/webhook/test', {
    method: 'POST', token: adminToken, expected: 400,
    body: { ...webhook('/private'), webHookUrl: 'http://10.0.0.1/hook' },
  })
  const privateAudit = await targetClient.approvalWebhookDelivery.findFirst({
    where: { source: 'TEST', errorCode: 'PRIVATE_ADDRESS' }, orderBy: { createdAt: 'desc' },
  })
  assert.equal(privateAudit?.status, 'FAILED')
  await request('/approvals/flows/webhook/test', {
    method: 'POST', token: adminToken, expected: 400,
    body: webhook('/bad-header', 'POST', '{}', '{"Host":"evil.example"}'),
  })
  await request('/approvals/flows/webhook/test', {
    method: 'POST', token: adminToken, expected: 502, body: webhook('/redirect'),
  })
  assert.equal(hookRequests.some((entry) => entry.url?.startsWith('/redirect-target')), false)
  await request('/approvals/flows/webhook/test', {
    method: 'POST', token: adminToken, expected: 502, body: webhook('/large'),
  })
  const largeAudit = await targetClient.approvalWebhookDelivery.findFirst({
    where: { source: 'TEST', errorCode: 'RESPONSE_TOO_LARGE' }, orderBy: { createdAt: 'desc' },
  })
  assert((largeAudit?.responseBytes ?? 0) > 64 * 1024)
  await request('/approvals/flows/webhook/test', {
    method: 'POST', token: adminToken, expected: 502, body: webhook('/slow'),
  })
  const timeoutAudit = await targetClient.approvalWebhookDelivery.findFirst({
    where: { source: 'TEST', errorCode: 'TIMEOUT' }, orderBy: { createdAt: 'desc' },
  })
  assert((timeoutAudit?.durationMs ?? 0) >= 4_900)

  const custom = await request('/metadata/order/fields', {
    method: 'POST', token: adminToken, expected: 201,
    body: { label: `Webhook字段_${suffix}`, type: 'text', required: false, hidden: false },
  })
  const customPlaceholder = '${order.' + custom.id + '}'
  const passV1 = post(
    [{ fieldId: custom.id, fieldValue: 'PASS_V1', enable: true }],
    webhook('/runtime/v1', 'POST', JSON.stringify({
      id: '${order.id}', name: '${order.name}', custom: customPlaceholder,
    }), JSON.stringify({ Authorization: `Bearer RUNTIME_${suffix}` })),
  )
  const rejectV1 = post(
    [{ fieldId: custom.id, fieldValue: 'REJECT_FINAL', enable: true }],
    webhook('/runtime/reject?id=${order.id}&custom=' + customPlaceholder, 'GET', ''),
  )
  const created = await request('/approvals/flows', {
    method: 'POST', token: adminToken, expected: 201,
    body: {
      formType: 'order', ...settings(`W370_HOOK_${suffix}`),
      createNodes: [node([admin.user.id], 'ANY', passV1, rejectV1)],
    },
  })
  const flowId = created.id
  const createdNode = created.createNodes.find((item) => item.nodeType === 'APPROVER')
  assert.equal(createdNode.passPostConfig.webHookConfig.webHookUrl, `${hookBase}/runtime/v1`)

  const frozenOrder = await createOrder(lina.accessToken, lina.user.id, `${suffix}_FROZEN`, [
    { fieldId: custom.id, fieldValue: 'BEFORE' },
  ])
  const frozenPending = await pending(adminToken, frozenOrder.id)
  const passV2 = post(
    [{ fieldId: custom.id, fieldValue: 'PASS_V2', enable: true }],
    webhook('/runtime/v2', 'POST', JSON.stringify({ id: '${order.id}', custom: customPlaceholder })),
  )
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken,
    body: { ...settings(`W370_HOOK_V2_${suffix}`), createNodes: [node([admin.user.id], 'ANY', passV2, rejectV1)] },
  })
  await request(`/approvals/tasks/${frozenPending.myPendingTaskId}/approve`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'frozen webhook' },
  })
  const v1Request = await waitUntil(() => hookRequests.find((entry) => entry.url === '/runtime/v1'), 'frozen V1 webhook')
  const v1Body = JSON.parse(v1Request.body)
  assert.equal(v1Body.id, frozenOrder.id)
  assert.equal(v1Body.custom, 'PASS_V1')

  const v2Order = await createOrder(lina.accessToken, lina.user.id, `${suffix}_V2`, [
    { fieldId: custom.id, fieldValue: 'BEFORE_V2' },
  ])
  const v2Pending = await pending(adminToken, v2Order.id)
  await request(`/approvals/tasks/${v2Pending.myPendingTaskId}/approve`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'v2 webhook' },
  })
  const v2Request = await waitUntil(
    () => hookRequests.find((entry) => entry.url === '/runtime/v2' && entry.body.includes(v2Order.id)),
    'V2 webhook',
  )
  assert.equal(JSON.parse(v2Request.body).custom, 'PASS_V2')

  const rejectOrder = await createOrder(lina.accessToken, lina.user.id, `${suffix}_REJECT`, [
    { fieldId: custom.id, fieldValue: 'BEFORE_REJECT' },
  ])
  const rejectPending = await pending(adminToken, rejectOrder.id)
  await request(`/approvals/tasks/${rejectPending.myPendingTaskId}/reject`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'reject webhook' },
  })
  const rejectRequest = await waitUntil(
    () => hookRequests.find((entry) => entry.url?.startsWith('/runtime/reject?') && entry.url.includes(rejectOrder.id)),
    'reject webhook',
  )
  const rejectUrl = new URL(rejectRequest.url, hookBase)
  assert.equal(rejectUrl.searchParams.get('custom'), 'REJECT_FINAL')

  const beforeAllCount = hookRequests.filter((entry) => entry.url === '/runtime/all').length
  const allPass = post([], webhook('/runtime/all'))
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken,
    body: { ...settings(`W370_HOOK_ALL_${suffix}`), createNodes: [node([admin.user.id, manager.user.id], 'ALL', allPass, rejectV1)] },
  })
  const allOrder = await createOrder(lina.accessToken, lina.user.id, `${suffix}_ALL`)
  const adminAll = await pending(adminToken, allOrder.id)
  const managerAll = await pending(manager.accessToken, allOrder.id)
  await request(`/approvals/tasks/${adminAll.myPendingTaskId}/approve`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'all first' },
  })
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(hookRequests.filter((entry) => entry.url === '/runtime/all').length, beforeAllCount)
  await request(`/approvals/tasks/${managerAll.myPendingTaskId}/approve`, {
    method: 'POST', token: manager.accessToken, expected: 201, body: { comment: 'all final' },
  })
  await waitUntil(
    () => hookRequests.filter((entry) => entry.url === '/runtime/all').length === beforeAllCount + 1,
    'ALL completion webhook',
  )

  const autoPass = post([], webhook('/runtime/auto', 'POST', '{"id":"${order.id}"}'))
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken,
    body: { ...settings(`W370_HOOK_AUTO_${suffix}`), createNodes: [{
      ...node([], 'ANY', autoPass, rejectV1), approverType: 'DIRECT_LEADER', approverIds: ['3'], sameSubmitterAction: 'SKIP',
    }] },
  })
  const autoOrder = await createOrder(lina.accessToken, lina.user.id, `${suffix}_AUTO`)
  await waitUntil(
    () => hookRequests.find((entry) => entry.url === '/runtime/auto' && entry.body.includes(autoOrder.id)),
    'AUTO_PASS webhook',
  )

  const privateRuntime = { ...webhook('/runtime/private'), webHookUrl: 'http://10.0.0.1/private' }
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken,
    body: { ...settings(`W370_HOOK_PRIVATE_${suffix}`), createNodes: [node([admin.user.id], 'ANY', post([], privateRuntime), rejectV1)] },
  })
  const privateOrder = await createOrder(lina.accessToken, lina.user.id, `${suffix}_PRIVATE`)
  const privatePending = await pending(adminToken, privateOrder.id)
  await request(`/approvals/tasks/${privatePending.myPendingTaskId}/approve`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'network failure should not rollback' },
  })
  const privateInstance = await targetClient.approvalInstance.findFirstOrThrow({
    where: { targetId: privateOrder.id }, orderBy: { createdAt: 'desc' },
  })
  const privateRuntimeAudit = await waitUntil(
    () => targetClient.approvalWebhookDelivery.findFirst({
      where: { instanceId: privateInstance.id, source: 'RUNTIME', errorCode: 'PRIVATE_ADDRESS' },
    }),
    'runtime private audit',
  )
  assert.equal(privateRuntimeAudit.status, 'FAILED')
  assert.equal(privateInstance.status, 'APPROVED')

  const runtimeDeliveries = await targetClient.approvalWebhookDelivery.findMany({ where: { source: 'RUNTIME' } })
  assert(runtimeDeliveries.some((row) => row.status === 'SENT' && row.action === 'APPROVE'))
  assert(runtimeDeliveries.some((row) => row.status === 'SENT' && row.action === 'REJECT'))
  assert(runtimeDeliveries.some((row) => row.status === 'FAILED' && row.errorCode === 'PRIVATE_ADDRESS'))
  const runtimeAuditText = JSON.stringify(runtimeDeliveries)
  assert.equal(runtimeAuditText.includes(`Bearer RUNTIME_${suffix}`), false)
  assert.equal(runtimeAuditText.includes('PASS_V1'), false)

  console.log(JSON.stringify({
    migrations: 68,
    testPermissionGate: true,
    testConnectionPostGet: true,
    privateTargetGate: true,
    forbiddenHeaderGate: true,
    redirectDisabled: true,
    responseLimitGate: true,
    timeoutGate: true,
    webhookAuditRedaction: true,
    frozenWebhookVersion: true,
    postFieldBeforeWebhook: true,
    rejectGetPlaceholder: true,
    allNodeSingleSend: true,
    autoPassWebhook: true,
    runtimeFailureNonBlocking: true,
  }, null, 2))
} finally {
  if (api && api.exitCode === null) {
    api.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (api.exitCode === null) api.kill('SIGKILL')
  }
  await new Promise((resolve) => hookServer.close(resolve))
  if (management) {
    try {
      if (targetClient) await targetClient.$disconnect()
      await management.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}'`)
      await management.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`)
    } finally {
      await management.$disconnect()
    }
  }
}
