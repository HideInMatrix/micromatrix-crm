import assert from 'node:assert/strict'
import { explicitApprovalFlowRequest } from '../../../scripts/helpers/approval-flow-graph.mjs'
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
  if (!line) throw new Error('W3.7 DB-012 post field smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db012_post_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 40700 + Math.floor(Math.random() * 300)
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

function settings(name) {
  return {
    name,
    description: 'W3.7-9.4D post field isolated smoke',
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

function node(approverIds, mode, passPostConfig, rejectPostConfig) {
  return {
    name: '后置字段审批',
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

function post(...fieldUpdateConfigs) {
  return { fieldUpdateConfigs }
}

async function createOrder(token, ownerId, suffix, moduleFields) {
  const form = await request('/order/module/form', { token })
  const customer = await request('/account/add', {
    method: 'POST', token, expected: 201, body: { name: `W370_POST_CUSTOMER_${suffix}` },
  })
  return request('/order/add', {
    method: 'POST', token, expected: 201,
    body: {
      name: `W370_POST_ORDER_${suffix}`,
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

async function dynamicValue(client, targetId, fieldId) {
  const row = await client.orderField.findFirst({ where: { resourceId: targetId, fieldId } })
  return row?.fieldValue ?? null
}

let management
let targetClient
let api
try {
  console.log(`W3.7 DB-012 post field HTTP smoke: ${database}`)
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
  assert.equal(migrations[0]?.count, 68, '9.4D regression must apply current 68 migrations')

  api = spawn(process.execPath, ['dist/main.js'], { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitHealth(api)
  const [admin, manager, lina] = await Promise.all([
    login('admin@demo.com', 'admin123'),
    login('zhangwei@demo.com', 'admin123'),
    login('lina@demo.com', 'demo123'),
  ])
  const suffix = Date.now().toString(36)
  const adminToken = admin.accessToken
  const custom = await request('/metadata/order/fields', {
    method: 'POST', token: adminToken, expected: 201,
    body: { label: `审批后置字段_${suffix}`, type: 'text', required: false, hidden: false },
  })
  const untouched = await request('/metadata/order/fields', {
    method: 'POST', token: adminToken, expected: 201,
    body: { label: `审批禁用字段_${suffix}`, type: 'text', required: false, hidden: false },
  })
  const orderFields = await request('/metadata/order/fields', { token: adminToken })
  const contractFields = await request('/metadata/contract/fields', { token: adminToken })
  const nameField = orderFields.find((field) => field.key === 'name')
  const amountField = orderFields.find((field) => field.key === 'amount')
  const foreignField = contractFields.find((field) => field.key === 'name')
  assert(nameField && amountField && foreignField)

  const passV1 = post(
    { fieldId: custom.id, fieldValue: 'PASS_V1', enable: true },
    { fieldId: untouched.id, fieldValue: null, enable: false },
  )
  const rejectV1 = post({ fieldId: custom.id, fieldValue: 'REJECT_V1', enable: true })
  const created = await request('/approvals/flows', {
    method: 'POST', token: adminToken, expected: 201,
    body: {
      formType: 'order',
      ...settings(`W370_POST_${suffix}`),
      createNodes: [node([admin.user.id], 'ANY', passV1, rejectV1)],
    },
  })
  const flowId = created.id
  const createdNode = created.createNodes.find((item) => item.nodeType === 'APPROVER')
  assert.deepEqual(createdNode.passPostConfig, passV1)
  assert.deepEqual(createdNode.rejectPostConfig, rejectV1)

  // 配置期 reference / duplicate / value / safe field gate。
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken, expected: 400,
    body: { ...settings('bad foreign'), createNodes: [node([admin.user.id], 'ANY', post({ fieldId: foreignField.id, fieldValue: 'x', enable: true }), rejectV1)] },
  })
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken, expected: 400,
    body: { ...settings('bad duplicate'), createNodes: [node([admin.user.id], 'ANY', post(
      { fieldId: custom.id, fieldValue: 'x', enable: true },
      { fieldId: custom.id, fieldValue: 'y', enable: false },
    ), rejectV1)] },
  })
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken, expected: 400,
    body: { ...settings('bad null'), createNodes: [node([admin.user.id], 'ANY', post({ fieldId: custom.id, fieldValue: null, enable: true }), rejectV1)] },
  })
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken, expected: 400,
    body: { ...settings('bad system'), createNodes: [node([admin.user.id], 'ANY', post({ fieldId: amountField.id, fieldValue: 99, enable: true }), rejectV1)] },
  })

  // 冻结版本：在途实例继续执行 V1，流程更新为 V2 不影响旧实例。
  const frozenOrder = await createOrder(lina.accessToken, lina.user.id, `${suffix}_FROZEN`, [
    { fieldId: custom.id, fieldValue: 'BEFORE' },
    { fieldId: untouched.id, fieldValue: 'KEEP' },
  ])
  const frozenPending = await pending(adminToken, frozenOrder.id)
  const passV2 = post({ fieldId: custom.id, fieldValue: 'PASS_V2', enable: true })
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken,
    body: { ...settings(`W370_POST_V2_${suffix}`), createNodes: [node([admin.user.id], 'ANY', passV2, rejectV1)] },
  })
  await request(`/approvals/tasks/${frozenPending.myPendingTaskId}/approve`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'pass frozen' },
  })
  assert.equal(await dynamicValue(targetClient, frozenOrder.id, custom.id), 'PASS_V1')
  assert.equal(await dynamicValue(targetClient, frozenOrder.id, untouched.id), 'KEEP')

  // 新实例执行 V2。
  const v2Order = await createOrder(lina.accessToken, lina.user.id, `${suffix}_V2`, [
    { fieldId: custom.id, fieldValue: 'BEFORE_V2' },
  ])
  const v2Pending = await pending(adminToken, v2Order.id)
  await request(`/approvals/tasks/${v2Pending.myPendingTaskId}/approve`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'pass v2' },
  })
  assert.equal(await dynamicValue(targetClient, v2Order.id, custom.id), 'PASS_V2')

  // reject 执行 rejectPostConfig。
  const rejectOrder = await createOrder(lina.accessToken, lina.user.id, `${suffix}_REJECT`, [
    { fieldId: custom.id, fieldValue: 'BEFORE_REJECT' },
  ])
  const rejectPending = await pending(adminToken, rejectOrder.id)
  await request(`/approvals/tasks/${rejectPending.myPendingTaskId}/reject`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'reject post' },
  })
  assert.equal(await dynamicValue(targetClient, rejectOrder.id, custom.id), 'REJECT_V1')

  // UPDATE 驳回必须先恢复 DB-010 编辑前快照，再执行 rejectPostConfig；
  // 否则 reject 后置值会被旧快照覆盖。
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken,
    body: {
      ...settings(`W370_POST_UPDATE_REJECT_${suffix}`),
      updateExecute: true,
      createNodes: [node([admin.user.id], 'ANY', passV2, rejectV1)],
    },
  })
  const updateRejectedName = `${v2Order.name}_EDIT_REJECT`
  await request('/order/update', {
    method: 'POST', token: adminToken, expected: 201,
    body: {
      id: v2Order.id,
      name: updateRejectedName,
      amount: 100,
      moduleFields: [{ fieldId: custom.id, fieldValue: 'EDIT_REJECT_SHOULD_RESTORE' }],
    },
  })
  assert.equal(await dynamicValue(targetClient, v2Order.id, custom.id), 'EDIT_REJECT_SHOULD_RESTORE')
  const updateRejectPending = await pending(adminToken, v2Order.id)
  await request(`/approvals/tasks/${updateRejectPending.myPendingTaskId}/reject`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'update reject post' },
  })
  const updateRejectedStored = await targetClient.order.findUniqueOrThrow({ where: { id: v2Order.id } })
  assert.equal(updateRejectedStored.name, v2Order.name, 'UPDATE reject must restore the pre-update main field')
  assert.equal(
    await dynamicValue(targetClient, v2Order.id, custom.id),
    'REJECT_V1',
    'UPDATE reject post field must be the final value after DB-010 restore',
  )
  assert.equal(
    await targetClient.approvalResourceSnapshot.count({
      where: { tenantId: admin.user.tenantId, formType: 'ORDER', resourceId: v2Order.id },
    }),
    0,
    'UPDATE reject must consume the DB-010 resource snapshot',
  )

  // ALL 节点只有真正完成时才执行 pass；第一人通过时字段保持原值。
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken,
    body: { ...settings(`W370_POST_ALL_${suffix}`), createNodes: [node([admin.user.id, manager.user.id], 'ALL', passV2, rejectV1)] },
  })
  const allOrder = await createOrder(lina.accessToken, lina.user.id, `${suffix}_ALL`, [
    { fieldId: custom.id, fieldValue: 'BEFORE_ALL' },
  ])
  const adminAll = await pending(adminToken, allOrder.id)
  await request(`/approvals/tasks/${adminAll.myPendingTaskId}/approve`, {
    method: 'POST', token: adminToken, expected: 201, body: { comment: 'first all' },
  })
  assert.equal(await dynamicValue(targetClient, allOrder.id, custom.id), 'BEFORE_ALL')
  const managerAll = await pending(manager.accessToken, allOrder.id)
  await request(`/approvals/tasks/${managerAll.myPendingTaskId}/approve`, {
    method: 'POST', token: manager.accessToken, expected: 201, body: { comment: 'second all' },
  })
  assert.equal(await dynamicValue(targetClient, allOrder.id, custom.id), 'PASS_V2')

  // AUTO_PASS 节点同样执行 passPostConfig。
  const autoName = `W370_POST_AUTO_NAME_${suffix}`
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken,
    body: { ...settings(`W370_POST_AUTO_${suffix}`), createNodes: [{
      ...node([admin.user.id], 'ANY', post(
        { fieldId: custom.id, fieldValue: 'AUTO_PASS', enable: true },
        { fieldId: nameField.id, fieldValue: autoName, enable: true },
      ), rejectV1),
      approverType: 'DIRECT_LEADER',
      approverIds: ['3'],
      sameSubmitterAction: 'SKIP',
    }] },
  })
  const autoOrder = await createOrder(lina.accessToken, lina.user.id, `${suffix}_AUTO`, [
    { fieldId: custom.id, fieldValue: 'BEFORE_AUTO' },
  ])
  assert.equal(await dynamicValue(targetClient, autoOrder.id, custom.id), 'AUTO_PASS')
  const autoStored = await targetClient.order.findUniqueOrThrow({ where: { id: autoOrder.id } })
  assert.equal(autoStored.name, autoName)
  const autoInstance = await targetClient.approvalInstance.findFirstOrThrow({ where: { targetId: autoOrder.id } })
  assert.equal(autoInstance.status, 'APPROVED')
  assert(autoInstance.targetName.includes(autoName))

  console.log(JSON.stringify({
    migrations: 68,
    flowRoundTrip: true,
    referenceGate: true,
    duplicateGate: true,
    enabledValueGate: true,
    safeFieldGate: true,
    frozenPostVersion: true,
    manualPass: true,
    disabledNoop: true,
    manualReject: true,
    updateRejectRestoreThenPost: true,
    allNodeCompletionOnly: true,
    autoPassPostUpdate: true,
    systemFieldPostUpdate: true,
    instanceDisplaySync: true,
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
