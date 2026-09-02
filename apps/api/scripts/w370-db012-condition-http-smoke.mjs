import assert from 'node:assert/strict'
import { approvalFlowWriteFromDetail, explicitApprovalFlowRequest } from '../../../scripts/helpers/approval-flow-graph.mjs'
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
  if (!line) throw new Error('W3.7 DB-012 condition smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db012_condition_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 39200 + Math.floor(Math.random() * 600)
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

function settings(overrides = {}) {
  return {
    name: 'W370_DB012_CONDITION',
    description: 'W3.7-9.4A Condition / DEFAULT isolated smoke',
    enabled: true,
    createExecute: true,
    updateExecute: true,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: true,
    allowAddSign: true,
    duplicateApproverRule: 'FIRST_ONLY',
    requireComment: false,
    condition: null,
    ...overrides,
  }
}

function amountGraph(adminId, managerId, linaId) {
  return {
    createNodes: [
      { clientId: 'start', name: '开始', nodeType: 'START' },
      {
        clientId: 'high', name: '高金额', nodeType: 'CONDITION',
        conditionConfig: { searchMode: 'AND', conditions: [{ name: 'amount', operator: 'GE', value: 1000 }] },
      },
      {
        clientId: 'medium', name: '中金额', nodeType: 'CONDITION',
        conditionConfig: { searchMode: 'AND', conditions: [{ name: 'amount', operator: 'GE', value: 500 }] },
      },
      { clientId: 'default', name: '其他金额', nodeType: 'DEFAULT' },
      { clientId: 'admin', name: '高金额审批', nodeType: 'APPROVER', approverType: 'USER', approverIds: [adminId], ccUserIds: [], mode: 'ANY', sameSubmitterAction: 'ALLOW' },
      { clientId: 'manager', name: '中金额审批', nodeType: 'APPROVER', approverType: 'USER', approverIds: [managerId], ccUserIds: [], mode: 'ANY', sameSubmitterAction: 'ALLOW' },
      { clientId: 'lina', name: '默认审批', nodeType: 'APPROVER', approverType: 'USER', approverIds: [linaId], ccUserIds: [], mode: 'ANY', sameSubmitterAction: 'ALLOW' },
      { clientId: 'end', name: '结束', nodeType: 'END' },
    ],
    createLinks: [
      { fromNodeId: 'start', toNodeId: 'high', sort: 0 },
      { fromNodeId: 'start', toNodeId: 'medium', sort: 1 },
      { fromNodeId: 'start', toNodeId: 'default', sort: 2 },
      { fromNodeId: 'high', toNodeId: 'admin', sort: 0 },
      { fromNodeId: 'medium', toNodeId: 'manager', sort: 0 },
      { fromNodeId: 'default', toNodeId: 'lina', sort: 0 },
      { fromNodeId: 'admin', toNodeId: 'end', sort: 0 },
      { fromNodeId: 'manager', toNodeId: 'end', sort: 0 },
      { fromNodeId: 'lina', toNodeId: 'end', sort: 0 },
    ],
  }
}

function updateFieldGraph(managerId, linaId) {
  return {
    createNodes: [
      { clientId: 'start-v2', name: '开始', nodeType: 'START' },
      {
        clientId: 'name-changed', name: '名称已修改', nodeType: 'CONDITION',
        conditionConfig: { searchMode: 'AND', conditions: [{ name: 'name', operator: 'NOT_EQUAL_ORIGINAL' }] },
      },
      { clientId: 'default-v2', name: '名称未修改', nodeType: 'DEFAULT' },
      { clientId: 'manager-v2', name: '修改字段审批', nodeType: 'APPROVER', approverType: 'USER', approverIds: [managerId], ccUserIds: [], mode: 'ANY' },
      { clientId: 'lina-v2', name: '未修改字段审批', nodeType: 'APPROVER', approverType: 'USER', approverIds: [linaId], ccUserIds: [], mode: 'ANY' },
      { clientId: 'end-v2', name: '结束', nodeType: 'END' },
    ],
    createLinks: [
      { fromNodeId: 'start-v2', toNodeId: 'name-changed', sort: 0 },
      { fromNodeId: 'start-v2', toNodeId: 'default-v2', sort: 1 },
      { fromNodeId: 'name-changed', toNodeId: 'manager-v2', sort: 0 },
      { fromNodeId: 'default-v2', toNodeId: 'lina-v2', sort: 0 },
      { fromNodeId: 'manager-v2', toNodeId: 'end-v2', sort: 0 },
      { fromNodeId: 'lina-v2', toNodeId: 'end-v2', sort: 0 },
    ],
  }
}

async function createOrder(token, ownerId, suffix, amount) {
  const form = await request('/order/module/form', { token })
  const customer = await request('/account/add', {
    method: 'POST', token, expected: 201, body: { name: `W370_DB012_CUSTOMER_${suffix}` },
  })
  const order = await request('/order/add', {
    method: 'POST', token, expected: 201,
    body: {
      name: `W370_DB012_ORDER_${suffix}`,
      customerId: customer.id,
      owner: ownerId,
      amount,
      moduleFields: [],
      moduleFormConfigDTO: form,
    },
  })
  return order
}

async function pending(token, targetId) {
  const page = await request('/approvals/my-pending?page=1&pageSize=100', { token })
  const item = page.items.find((entry) => entry.module === 'order' && entry.targetId === targetId)
  assert(item?.myPendingTaskId, `order ${targetId} should have a pending task`)
  return item
}

async function instance(token, targetId) {
  return request(`/approvals/instance?module=order&targetId=${encodeURIComponent(targetId)}`, { token })
}

async function approve(token, taskId, comment) {
  return request(`/approvals/tasks/${taskId}/approve`, {
    method: 'POST', token, expected: 201, body: { comment },
  })
}

let management
let targetClient
let api
try {
  console.log(`W3.7 DB-012 Condition HTTP smoke: ${database}`)
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
  assert.equal(migrations[0]?.count, 68, '9.4A regression must apply current 68 migrations')

  api = spawn(process.execPath, ['dist/main.js'], { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitHealth(api)

  const [admin, manager, lina] = await Promise.all([
    login('admin@demo.com', 'admin123'),
    login('zhangwei@demo.com', 'admin123'),
    login('lina@demo.com', 'demo123'),
  ])
  const adminToken = admin.accessToken
  const managerToken = manager.accessToken
  const linaToken = lina.accessToken
  const suffix = Date.now().toString(36)

  // 9.4F 删除服务端旧线性推导：缺少 createLinks 的写请求必须直接被 DTO 拒绝。
  const legacyResponse = await fetch(`${base}/approvals/flows`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      formType: 'quotation',
      ...settings({ name: `W370_DB012_LEGACY_${suffix}`, enabled: false, updateExecute: false }),
      createNodes: [{ name: '旧线性审批', approverType: 'USER', approverIds: [admin.user.id], ccUserIds: [], mode: 'ANY' }],
    }),
  })
  assert.equal(legacyResponse.status, 400, `legacy createNodes-only payload must be rejected: ${await legacyResponse.text()}`)

  const amount = amountGraph(admin.user.id, manager.user.id, lina.user.id)
  await request('/approvals/flows', {
    method: 'POST', token: adminToken, body: {
      formType: 'order',
      ...settings({ name: `W370_DB012_AMOUNT_${suffix}` }),
      ...amount,
    }, expected: 201,
  })
  const flowPage = await request('/approvals/flows?formType=order&page=1&pageSize=20', { token: adminToken })
  const flowItem = flowPage.items.find((item) => item.name === `W370_DB012_AMOUNT_${suffix}`)
  assert(flowItem?.id, 'advanced order flow should exist')
  const flowV1 = await request(`/approvals/flows/${flowItem.id}`, { token: adminToken })
  assert.equal(flowV1.currentVersion, 1)
  assert.equal(flowV1.createNodes.filter((node) => node.nodeType === 'CONDITION').length, 2)
  assert.equal(flowV1.createNodes.filter((node) => node.nodeType === 'DEFAULT').length, 1)
  assert.equal(flowV1.createLinks.length, 9)
  assert.equal(
    flowV1.createNodes.find((node) => node.nodeType === 'CONDITION' && node.name === '高金额')?.conditionConfig?.conditions?.[0]?.operator,
    'GE',
  )
  const sameGraph = await request(`/approvals/flows/${flowItem.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { ...approvalFlowWriteFromDetail(flowV1), description: '9.4F same graph settings-only update' },
  })
  assert.equal(sameGraph.currentVersion, 1, 'settings-only update must not create a redundant FlowVersion')

  // API graph/reference gates: no DEFAULT and invalid approver must fail before persistence.
  await request('/approvals/flows', {
    method: 'POST', token: adminToken, expected: 400,
    body: {
      formType: 'invoice',
      ...settings({ name: `W370_DB012_INVALID_GRAPH_${suffix}`, enabled: false, updateExecute: false }),
      createNodes: amount.createNodes.filter((node) => node.clientId !== 'default'),
      createLinks: amount.createLinks.filter((link) => link.toNodeId !== 'default' && link.fromNodeId !== 'default'),
    },
  })
  const invalidReference = amountGraph(randomUUID(), manager.user.id, lina.user.id)
  await request('/approvals/flows', {
    method: 'POST', token: adminToken, expected: 400,
    body: {
      formType: 'invoice',
      ...settings({ name: `W370_DB012_INVALID_REF_${suffix}`, enabled: false, updateExecute: false }),
      ...invalidReference,
    },
  })

  // amount=1500 同时命中 high/medium，必须按 link.sort 进入 high/admin。
  const highOrder = await createOrder(adminToken, admin.user.id, `${suffix}_HIGH`, 1500)
  const highPending = await pending(adminToken, highOrder.id)
  assert.deepEqual(highPending.nodesSnapshot.map((node) => node.name), ['高金额审批'])
  const highDetail = await instance(adminToken, highOrder.id)
  assert.equal(highDetail.tasks.length, 1, 'CONDITION/DEFAULT must not create ApprovalTask')
  assert.equal(highDetail.tasks[0].nodeName, '高金额审批')
  await approve(adminToken, highPending.myPendingTaskId, 'high branch pass')

  // 第一条不命中、第二条命中。
  const mediumOrder = await createOrder(adminToken, admin.user.id, `${suffix}_MEDIUM`, 700)
  const mediumPending = await pending(managerToken, mediumOrder.id)
  assert.deepEqual(mediumPending.nodesSnapshot.map((node) => node.name), ['中金额审批'])
  await approve(managerToken, mediumPending.myPendingTaskId, 'medium branch pass')

  // 全条件不命中才进入 DEFAULT，并保持该实例用于验证版本冻结。
  const defaultOrder = await createOrder(adminToken, admin.user.id, `${suffix}_DEFAULT`, 100)
  const defaultPending = await pending(linaToken, defaultOrder.id)
  assert.deepEqual(defaultPending.nodesSnapshot.map((node) => node.name), ['默认审批'])
  const defaultInstanceId = defaultPending.id

  // 更新 FlowVersion 为 updateFields 条件图；旧实例必须继续冻结 v1 实际路径。
  const changedGraph = updateFieldGraph(manager.user.id, lina.user.id)
  const flowV2 = await request(`/approvals/flows/${flowItem.id}`, {
    method: 'PUT', token: adminToken,
    body: {
      ...settings({ name: `W370_DB012_UPDATE_${suffix}` }),
      ...changedGraph,
    },
  })
  assert.equal(flowV2.currentVersion, 2)
  const frozen = await instance(adminToken, defaultOrder.id)
  assert.equal(frozen.id, defaultInstanceId)
  assert.deepEqual(frozen.nodesSnapshot.map((node) => node.name), ['默认审批'])
  assert.equal(frozen.tasks.filter((task) => task.status === 'PENDING').length, 1)
  await approve(linaToken, defaultPending.myPendingTaskId, 'frozen v1 default pass')

  // UPDATE 修改 name：DB-010 updateFields 命中 NOT_EQUAL_ORIGINAL，进入 manager。
  const changedName = `${highOrder.name}_CHANGED`
  await request('/order/update', {
    method: 'POST', token: adminToken, expected: 201,
    body: { id: highOrder.id, name: changedName, amount: 1500, moduleFields: [] },
  })
  const changedPending = await pending(managerToken, highOrder.id)
  assert.deepEqual(changedPending.nodesSnapshot.map((node) => node.name), ['修改字段审批'])
  const changedRuntime = await targetClient.approvalInstance.findUniqueOrThrow({
    where: { id: changedPending.id },
    select: { updateFields: true },
  })
  assert.deepEqual(JSON.parse(changedRuntime.updateFields ?? '[]'), ['name'])
  await approve(managerToken, changedPending.myPendingTaskId, 'name changed pass')

  // UPDATE 只修改 amount，name 不在 updateFields，必须走 DEFAULT/lina。
  await request('/order/update', {
    method: 'POST', token: adminToken, expected: 201,
    body: { id: highOrder.id, name: changedName, amount: 1600, moduleFields: [] },
  })
  const unchangedPending = await pending(linaToken, highOrder.id)
  assert.deepEqual(unchangedPending.nodesSnapshot.map((node) => node.name), ['未修改字段审批'])
  const unchangedRuntime = await targetClient.approvalInstance.findUniqueOrThrow({
    where: { id: unchangedPending.id },
    select: { updateFields: true },
  })
  const unchangedFields = JSON.parse(unchangedRuntime.updateFields ?? '[]')
  assert(unchangedFields.includes('amount'))
  assert(!unchangedFields.includes('name'))
  await approve(linaToken, unchangedPending.myPendingTaskId, 'name unchanged default pass')

  console.log(JSON.stringify({
    migrations: 68,
    graphRoundTrip: true,
    legacyPayloadTransition: true,
    graphValidationGate: true,
    referenceGate: true,
    linkSortFirstMatch: true,
    secondConditionMatch: true,
    defaultFallback: true,
    conditionNodesNoTasks: true,
    frozenHistoricalPath: true,
    notEqualOriginal: true,
    unchangedFieldDefault: true,
    finalApproved: true,
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
