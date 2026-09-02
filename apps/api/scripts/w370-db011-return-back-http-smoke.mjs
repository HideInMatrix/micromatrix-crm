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
  if (!line) throw new Error('W3.7 DB-011 return-back smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db011_back_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 36500 + Math.floor(Math.random() * 1000)
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
  console.log(`W3.7 DB-011 return-back HTTP smoke: ${database}`)
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

  const [admin, zhangwei] = await Promise.all([
    login('admin@demo.com', 'admin123'),
    login('zhangwei@demo.com', 'admin123'),
  ])
  const token = admin.accessToken
  const adminId = admin.user.id
  const zhangweiId = zhangwei.user.id

  const existing = await request('/approvals/flows?formType=order&page=1&pageSize=100', { token })
  for (const item of existing.items) {
    const current = await request(`/approvals/flows/${item.id}`, { token })
    await request(`/approvals/flows/${item.id}`, {
      method: 'PUT', token, body: flowWrite(current, false),
    })
  }

  const suffix = Date.now().toString(36)
  const flow = await request('/approvals/flows', {
    method: 'POST',
    token,
    expected: 201,
    body: {
      formType: 'order',
      name: `W370_BACK_${suffix}`,
      description: 'W3.7-9.3C return-back isolated smoke',
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
      createNodes: [
        {
          name: '一级审批', approverType: 'USER', approverIds: [adminId], ccUserIds: [], mode: 'ANY', sameSubmitterAction: 'ALLOW',
        },
        {
          name: '二级审批', approverType: 'USER', approverIds: [zhangweiId], ccUserIds: [], mode: 'ANY',
        },
      ],
    },
  })
  assert(flow?.id, 'test flow missing')

  const flowDetail = await request(`/approvals/flows/${flow.id}`, { token })
  const approverNodes = flowDetail.createNodes.filter((node) => node.nodeType === 'APPROVER')
  assert.equal(approverNodes.length, 2)
  const firstNodeId = approverNodes[0].id
  const secondNodeId = approverNodes[1].id

  const form = await request('/order/module/form', { token })
  const customer = await request('/account/add', {
    method: 'POST', token, body: { name: `W370_BACK_CUSTOMER_${suffix}` }, expected: 201,
  })
  const order = await request('/order/add', {
    method: 'POST',
    token,
    expected: 201,
    body: {
      name: `W370_BACK_ORDER_${suffix}`,
      customerId: customer.id,
      owner: adminId,
      amount: 100,
      moduleFields: [],
      moduleFormConfigDTO: form,
    },
  })

  const first = await pendingInstance(token, order.id)
  assert.equal(first.canReturnBack, false, 'first node has no historical target')
  await request(`/approvals/tasks/${first.myPendingTaskId}/back`, {
    method: 'POST', token, body: { returnToNodeId: firstNodeId }, expected: 400,
  })
  await request(`/approvals/tasks/${first.myPendingTaskId}/back`, {
    method: 'POST', token, body: { returnToNodeId: randomUUID() }, expected: 400,
  })

  await request(`/approvals/tasks/${first.myPendingTaskId}/approve`, {
    method: 'POST', token, body: { comment: '一级首轮通过' }, expected: 201,
  })
  const second = await pendingInstance(zhangwei.accessToken, order.id)
  assert.equal(second.canReturnBack, true)
  assert.equal(second.returnBackTargets.length, 1)
  assert.equal(second.returnBackTargets[0].nodeId, firstNodeId)
  assert.equal(second.returnBackTargets[0].nextRound, 2)

  // Owner gate: admin cannot operate zhangwei's pending task.
  await request(`/approvals/tasks/${second.myPendingTaskId}/back`, {
    method: 'POST', token, body: { returnToNodeId: firstNodeId }, expected: 404,
  })
  await request(`/approvals/tasks/${second.myPendingTaskId}/back`, {
    method: 'POST', token: zhangwei.accessToken,
    body: { returnToNodeId: secondNodeId, comment: '不能退当前节点' }, expected: 400,
  })

  const back1 = await request(`/approvals/tasks/${second.myPendingTaskId}/back`, {
    method: 'POST', token: zhangwei.accessToken,
    body: { returnToNodeId: firstNodeId, comment: '退回一级重审' }, expected: 201,
  })
  assert.equal(back1.nodeRound, 2)
  const afterBack1 = await detail(token, order.id)
  assert.equal(afterBack1.currentNodeIndex, 0)
  assert.equal(afterBack1.returnBackRecords.length, 1)
  assert.equal(afterBack1.returnBackRecords[0].returnReason, '退回一级重审')
  const firstReturnBackRecordId = afterBack1.returnBackRecords[0].id
  const oldSecond = afterBack1.tasks.find((task) => task.id === second.myPendingTaskId)
  assert.equal(oldSecond.action, 'BACK')
  assert.equal(oldSecond.status, 'PENDING')
  assert.equal(afterBack1.records.some((record) => record.taskId === second.myPendingTaskId), false,
    'BACK must not create ApprovalRecord')
  const adminRound2 = await pendingInstance(token, order.id)
  const adminRound2Task = adminRound2.tasks.find((task) => task.id === adminRound2.myPendingTaskId)
  assert.equal(adminRound2Task.nodeId, firstNodeId)
  assert.equal(adminRound2Task.nodeRound, 2)

  // Repeating the same BACK action on the old source task is rejected.
  await request(`/approvals/tasks/${second.myPendingTaskId}/back`, {
    method: 'POST', token: zhangwei.accessToken,
    body: { returnToNodeId: firstNodeId }, expected: 400,
  })

  await request(`/approvals/tasks/${adminRound2.myPendingTaskId}/approve`, {
    method: 'POST', token, body: { comment: '一级第二轮通过' }, expected: 201,
  })
  const secondRound2 = await pendingInstance(zhangwei.accessToken, order.id)
  const secondRound2Task = secondRound2.tasks.find((task) => task.id === secondRound2.myPendingTaskId)
  assert.equal(secondRound2Task.nodeId, secondNodeId)
  assert.equal(secondRound2Task.nodeRound, 2, 're-entered downstream node must rebuild as round 2')
  assert.equal(secondRound2.returnBackTargets[0].nextRound, 3)

  const back2 = await request(`/approvals/tasks/${secondRound2.myPendingTaskId}/back`, {
    method: 'POST', token: zhangwei.accessToken,
    body: { returnToNodeId: firstNodeId, comment: '再次退回一级' }, expected: 201,
  })
  assert.equal(back2.nodeRound, 3)
  const afterBack2 = await detail(token, order.id)
  assert.equal(afterBack2.returnBackRecords.length, 1,
    'same instance + target keeps only latest Cordys return-back record')
  assert.equal(afterBack2.returnBackRecords[0].taskId, secondRound2.myPendingTaskId)
  assert.equal(afterBack2.returnBackRecords[0].returnReason, '再次退回一级')
  assert.notEqual(afterBack2.returnBackRecords[0].id, firstReturnBackRecordId,
    'Cordys semantics delete the prior return-back record and insert a new record')
  assert(afterBack2.records.some((record) => record.nodeId === firstNodeId && record.nodeRound === 1))
  assert(afterBack2.records.some((record) => record.nodeId === firstNodeId && record.nodeRound === 2))

  const adminRound3 = await pendingInstance(token, order.id)
  const adminRound3Task = adminRound3.tasks.find((task) => task.id === adminRound3.myPendingTaskId)
  assert.equal(adminRound3Task.nodeRound, 3)
  await request(`/approvals/tasks/${adminRound3.myPendingTaskId}/approve`, {
    method: 'POST', token, body: { comment: '一级第三轮通过' }, expected: 201,
  })
  const secondRound3 = await pendingInstance(zhangwei.accessToken, order.id)
  const secondRound3Task = secondRound3.tasks.find((task) => task.id === secondRound3.myPendingTaskId)
  assert.equal(secondRound3Task.nodeRound, 3)
  await request(`/approvals/tasks/${secondRound3.myPendingTaskId}/approve`, {
    method: 'POST', token: zhangwei.accessToken, body: { comment: '二级第三轮通过' }, expected: 201,
  })
  const done = await detail(token, order.id)
  assert.equal(done.status, 'APPROVED')

  const storedBack = await targetClient.approvalReturnBackRecord.findMany({
    where: { instanceId: done.id },
  })
  assert.equal(storedBack.length, 1)
  assert.equal(storedBack[0].returnToNodeId, firstNodeId)
  assert.equal(storedBack[0].returnUserId, zhangweiId)

  console.log(JSON.stringify({
    database,
    migrations: 65,
    validBack: true,
    invalidTargetGate: true,
    currentNodeGate: true,
    ownerGate: true,
    repeatGate: true,
    returnBackRecord: true,
    backWithoutApprovalRecord: true,
    round2Rebuild: true,
    round3Rebuild: true,
    immutableHistory: true,
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
