import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const repoRoot = new URL('../../../', import.meta.url)
const apiRoot = new URL('../', import.meta.url)
const requireFromApi = createRequire(new URL('../package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.7 DB-011 add-sign smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db011_sign_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 35500 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${port}/api`
const nodeDir = new URL('.', `file://${process.execPath}`).pathname
const env = {
  ...process.env,
  DATABASE_URL: target.toString(),
  PORT: String(port),
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

function flowWrite(detail, enabled = detail.enabled) {
  return {
    name: detail.name,
    description: detail.description,
    enabled,
    createExecute: detail.createExecute,
    updateExecute: detail.updateExecute,
    deleteExecute: detail.deleteExecute,
    submitterCanRevoke: detail.submitterCanRevoke,
    allowBatchProcess: detail.allowBatchProcess,
    allowWithdraw: detail.allowWithdraw,
    allowAddSign: detail.allowAddSign,
    duplicateApproverRule: detail.duplicateApproverRule,
    requireComment: detail.requireComment,
    condition: detail.condition,
    createNodes: (detail.createNodes ?? [])
      .filter((node) => node.nodeType === 'APPROVER' && node.approverType && node.mode)
      .map((node) => ({
        clientId: node.id,
        name: node.name,
        approverType: node.approverType,
        approverIds: [...(node.approverIds ?? [])],
        ccUserIds: [...(node.ccUserIds ?? [])],
        mode: node.mode,
      })),
  }
}

async function pendingInstance(token, targetId) {
  const page = await request('/approvals/my-pending?page=1&pageSize=100', { token })
  const item = page.items.find((entry) => entry.module === 'order' && entry.targetId === targetId)
  assert(item?.myPendingTaskId, `order ${targetId} should have a pending task`)
  return item
}

async function detail(token, targetId) {
  return request(`/approvals/instance?module=order&targetId=${encodeURIComponent(targetId)}`, { token })
}

let management
let targetClient
let api
try {
  console.log(`W3.7 DB-011 add-sign HTTP smoke: ${database}`)
  run('pnpm', ['--filter', '@micromatrix/api', 'build'], repoRoot, process.env)
  const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')
  const client = (connectionString) => new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  management = client(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)

  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'prisma', 'migrate', 'deploy'])
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])
  targetClient = client(target.toString())
  api = spawn(process.execPath, ['dist/main.js'], { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitHealth(api)

  const [admin, zhangwei, lina, wangqiang] = await Promise.all([
    login('admin@demo.com', 'admin123'),
    login('zhangwei@demo.com', 'admin123'),
    login('lina@demo.com', 'demo123'),
    login('wangqiang@demo.com', 'demo123'),
  ])
  const token = admin.accessToken
  const adminId = admin.user.id
  const zhangweiId = zhangwei.user.id
  const linaId = lina.user.id
  const wangqiangId = wangqiang.user.id

  const existing = await request('/approvals/flows?formType=order&page=1&pageSize=100', { token })
  for (const item of existing.items) {
    const current = await request(`/approvals/flows/${item.id}`, { token })
    await request(`/approvals/flows/${item.id}`, {
      method: 'PUT', token, body: flowWrite(current, false),
    })
  }

  const suffix = Date.now().toString(36)
  const baseFlow = {
    name: `W370_SIGN_${suffix}`,
    description: 'W3.7-9.3B add-sign isolated smoke',
    enabled: true,
    createExecute: true,
    updateExecute: false,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: false,
    allowAddSign: false,
    duplicateApproverRule: 'FIRST_ONLY',
    requireComment: false,
    condition: null,
    createNodes: [{
      name: '加签基座审批',
      approverType: 'USER',
      approverIds: [adminId],
      ccUserIds: [],
      mode: 'ANY',
    }],
  }
  const flow = await request('/approvals/flows', {
    method: 'POST', token, body: { formType: 'order', ...baseFlow }, expected: 201,
  })
  assert(flow?.id, 'test flow missing')

  const form = await request('/order/module/form', { token })
  const customer = await request('/account/add', {
    method: 'POST', token, body: { name: `W370_SIGN_CUSTOMER_${suffix}` }, expected: 201,
  })
  const createOrder = async (name) => request('/order/add', {
    method: 'POST',
    token,
    expected: 201,
    body: {
      name,
      customerId: customer.id,
      owner: adminId,
      amount: 100,
      moduleFields: [],
      moduleFormConfigDTO: form,
    },
  })

  // Hard gate: flow allows normal approval but add-sign is disabled.
  const gated = await createOrder(`W370_SIGN_GATE_${suffix}`)
  const gatedPending = await pendingInstance(token, gated.id)
  await request(`/approvals/tasks/${gatedPending.myPendingTaskId}/sign`, {
    method: 'POST', token, body: { type: 'BEFORE', signApprover: zhangweiId }, expected: 400,
  })
  await request(`/approvals/${gatedPending.id}/cancel`, { method: 'POST', token, expected: 201 })

  const enabledFlow = { ...baseFlow, allowAddSign: true }
  await request(`/approvals/flows/${flow.id}`, { method: 'PUT', token, body: enabledFlow })
  assert.equal((await request(`/approvals/flows/${flow.id}`, { token })).allowAddSign, true)

  // BEFORE + nested BEFORE: source task stays PENDING but is suspended until children finish.
  const beforeOrder = await createOrder(`W370_SIGN_BEFORE_${suffix}`)
  const root = await pendingInstance(token, beforeOrder.id)
  await request(`/approvals/tasks/${root.myPendingTaskId}/sign`, {
    method: 'POST', token, body: { type: 'BEFORE', signApprover: zhangweiId, comment: 'before-1' }, expected: 201,
  })
  await request(`/approvals/tasks/${root.myPendingTaskId}/approve`, {
    method: 'POST', token, body: {}, expected: 400,
  })
  await request(`/approvals/tasks/${root.myPendingTaskId}/sign`, {
    method: 'POST', token,
    body: { type: 'BEFORE', signApprover: wangqiangId }, expected: 400,
  })
  const sign1 = await pendingInstance(zhangwei.accessToken, beforeOrder.id)
  await request(`/approvals/tasks/${sign1.myPendingTaskId}/sign`, {
    method: 'POST', token: zhangwei.accessToken,
    body: { type: 'BEFORE', signApprover: linaId, comment: 'before-2' }, expected: 201,
  })
  await request(`/approvals/tasks/${sign1.myPendingTaskId}/approve`, {
    method: 'POST', token: zhangwei.accessToken, body: {}, expected: 400,
  })
  const sign2 = await pendingInstance(lina.accessToken, beforeOrder.id)
  await request(`/approvals/tasks/${sign2.myPendingTaskId}/approve`, {
    method: 'POST', token: lina.accessToken, body: { comment: 'lina ok' }, expected: 201,
  })
  const resumedSign1 = await pendingInstance(zhangwei.accessToken, beforeOrder.id)
  await request(`/approvals/tasks/${resumedSign1.myPendingTaskId}/approve`, {
    method: 'POST', token: zhangwei.accessToken, body: { comment: 'zhangwei ok' }, expected: 201,
  })
  const resumedRoot = await pendingInstance(token, beforeOrder.id)
  assert.equal(resumedRoot.myPendingTaskId, root.myPendingTaskId, 'BEFORE chain must resume root task')
  await request(`/approvals/tasks/${resumedRoot.myPendingTaskId}/approve`, {
    method: 'POST', token, body: { comment: 'root ok' }, expected: 201,
  })
  const beforeDetail = await detail(token, beforeOrder.id)
  assert.equal(beforeDetail.status, 'APPROVED')
  assert.deepEqual(beforeDetail.addSignTasks.map((item) => item.type), ['BEFORE', 'BEFORE'])
  assert.equal(beforeDetail.records.length, 3, 'BEFORE action itself must not create extra record')

  // Nested AFTER on a SIGN task: current SIGN is approved immediately, appended SIGN runs next,
  // then the original BEFORE root resumes.
  const nestedAfterOrder = await createOrder(`W370_SIGN_NESTED_AFTER_${suffix}`)
  const nestedRoot = await pendingInstance(token, nestedAfterOrder.id)
  await request(`/approvals/tasks/${nestedRoot.myPendingTaskId}/sign`, {
    method: 'POST', token, body: { type: 'BEFORE', signApprover: zhangweiId }, expected: 201,
  })
  const nestedParent = await pendingInstance(zhangwei.accessToken, nestedAfterOrder.id)
  await request(`/approvals/tasks/${nestedParent.myPendingTaskId}/sign`, {
    method: 'POST', token: zhangwei.accessToken,
    body: { type: 'AFTER', signApprover: linaId, comment: 'nested after' }, expected: 201,
  })
  const nestedChild = await pendingInstance(lina.accessToken, nestedAfterOrder.id)
  await request(`/approvals/tasks/${nestedChild.myPendingTaskId}/approve`, {
    method: 'POST', token: lina.accessToken, body: {}, expected: 201,
  })
  const nestedRootResumed = await pendingInstance(token, nestedAfterOrder.id)
  assert.equal(nestedRootResumed.myPendingTaskId, nestedRoot.myPendingTaskId)
  await request(`/approvals/tasks/${nestedRootResumed.myPendingTaskId}/approve`, {
    method: 'POST', token, body: {}, expected: 201,
  })
  const nestedDetail = await detail(token, nestedAfterOrder.id)
  assert.equal(nestedDetail.status, 'APPROVED')
  assert.deepEqual(nestedDetail.addSignTasks.map((item) => item.type), ['BEFORE', 'AFTER'])
  assert(nestedDetail.records.some((record) => record.comment === 'nested after'), 'AFTER must write source ApprovalRecord')

  // Ordinary AFTER: source root is approved by sign action; next sign completion advances node.
  const afterOrder = await createOrder(`W370_SIGN_AFTER_${suffix}`)
  const afterRoot = await pendingInstance(token, afterOrder.id)
  await request(`/approvals/tasks/${afterRoot.myPendingTaskId}/sign`, {
    method: 'POST', token, body: { type: 'AFTER', signApprover: wangqiangId, comment: 'root after' }, expected: 201,
  })
  await request(`/approvals/tasks/${afterRoot.myPendingTaskId}/sign`, {
    method: 'POST', token,
    body: { type: 'AFTER', signApprover: linaId }, expected: 404,
  })
  await request(`/approvals/tasks/${afterRoot.myPendingTaskId}/sign`, {
    method: 'POST', token: zhangwei.accessToken,
    body: { type: 'AFTER', signApprover: linaId }, expected: 404,
  })
  const afterSign = await pendingInstance(wangqiang.accessToken, afterOrder.id)
  await request(`/approvals/tasks/${afterSign.myPendingTaskId}/approve`, {
    method: 'POST', token: wangqiang.accessToken, body: {}, expected: 201,
  })
  const afterDetail = await detail(token, afterOrder.id)
  assert.equal(afterDetail.status, 'APPROVED')
  assert.equal(afterDetail.addSignTasks.length, 1)
  assert.equal(afterDetail.addSignTasks[0].type, 'AFTER')
  assert(afterDetail.records.some((record) => record.taskId === afterRoot.myPendingTaskId && record.comment === 'root after'))

  // Cross-tenant sign approver must fail closed even if the supplied user id exists.
  const foreignTenant = await targetClient.tenant.create({
    data: { name: `W370 Foreign ${suffix}`, slug: `w370-foreign-${suffix}` },
  })
  const foreignUser = await targetClient.user.create({
    data: {
      tenantId: foreignTenant.id,
      email: `foreign-${suffix}@example.test`,
      passwordHash: 'not-used',
      name: 'Foreign Approver',
      status: 'ACTIVE',
    },
  })
  const tenantOrder = await createOrder(`W370_SIGN_TENANT_${suffix}`)
  const tenantRoot = await pendingInstance(token, tenantOrder.id)
  await request(`/approvals/tasks/${tenantRoot.myPendingTaskId}/sign`, {
    method: 'POST', token,
    body: { type: 'BEFORE', signApprover: foreignUser.id }, expected: 400,
  })
  await request(`/approvals/${tenantRoot.id}/cancel`, { method: 'POST', token, expected: 201 })

  // ALL mode: an AFTER chain completing for one approver must not advance while a sibling approver is pending.
  const allFlow = {
    ...enabledFlow,
    name: `W370_SIGN_ALL_${suffix}`,
    createNodes: [{
      name: '加签 ALL 审批',
      approverType: 'USER',
      approverIds: [adminId, zhangweiId],
      ccUserIds: [],
      mode: 'ALL',
    }],
  }
  await request(`/approvals/flows/${flow.id}`, { method: 'PUT', token, body: allFlow })
  const allOrder = await createOrder(`W370_SIGN_ALL_${suffix}`)
  const allAdmin = await pendingInstance(token, allOrder.id)
  const allZhang = await pendingInstance(zhangwei.accessToken, allOrder.id)
  await request(`/approvals/tasks/${allAdmin.myPendingTaskId}/sign`, {
    method: 'POST', token: zhangwei.accessToken,
    body: { type: 'AFTER', signApprover: linaId }, expected: 404,
  })
  await request(`/approvals/tasks/${allAdmin.myPendingTaskId}/sign`, {
    method: 'POST', token,
    body: { type: 'AFTER', signApprover: linaId, comment: 'all after' }, expected: 201,
  })
  const allSign = await pendingInstance(lina.accessToken, allOrder.id)
  await request(`/approvals/tasks/${allSign.myPendingTaskId}/approve`, {
    method: 'POST', token: lina.accessToken, body: {}, expected: 201,
  })
  assert.equal((await detail(token, allOrder.id)).status, 'PENDING', 'ALL must wait for sibling approval')
  const allZhangStill = await pendingInstance(zhangwei.accessToken, allOrder.id)
  assert.equal(allZhangStill.myPendingTaskId, allZhang.myPendingTaskId)
  await request(`/approvals/tasks/${allZhangStill.myPendingTaskId}/approve`, {
    method: 'POST', token: zhangwei.accessToken, body: {}, expected: 201,
  })
  assert.equal((await detail(token, allOrder.id)).status, 'APPROVED')

  console.log(JSON.stringify({
    database,
    migrations: 62,
    allowAddSignGate: true,
    before: true,
    nestedBefore: true,
    nestedAfter: true,
    ordinaryAfter: true,
    ownerGate: true,
    repeatGate: true,
    crossTenantApproverGate: true,
    allModeWaitsForSibling: true,
    addSignChainVo: true,
  }, null, 2))
} finally {
  if (api && api.exitCode === null) {
    api.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (api.exitCode === null) api.kill('SIGKILL')
  }
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
