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
  if (!line) throw new Error('W3.7 DB-012 field permission smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db012_field_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 40300 + Math.floor(Math.random() * 400)
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
    description: 'W3.7-9.4C field permission isolated smoke',
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
  }
}

function approverNode(adminId, fieldPermissions) {
  return {
    name: '字段权限审批',
    approverType: 'USER',
    approverIds: [adminId],
    ccUserIds: [],
    mode: 'ANY',
    emptyApproverAction: 'AUTO_PASS',
    fallbackApprover: null,
    sameSubmitterAction: 'ALLOW',
    approverDirection: 'BOTTOM_UP',
    fieldPermissions,
  }
}

async function createOrder(token, ownerId, suffix, moduleFields) {
  const form = await request('/order/module/form', { token })
  const customer = await request('/account/add', {
    method: 'POST', token, expected: 201, body: { name: `W370_FIELD_CUSTOMER_${suffix}` },
  })
  return request('/order/add', {
    method: 'POST', token, expected: 201,
    body: {
      name: `W370_FIELD_ORDER_${suffix}`,
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
  assert(item?.myPendingTaskId, `order ${targetId} should have pending task for current user`)
  return item
}

async function detail(token, instanceId) {
  return request(`/approvals/instances/${instanceId}`, { token })
}

let management
let targetClient
let api
try {
  console.log(`W3.7 DB-012 field permission HTTP smoke: ${database}`)
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
  assert.equal(migrations[0]?.count, 68, '9.4C isolated DB must apply current 68 migrations')

  api = spawn(process.execPath, ['dist/main.js'], { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitHealth(api)

  const [admin, manager, lina, wangqiang] = await Promise.all([
    login('admin@demo.com', 'admin123'),
    login('zhangwei@demo.com', 'admin123'),
    login('lina@demo.com', 'demo123'),
    login('wangqiang@demo.com', 'demo123'),
  ])
  const suffix = Date.now().toString(36)
  const adminToken = admin.accessToken
  const linaToken = lina.accessToken

  const editable = await request('/metadata/order/fields', {
    method: 'POST', token: adminToken, expected: 201,
    body: { label: `审批可编辑_${suffix}`, type: 'text', required: false, hidden: false },
  })
  const readonly = await request('/metadata/order/fields', {
    method: 'POST', token: adminToken, expected: 201,
    body: { label: `审批只读_${suffix}`, type: 'text', required: false, hidden: false },
  })
  const hiddenByNode = await request('/metadata/order/fields', {
    method: 'POST', token: adminToken, expected: 201,
    body: { label: `审批隐藏_${suffix}`, type: 'text', required: false, hidden: false },
  })

  const orderFields = await request('/metadata/order/fields', { token: adminToken })
  const contractFields = await request('/metadata/contract/fields', { token: adminToken })
  const nameField = orderFields.find((field) => field.key === 'name')
  const amountField = orderFields.find((field) => field.key === 'amount')
  const metadataHidden = orderFields.find((field) => field.hidden)
  const foreignField = contractFields.find((field) => field.key === 'name')
  assert(nameField && amountField && metadataHidden && foreignField)

  const permissions = [
    { fieldId: nameField.id, permissionType: 'EDIT' },
    { fieldId: editable.id, permissionType: 'EDIT' },
    { fieldId: readonly.id, permissionType: 'VIEW' },
    { fieldId: hiddenByNode.id, permissionType: 'HIDDEN' },
  ]
  const createdFlow = await request('/approvals/flows', {
    method: 'POST', token: adminToken, expected: 201,
    body: {
      formType: 'order',
      ...settings(`W370_FIELD_${suffix}`),
      createNodes: [approverNode(admin.user.id, permissions)],
    },
  })
  const flowId = createdFlow.id
  const createdApprover = createdFlow.createNodes.find((node) => node.nodeType === 'APPROVER')
  assert.deepEqual(createdApprover.fieldPermissions, permissions)

  // 配置期 reference / editable gate。
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken, expected: 400,
    body: { ...settings(`W370_FIELD_BAD_FORM_${suffix}`), createNodes: [approverNode(admin.user.id, [{ fieldId: foreignField.id, permissionType: 'VIEW' }])] },
  })
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken, expected: 400,
    body: { ...settings(`W370_FIELD_BAD_FORMULA_${suffix}`), createNodes: [approverNode(admin.user.id, [{ fieldId: amountField.id, permissionType: 'EDIT' }])] },
  })
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken, expected: 400,
    body: { ...settings(`W370_FIELD_BAD_HIDDEN_${suffix}`), createNodes: [approverNode(admin.user.id, [{ fieldId: metadataHidden.id, permissionType: 'VIEW' }])] },
  })
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken, expected: 400,
    body: { ...settings(`W370_FIELD_DUP_${suffix}`), createNodes: [approverNode(admin.user.id, [
      { fieldId: editable.id, permissionType: 'VIEW' },
      { fieldId: editable.id, permissionType: 'EDIT' },
    ])] },
  })

  const firstOrder = await createOrder(linaToken, lina.user.id, `${suffix}_FIRST`, [
    { fieldId: editable.id, fieldValue: 'before-edit' },
    { fieldId: readonly.id, fieldValue: 'read-only-value' },
    { fieldId: hiddenByNode.id, fieldValue: 'hidden-value' },
  ])
  const firstPending = await pending(adminToken, firstOrder.id)
  const firstDetail = await detail(adminToken, firstPending.id)
  const fieldById = new Map(firstDetail.resourceFields.map((field) => [field.fieldId, field]))
  assert.equal(fieldById.get(nameField.id)?.permissionType, 'EDIT')
  assert.equal(fieldById.get(editable.id)?.permissionType, 'EDIT')
  assert.equal(fieldById.get(readonly.id)?.permissionType, 'VIEW')
  assert.equal(fieldById.has(hiddenByNode.id), false)

  // 非当前审批人只读：提交人可看普通表单字段，但不能继承当前节点 EDIT/HIDDEN。
  const submitterDetail = await detail(linaToken, firstPending.id)
  assert.equal(submitterDetail.resourceFields.find((field) => field.fieldId === editable.id)?.permissionType, 'VIEW')
  assert.equal(submitterDetail.resourceFields.find((field) => field.fieldId === hiddenByNode.id)?.permissionType, 'VIEW')
  await request(`/approvals/instances/${firstPending.id}`, { token: wangqiang.accessToken, expected: 404 })

  await request(`/approvals/tasks/${firstPending.myPendingTaskId}/fields`, {
    method: 'PATCH', token: adminToken, expected: 400,
    body: { fields: [{ fieldId: readonly.id, value: 'forbidden' }] },
  })
  await request(`/approvals/tasks/${firstPending.myPendingTaskId}/fields`, {
    method: 'PATCH', token: adminToken, expected: 400,
    body: { fields: [{ fieldId: hiddenByNode.id, value: 'forbidden' }] },
  })
  await request(`/approvals/tasks/${firstPending.myPendingTaskId}/fields`, {
    method: 'PATCH', token: linaToken, expected: 404,
    body: { fields: [{ fieldId: editable.id, value: 'cross-owner' }] },
  })

  const renamed = `W370_FIELD_RENAMED_${suffix}`
  await request(`/approvals/tasks/${firstPending.myPendingTaskId}/fields`, {
    method: 'PATCH', token: adminToken,
    body: { fields: [
      { fieldId: nameField.id, value: renamed },
      { fieldId: editable.id, value: 'after-edit' },
    ] },
  })
  const editedDetail = await detail(adminToken, firstPending.id)
  assert.equal(editedDetail.targetName, `订单 ${renamed}`)
  assert.equal(editedDetail.resourceFields.find((field) => field.fieldId === editable.id)?.value, 'after-edit')
  const storedOrder = await targetClient.order.findUniqueOrThrow({ where: { id: firstOrder.id } })
  assert.equal(storedOrder.name, renamed)
  const storedEditable = await targetClient.orderField.findFirstOrThrow({
    where: { resourceId: firstOrder.id, fieldId: editable.id },
  })
  assert.equal(storedEditable.fieldValue, 'after-edit')

  // BEFORE SIGN：来源节点权限全部降为 VIEW，SIGN task 不能调用字段写接口。
  await request(`/approvals/tasks/${firstPending.myPendingTaskId}/sign`, {
    method: 'POST', token: adminToken, expected: 201,
    body: { type: 'BEFORE', signApprover: manager.user.id, comment: 'field permission sign' },
  })
  const signPending = await pending(manager.accessToken, firstOrder.id)
  const signDetail = await detail(manager.accessToken, signPending.id)
  assert(signDetail.currentNodeFieldPermissions.every((permission) => permission.permissionType === 'VIEW'))
  assert.equal(signDetail.resourceFields.find((field) => field.fieldId === editable.id)?.permissionType, 'VIEW')
  assert.equal(signDetail.resourceFields.find((field) => field.fieldId === hiddenByNode.id)?.permissionType, 'VIEW')
  await request(`/approvals/tasks/${signPending.myPendingTaskId}/fields`, {
    method: 'PATCH', token: manager.accessToken, expected: 400,
    body: { fields: [{ fieldId: editable.id, value: 'sign-forbidden' }] },
  })
  await request(`/approvals/tasks/${signPending.myPendingTaskId}/approve`, {
    method: 'POST', token: manager.accessToken, expected: 201, body: { comment: 'sign pass' },
  })

  // 流程新版本降为 VIEW；在途实例继续使用冻结的 EDIT，新实例使用新权限。
  const viewPermissions = permissions.map((permission) =>
    permission.fieldId === editable.id || permission.fieldId === nameField.id
      ? { ...permission, permissionType: 'VIEW' }
      : permission,
  )
  const updatedFlow = await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken,
    body: { ...settings(`W370_FIELD_V2_${suffix}`), createNodes: [approverNode(admin.user.id, viewPermissions)] },
  })
  assert.equal(updatedFlow.currentVersion, 2)
  const frozenDetail = await detail(adminToken, firstPending.id)
  assert.equal(frozenDetail.resourceFields.find((field) => field.fieldId === editable.id)?.permissionType, 'EDIT')

  const secondOrder = await createOrder(linaToken, lina.user.id, `${suffix}_SECOND`, [
    { fieldId: editable.id, fieldValue: 'second-value' },
    { fieldId: readonly.id, fieldValue: 'second-readonly' },
    { fieldId: hiddenByNode.id, fieldValue: 'second-hidden' },
  ])
  const secondPending = await pending(adminToken, secondOrder.id)
  const secondDetail = await detail(adminToken, secondPending.id)
  assert.equal(secondDetail.resourceFields.find((field) => field.fieldId === editable.id)?.permissionType, 'VIEW')
  await request(`/approvals/tasks/${secondPending.myPendingTaskId}/fields`, {
    method: 'PATCH', token: adminToken, expected: 400,
    body: { fields: [{ fieldId: editable.id, value: 'v2-forbidden' }] },
  })

  console.log(JSON.stringify({
    migrations: 68,
    flowRoundTrip: true,
    referenceGate: true,
    editEligibilityGate: true,
    hiddenFieldGate: true,
    duplicatePermissionGate: true,
    hiddenViewEditDetail: true,
    nonCurrentReadOnly: true,
    taskOwnerGate: true,
    viewWriteGate: true,
    editWrite: true,
    systemFieldWrite: true,
    signDowngrade: true,
    signWriteGate: true,
    frozenPermissionVersion: true,
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
