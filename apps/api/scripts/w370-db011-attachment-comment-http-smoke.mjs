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
  if (!line) throw new Error('W3.7 DB-011 attachment/comment smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db011_attach_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 38500 + Math.floor(Math.random() * 700)
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
        emptyApproverAction: node.emptyApproverAction,
        fallbackApprover: node.fallbackApprover,
        sameSubmitterAction: node.sameSubmitterAction,
        approverDirection: node.approverDirection,
      })),
  }
}

async function detail(token, targetId) {
  return request(`/approvals/instance?module=order&targetId=${encodeURIComponent(targetId)}`, { token })
}

async function pendingInstance(token, targetId) {
  const page = await request('/approvals/my-pending?page=1&pageSize=100', { token })
  const item = page.items.find((entry) => entry.module === 'order' && entry.targetId === targetId)
  assert(item?.myPendingTaskId, `order ${targetId} should have a pending task`)
  return item
}

async function createAttachment(client, tenantId, uploaderId, name) {
  return client.attachment.create({
    data: {
      tenantId,
      uploaderId,
      name,
      path: `smoke/${randomUUID()}-${name}`,
      size: name.length,
      mime: 'text/plain',
    },
  })
}

async function createOrder(token, userId, suffix) {
  const form = await request('/order/module/form', { token })
  const customer = await request('/account/add', {
    method: 'POST', token, body: { name: `W370_ATTACH_CUSTOMER_${suffix}` }, expected: 201,
  })
  const order = await request('/order/add', {
    method: 'POST',
    token,
    expected: 201,
    body: {
      name: `W370_ATTACH_ORDER_${suffix}`,
      customerId: customer.id,
      owner: userId,
      amount: 100,
      moduleFields: [],
      moduleFormConfigDTO: form,
    },
  })
  return { customer, order }
}

let management
let targetClient
let api
try {
  console.log(`W3.7 DB-011 attachment/comment HTTP smoke: ${database}`)
  run('pnpm', ['--filter', '@micromatrix/shared', 'build'], repoRoot, process.env)
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

  const [admin, manager, lina, wangqiang] = await Promise.all([
    login('admin@demo.com', 'admin123'),
    login('zhangwei@demo.com', 'admin123'),
    login('lina@demo.com', 'demo123'),
    login('wangqiang@demo.com', 'demo123'),
  ])
  const adminToken = admin.accessToken
  const managerToken = manager.accessToken
  const linaToken = lina.accessToken
  const wangToken = wangqiang.accessToken
  const tenantId = admin.user.tenantId

  const existing = await request('/approvals/flows?formType=order&page=1&pageSize=100', { token: adminToken })
  for (const item of existing.items) {
    const current = await request(`/approvals/flows/${item.id}`, { token: adminToken })
    await request(`/approvals/flows/${item.id}`, {
      method: 'PUT', token: adminToken, body: flowWrite(current, false),
    })
  }

  const suffix = Date.now().toString(36)
  const flow = await request('/approvals/flows', {
    method: 'POST',
    token: adminToken,
    expected: 201,
    body: {
      formType: 'order',
      name: `W370_ATTACH_${suffix}`,
      description: 'W3.7-9.3E requireComment + attachment isolated smoke',
      enabled: true,
      createExecute: true,
      updateExecute: false,
      deleteExecute: false,
      submitterCanRevoke: true,
      allowBatchProcess: false,
      allowWithdraw: true,
      allowAddSign: true,
      duplicateApproverRule: 'FIRST_ONLY',
      requireComment: true,
      condition: null,
      createNodes: [
        { name: '一级审批', approverType: 'USER', approverIds: [admin.user.id], ccUserIds: [], mode: 'ANY', sameSubmitterAction: 'ALLOW' },
        { name: '二级审批', approverType: 'USER', approverIds: [manager.user.id], ccUserIds: [], mode: 'ANY' },
        { name: '三级审批', approverType: 'USER', approverIds: [lina.user.id], ccUserIds: [], mode: 'ANY' },
      ],
    },
  })
  assert.equal(flow.requireComment, true, 'requireComment should be accepted after 9.3E')

  const firstOrder = await createOrder(adminToken, admin.user.id, suffix)
  const first = await pendingInstance(adminToken, firstOrder.order.id)
  assert.equal(first.requireComment, true)

  await request(`/approvals/tasks/${first.myPendingTaskId}/approve`, {
    method: 'POST', token: adminToken, body: {}, expected: 400,
  })

  const firstAttachment = await createAttachment(targetClient, tenantId, admin.user.id, 'first.txt')
  const crossTenantAttachment = await createAttachment(
    targetClient,
    `cross-${randomUUID()}`,
    admin.user.id,
    'cross.txt',
  )
  const mountedAttachment = await targetClient.attachment.create({
    data: {
      tenantId,
      uploaderId: admin.user.id,
      name: 'mounted.txt',
      path: `smoke/${randomUUID()}-mounted.txt`,
      size: 7,
      mime: 'text/plain',
      targetType: 'order',
      targetId: firstOrder.order.id,
    },
  })
  await request(`/approvals/tasks/${first.myPendingTaskId}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { comment: '一级通过', attachmentIds: [crossTenantAttachment.id] },
    expected: 400,
  })
  await request(`/approvals/tasks/${first.myPendingTaskId}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { comment: '一级通过', attachmentIds: [mountedAttachment.id] },
    expected: 400,
  })
  await request(`/approvals/tasks/${first.myPendingTaskId}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { comment: '一级通过', attachmentIds: [firstAttachment.id] },
    expected: 201,
  })
  const firstRecord = await targetClient.approvalRecord.findFirstOrThrow({
    where: { taskId: first.myPendingTaskId },
  })
  const firstRelation = await targetClient.approvalInstanceAttachment.findFirstOrThrow({
    where: { instanceId: first.id, elementId: firstRecord.id, attachmentId: firstAttachment.id },
  })
  assert(firstRelation.id)
  const afterFirst = await detail(adminToken, firstOrder.order.id)
  assert(
    afterFirst.approvalAttachments.some(
      (relation) => relation.elementId === firstRecord.id && relation.attachment.id === firstAttachment.id,
    ),
    'detail should expose approval record attachment',
  )
  await request(`/attachments/${firstAttachment.id}`, {
    method: 'DELETE', token: adminToken, expected: 400,
  })

  const second = await pendingInstance(managerToken, firstOrder.order.id)
  const signAttachment = await createAttachment(targetClient, tenantId, manager.user.id, 'sign-after.txt')
  const signed = await request(`/approvals/tasks/${second.myPendingTaskId}/sign`, {
    method: 'POST',
    token: managerToken,
    body: {
      type: 'AFTER',
      signApprover: wangqiang.user.id,
      comment: '后置加签',
      attachmentIds: [signAttachment.id],
    },
    expected: 201,
  })
  assert(signed.id)
  const addSignRelation = await targetClient.approvalAddSignTask.findUniqueOrThrow({
    where: { taskId: signed.id },
  })
  const managerRecord = await targetClient.approvalRecord.findFirstOrThrow({
    where: { taskId: second.myPendingTaskId },
  })
  const signAttachmentRelations = await targetClient.approvalInstanceAttachment.findMany({
    where: { instanceId: first.id, attachmentId: signAttachment.id },
  })
  assert.deepEqual(
    new Set(signAttachmentRelations.map((relation) => relation.elementId)),
    new Set([addSignRelation.id, managerRecord.id]),
    'Cordys AFTER sign binds the same attachment to ApprovalRecord and ApprovalAddSignTask',
  )

  const signPending = await pendingInstance(wangToken, firstOrder.order.id)
  await request(`/approvals/tasks/${signPending.myPendingTaskId}/approve`, {
    method: 'POST', token: wangToken, body: {}, expected: 400,
  })
  await request(`/approvals/tasks/${signPending.myPendingTaskId}/approve`, {
    method: 'POST', token: wangToken, body: { comment: '加签通过' }, expected: 201,
  })

  const third = await pendingInstance(linaToken, firstOrder.order.id)
  const backAttachment = await createAttachment(targetClient, tenantId, lina.user.id, 'back.txt')
  const firstNodeId = first.nodesSnapshot[0].nodeId
  await request(`/approvals/tasks/${third.myPendingTaskId}/back`, {
    method: 'POST',
    token: linaToken,
    body: {
      returnToNodeId: firstNodeId,
      comment: '退回一级',
      attachmentIds: [backAttachment.id],
    },
    expected: 201,
  })
  const backRecord = await targetClient.approvalReturnBackRecord.findFirstOrThrow({
    where: { instanceId: first.id, taskId: third.myPendingTaskId },
  })
  assert(
    await targetClient.approvalInstanceAttachment.findFirst({
      where: { instanceId: first.id, elementId: backRecord.id, attachmentId: backAttachment.id },
    }),
    'BACK attachment must bind to ApprovalReturnBackRecord.id',
  )

  const adminRound2 = await pendingInstance(adminToken, firstOrder.order.id)
  const oldRound2Attachment = await createAttachment(targetClient, tenantId, admin.user.id, 'round2-old.txt')
  await request(`/approvals/tasks/${adminRound2.myPendingTaskId}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { comment: '一级第二轮通过', attachmentIds: [oldRound2Attachment.id] },
    expected: 201,
  })
  const managerRound2 = await pendingInstance(managerToken, firstOrder.order.id)
  const oldRound2Record = await targetClient.approvalRecord.findFirstOrThrow({
    where: { taskId: adminRound2.myPendingTaskId },
  })
  assert(
    await targetClient.approvalInstanceAttachment.findFirst({
      where: { elementId: oldRound2Record.id, attachmentId: oldRound2Attachment.id },
    }),
  )

  await request(`/approvals/tasks/${adminRound2.myPendingTaskId}/revoke`, {
    method: 'POST', token: adminToken, expected: 201,
  })
  const newRound2Attachment = await createAttachment(targetClient, tenantId, admin.user.id, 'round2-new.txt')
  await request(`/approvals/tasks/${adminRound2.myPendingTaskId}/approve`, {
    method: 'POST',
    token: adminToken,
    body: { comment: '一级第二轮重新通过', attachmentIds: [newRound2Attachment.id] },
    expected: 201,
  })
  const newRound2Record = await targetClient.approvalRecord.findFirstOrThrow({
    where: { taskId: adminRound2.myPendingTaskId },
  })
  assert.notEqual(newRound2Record.id, oldRound2Record.id)
  assert.equal(
    await targetClient.approvalInstanceAttachment.count({ where: { elementId: oldRound2Record.id } }),
    0,
    're-approve with new attachment clears old record relation',
  )
  assert(
    await targetClient.approvalInstanceAttachment.findFirst({
      where: { elementId: newRound2Record.id, attachmentId: newRound2Attachment.id },
    }),
  )
  const expiredManagerRound2 = await detail(managerToken, firstOrder.order.id)
  assert.equal(
    expiredManagerRound2.tasks.find((task) => task.id === managerRound2.myPendingTaskId)?.status,
    'SKIPPED',
  )

  const managerRound3 = await pendingInstance(managerToken, firstOrder.order.id)
  await request(`/approvals/tasks/${managerRound3.myPendingTaskId}/approve`, {
    method: 'POST', token: managerToken, body: { comment: '二级最终通过' }, expected: 201,
  })
  const linaRound2 = await pendingInstance(linaToken, firstOrder.order.id)
  await request(`/approvals/tasks/${linaRound2.myPendingTaskId}/approve`, {
    method: 'POST', token: linaToken, body: { comment: '三级最终通过' }, expected: 201,
  })
  assert.equal((await detail(adminToken, firstOrder.order.id)).status, 'APPROVED')

  const flowDetail = await request(`/approvals/flows/${flow.id}`, { token: adminToken })
  await request(`/approvals/flows/${flow.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { ...flowWrite(flowDetail), requireComment: false },
  })
  const secondOrder = await createOrder(adminToken, admin.user.id, `${suffix}_optional`)
  const optionalFirst = await pendingInstance(adminToken, secondOrder.order.id)
  assert.equal(optionalFirst.requireComment, false)
  await request(`/approvals/tasks/${optionalFirst.myPendingTaskId}/approve`, {
    method: 'POST', token: adminToken, body: {}, expected: 201,
  })
  const optionalSecond = await pendingInstance(managerToken, secondOrder.order.id)
  await request(`/approvals/tasks/${optionalSecond.myPendingTaskId}/reject`, {
    method: 'POST', token: managerToken, body: {}, expected: 201,
  })
  assert.equal((await detail(adminToken, secondOrder.order.id)).status, 'REJECTED')

  console.log(JSON.stringify({
    database,
    migrations: 65,
    requireCommentConfig: true,
    requireCommentGate: true,
    optionalComment: true,
    optionalRejectComment: true,
    crossTenantAttachmentGate: true,
    mountedAttachmentGate: true,
    approvalRecordAttachment: true,
    boundAttachmentDeleteGate: true,
    addSignAttachment: true,
    addSignAfterDualRelation: true,
    backAttachment: true,
    revokeReapproveAttachmentReplacement: true,
    detailAttachmentVo: true,
    finalApproval: true,
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
