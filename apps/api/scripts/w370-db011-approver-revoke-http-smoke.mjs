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
  if (!line) throw new Error('W3.7 DB-011 approver-revoke smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db011_revoke_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 37500 + Math.floor(Math.random() * 1000)
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

function flowWrite(detail, enabled = detail.enabled) {
  return approvalFlowWriteFromDetail(detail, enabled)
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

let management
let targetClient
let api
try {
  console.log(`W3.7 DB-011 approver-revoke HTTP smoke: ${database}`)
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

  const [admin, manager, lina] = await Promise.all([
    login('admin@demo.com', 'admin123'),
    login('zhangwei@demo.com', 'admin123'),
    login('lina@demo.com', 'demo123'),
  ])
  const adminToken = admin.accessToken
  const managerToken = manager.accessToken
  const linaToken = lina.accessToken

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
      name: `W370_REVOKE_${suffix}`,
      description: 'W3.7-9.3D approver revoke isolated smoke',
      enabled: true,
      createExecute: true,
      updateExecute: false,
      deleteExecute: false,
      submitterCanRevoke: true,
      allowBatchProcess: false,
      allowWithdraw: true,
      allowAddSign: false,
      duplicateApproverRule: 'FIRST_ONLY',
      requireComment: false,
      condition: null,
      createNodes: [
        { name: '一级审批', approverType: 'USER', approverIds: [admin.user.id], ccUserIds: [], mode: 'ANY', sameSubmitterAction: 'ALLOW' },
        { name: '二级审批', approverType: 'USER', approverIds: [manager.user.id], ccUserIds: [], mode: 'ANY' },
        { name: '三级审批', approverType: 'USER', approverIds: [lina.user.id], ccUserIds: [], mode: 'ANY' },
      ],
    },
  })
  assert.equal(flow.allowWithdraw, true, 'allowWithdraw should be accepted after 9.3D runtime closes')

  const form = await request('/order/module/form', { token: adminToken })
  const customer = await request('/account/add', {
    method: 'POST', token: adminToken, body: { name: `W370_REVOKE_CUSTOMER_${suffix}` }, expected: 201,
  })
  const order = await request('/order/add', {
    method: 'POST',
    token: adminToken,
    expected: 201,
    body: {
      name: `W370_REVOKE_ORDER_${suffix}`,
      customerId: customer.id,
      owner: admin.user.id,
      amount: 100,
      moduleFields: [],
      moduleFormConfigDTO: form,
    },
  })

  const first = await pendingInstance(adminToken, order.id)
  const firstTaskId = first.myPendingTaskId
  await request(`/approvals/tasks/${firstTaskId}/approve`, {
    method: 'POST', token: adminToken, body: { comment: '一级首次通过' }, expected: 201,
  })
  const second = await pendingInstance(managerToken, order.id)
  const secondRound1TaskId = second.myPendingTaskId
  const adminHandled = await detail(adminToken, order.id)
  assert.equal(adminHandled.canWithdraw, true)
  assert.equal(adminHandled.myWithdrawTaskId, firstTaskId)

  // Owner gate: 下一节点审批人不能撤回上一个审批人的 task。
  await request(`/approvals/tasks/${firstTaskId}/revoke`, {
    method: 'POST', token: managerToken, expected: 404,
  })

  // Flow gate: 即使 VO 之前展示过 capability，服务端也会实时重验 allowWithdraw。
  await targetClient.approvalFlow.update({ where: { id: flow.id }, data: { allowWithdraw: false } })
  await request(`/approvals/tasks/${firstTaskId}/revoke`, {
    method: 'POST', token: adminToken, expected: 400,
  })
  await targetClient.approvalFlow.update({ where: { id: flow.id }, data: { allowWithdraw: true } })

  const firstRecordBefore = await targetClient.approvalRecord.findFirstOrThrow({
    where: { taskId: firstTaskId },
  })
  const revokedFirst = await request(`/approvals/tasks/${firstTaskId}/revoke`, {
    method: 'POST', token: adminToken, expected: 201,
  })
  assert.equal(revokedFirst.nodeRound, 1)

  const afterFirstRevoke = await detail(adminToken, order.id)
  assert.equal(afterFirstRevoke.currentNodeIndex, 0)
  const reopenedFirst = afterFirstRevoke.tasks.find((task) => task.id === firstTaskId)
  assert.equal(reopenedFirst.status, 'PENDING')
  assert.equal(reopenedFirst.action, null)
  assert.equal(reopenedFirst.handledAt, null)
  const expiredSecond = afterFirstRevoke.tasks.find((task) => task.id === secondRound1TaskId)
  assert.equal(expiredSecond.status, 'SKIPPED')
  assert.equal(afterFirstRevoke.myPendingTaskId, firstTaskId, 'revoke reopens the same task, not a cloned task')
  const firstRecordsAfterRevoke = await targetClient.approvalRecord.findMany({ where: { taskId: firstTaskId } })
  assert.equal(firstRecordsAfterRevoke.length, 1, 'REVOKE itself must not add/delete ApprovalRecord')
  assert.equal(firstRecordsAfterRevoke[0].id, firstRecordBefore.id)

  // Re-approve with a new comment: same task/node/round record is delete+created, not duplicated.
  await request(`/approvals/tasks/${firstTaskId}/approve`, {
    method: 'POST', token: adminToken, body: { comment: '一级重新确认通过' }, expected: 201,
  })
  const firstRecordsAfterReapprove = await targetClient.approvalRecord.findMany({ where: { taskId: firstTaskId } })
  assert.equal(firstRecordsAfterReapprove.length, 1)
  assert.notEqual(firstRecordsAfterReapprove[0].id, firstRecordBefore.id)
  assert.equal(firstRecordsAfterReapprove[0].comment, '一级重新确认通过')
  const secondRound2 = await pendingInstance(managerToken, order.id)
  const secondRound2Task = secondRound2.tasks.find((task) => task.id === secondRound2.myPendingTaskId)
  assert.equal(secondRound2Task.nodeRound, 2, '下游旧 PENDING round 失效后必须以 round 2 重建')

  await request(`/approvals/tasks/${secondRound2.myPendingTaskId}/approve`, {
    method: 'POST', token: managerToken, body: { comment: '二级通过' }, expected: 201,
  })
  const thirdRound1 = await pendingInstance(linaToken, order.id)
  const thirdRound1TaskId = thirdRound1.myPendingTaskId
  const managerHandled = await detail(managerToken, order.id)
  assert.equal(managerHandled.canWithdraw, true)
  assert.equal(managerHandled.myWithdrawTaskId, secondRound2.myPendingTaskId)

  // 一级 task 已跨过一个真正执行完成的中间节点，必须 fail-closed。
  const adminNow = await detail(adminToken, order.id)
  assert.equal(adminNow.canWithdraw, false)
  await request(`/approvals/tasks/${firstTaskId}/revoke`, {
    method: 'POST', token: adminToken, expected: 400,
  })

  const managerRecordBefore = await targetClient.approvalRecord.findFirstOrThrow({
    where: { taskId: secondRound2.myPendingTaskId },
  })
  await request(`/approvals/tasks/${secondRound2.myPendingTaskId}/revoke`, {
    method: 'POST', token: managerToken, expected: 201,
  })
  const afterSecondRevoke = await detail(managerToken, order.id)
  assert.equal(afterSecondRevoke.currentNodeIndex, 1)
  const oldThird = afterSecondRevoke.tasks.find((task) => task.id === thirdRound1TaskId)
  assert.equal(oldThird.status, 'SKIPPED')

  // Re-approve without a new comment: Cordys keeps the prior same-slot record unchanged.
  await request(`/approvals/tasks/${secondRound2.myPendingTaskId}/approve`, {
    method: 'POST', token: managerToken, body: {}, expected: 201,
  })
  const managerRecordAfter = await targetClient.approvalRecord.findMany({
    where: { taskId: secondRound2.myPendingTaskId },
  })
  assert.equal(managerRecordAfter.length, 1)
  assert.equal(managerRecordAfter[0].id, managerRecordBefore.id)
  assert.equal(managerRecordAfter[0].comment, '二级通过')
  const thirdRound2 = await pendingInstance(linaToken, order.id)
  const thirdRound2Task = thirdRound2.tasks.find((task) => task.id === thirdRound2.myPendingTaskId)
  assert.equal(thirdRound2Task.nodeRound, 2)

  await request(`/approvals/tasks/${thirdRound2.myPendingTaskId}/approve`, {
    method: 'POST', token: linaToken, body: { comment: '三级通过' }, expected: 201,
  })
  const done = await detail(adminToken, order.id)
  assert.equal(done.status, 'APPROVED')
  await request(`/approvals/tasks/${secondRound2.myPendingTaskId}/revoke`, {
    method: 'POST', token: managerToken, expected: 400,
  })

  console.log(JSON.stringify({
    database,
    migrations: 68,
    allowWithdrawConfig: true,
    ownerGate: true,
    flowGate: true,
    revokeSameTask: true,
    downstreamSkip: true,
    recordPreservedOnRevoke: true,
    recordDeleteCreateOnReapprove: true,
    recordPreservedWithoutNewComment: true,
    downstreamRound2Rebuild: true,
    olderTaskFailClosed: true,
    finishedInstanceGate: true,
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
