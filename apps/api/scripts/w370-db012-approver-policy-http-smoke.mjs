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
  if (!line) throw new Error('W3.7 DB-012 approver policy smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db012_policy_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 39800 + Math.floor(Math.random() * 500)
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

function settings(name, duplicateApproverRule = 'FIRST_ONLY') {
  return {
    name,
    description: 'W3.7-9.4B approver policy isolated smoke',
    enabled: true,
    createExecute: true,
    updateExecute: true,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: true,
    allowAddSign: true,
    duplicateApproverRule,
    requireComment: false,
    condition: null,
  }
}

function approverNode(name, approverType, approverIds, overrides = {}) {
  return {
    name,
    approverType,
    approverIds,
    ccUserIds: [],
    mode: 'ANY',
    emptyApproverAction: 'AUTO_PASS',
    fallbackApprover: null,
    sameSubmitterAction: 'ALLOW',
    approverDirection: 'BOTTOM_UP',
    ...overrides,
  }
}

async function createOrder(token, ownerId, suffix, amount = 100) {
  const form = await request('/order/module/form', { token })
  const customer = await request('/account/add', {
    method: 'POST', token, expected: 201, body: { name: `W370_DB012_POLICY_CUSTOMER_${suffix}` },
  })
  return request('/order/add', {
    method: 'POST', token, expected: 201,
    body: {
      name: `W370_DB012_POLICY_ORDER_${suffix}`,
      customerId: customer.id,
      owner: ownerId,
      amount,
      moduleFields: [],
      moduleFormConfigDTO: form,
    },
  })
}

async function instance(token, targetId) {
  return request(`/approvals/instance?module=order&targetId=${encodeURIComponent(targetId)}`, { token })
}

async function pending(token, targetId) {
  const page = await request('/approvals/my-pending?page=1&pageSize=100', { token })
  const item = page.items.find((entry) => entry.module === 'order' && entry.targetId === targetId)
  assert(item?.myPendingTaskId, `order ${targetId} should have pending task for current user`)
  return item
}

async function approve(token, taskId, comment) {
  return request(`/approvals/tasks/${taskId}/approve`, {
    method: 'POST', token, expected: 201, body: { comment },
  })
}

async function updateFlow(token, flowId, suffix, nodes, duplicateApproverRule = 'FIRST_ONLY') {
  return request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token,
    body: {
      ...settings(`W370_DB012_POLICY_${suffix}`, duplicateApproverRule),
      createNodes: nodes,
    },
  })
}

let management
let targetClient
let api
try {
  console.log(`W3.7 DB-012 approver policy HTTP smoke: ${database}`)
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
  assert.equal(migrations[0]?.count, 65, '9.4B isolated DB must apply exactly 65 migrations')

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

  // 为部门层级方向准备三层明确负责人：销售一部 -> 李娜，销售部 -> 张伟，根部门 -> 管理员。
  const linaDb = await targetClient.user.findUniqueOrThrow({ where: { id: lina.user.id }, select: { deptId: true } })
  const teamDept = await targetClient.department.findUniqueOrThrow({ where: { id: linaDb.deptId }, select: { id: true, parentId: true } })
  const salesDept = await targetClient.department.findUniqueOrThrow({ where: { id: teamDept.parentId }, select: { id: true, parentId: true } })
  const rootDept = await targetClient.department.findUniqueOrThrow({ where: { id: salesDept.parentId }, select: { id: true } })
  await targetClient.$transaction([
    targetClient.department.update({ where: { id: teamDept.id }, data: { leaderId: lina.user.id } }),
    targetClient.department.update({ where: { id: salesDept.id }, data: { leaderId: manager.user.id } }),
    targetClient.department.update({ where: { id: rootDept.id }, data: { leaderId: admin.user.id } }),
  ])

  const createdFlow = await request('/approvals/flows', {
    method: 'POST', token: adminToken, expected: 201,
    body: {
      formType: 'order',
      ...settings(`W370_DB012_POLICY_INIT_${suffix}`),
      createNodes: [approverNode('初始审批', 'USER', [admin.user.id])],
    },
  })
  const flowId = createdFlow.id
  assert(flowId, 'order flow should be created')

  // empty approver -> AUTO_PASS，同时必须留下 taskId=null 的自动 ApprovalRecord。
  const emptyConfig = await updateFlow(adminToken, flowId, `${suffix}_EMPTY`, [
    approverNode('空审批人自动通过', 'DIRECT_LEADER', ['3'], {
      emptyApproverAction: 'AUTO_PASS',
      sameSubmitterAction: 'SKIP',
    }),
  ])
  assert.equal(emptyConfig.createNodes.find((node) => node.nodeType === 'APPROVER')?.emptyApproverAction, 'AUTO_PASS')
  const emptyOrder = await createOrder(linaToken, lina.user.id, `${suffix}_EMPTY`)
  const emptyInstance = await instance(linaToken, emptyOrder.id)
  assert.equal(emptyInstance.status, 'APPROVED')
  assert.equal(emptyInstance.records.length, 1)
  assert.equal(emptyInstance.records[0].taskId, null)
  assert.match(emptyInstance.records[0].comment ?? '', /审批人为空/)

  // empty approver -> fallback，实际待办必须转给指定人员。
  await updateFlow(adminToken, flowId, `${suffix}_FALLBACK`, [
    approverNode('空审批人指定兜底', 'DIRECT_LEADER', ['3'], {
      emptyApproverAction: 'ASSIGN_SPECIFIC',
      fallbackApprover: admin.user.id,
    }),
  ])
  const fallbackOrder = await createOrder(linaToken, lina.user.id, `${suffix}_FALLBACK`)
  const fallbackPending = await pending(adminToken, fallbackOrder.id)
  assert.equal(fallbackPending.tasks.find((task) => task.status === 'PENDING')?.approverId, admin.user.id)
  await approve(adminToken, fallbackPending.myPendingTaskId, 'fallback pass')

  // fallback 必须是当前租户 ACTIVE 用户。
  await request(`/approvals/flows/${flowId}`, {
    method: 'PUT', token: adminToken, expected: 400,
    body: {
      ...settings(`W370_DB012_POLICY_BAD_FALLBACK_${suffix}`),
      createNodes: [
        approverNode('无效兜底', 'DIRECT_LEADER', ['3'], {
          emptyApproverAction: 'ASSIGN_SPECIFIC',
          fallbackApprover: randomUUID(),
        }),
      ],
    },
  })

  // sameSubmitter SKIP：提交人待办不进入待办箱，但保留 SKIPPED task + ApprovalRecord。
  await updateFlow(adminToken, flowId, `${suffix}_SAME_SKIP`, [
    approverNode('提交人自动跳过', 'USER', [lina.user.id], { sameSubmitterAction: 'SKIP' }),
  ])
  const sameSkipOrder = await createOrder(linaToken, lina.user.id, `${suffix}_SAME_SKIP`)
  const sameSkipInstance = await instance(linaToken, sameSkipOrder.id)
  assert.equal(sameSkipInstance.status, 'APPROVED')
  assert.equal(sameSkipInstance.tasks.length, 1)
  assert.equal(sameSkipInstance.tasks[0].status, 'SKIPPED')
  assert.equal(sameSkipInstance.tasks[0].action, 'APPROVE')
  assert.match(sameSkipInstance.records[0].comment ?? '', /提交人为同一人/)

  // sameSubmitter ASSIGN_SUPERIOR：李娜 -> 张伟。
  await updateFlow(adminToken, flowId, `${suffix}_SAME_SUPERIOR`, [
    approverNode('提交人转直属上级', 'USER', [lina.user.id], { sameSubmitterAction: 'ASSIGN_SUPERIOR' }),
  ])
  const sameSuperiorOrder = await createOrder(linaToken, lina.user.id, `${suffix}_SAME_SUPERIOR`)
  const sameSuperiorPending = await pending(managerToken, sameSuperiorOrder.id)
  assert.equal(sameSuperiorPending.tasks.find((task) => task.status === 'PENDING')?.approverId, manager.user.id)
  await approve(managerToken, sameSuperiorPending.myPendingTaskId, 'same submitter superior pass')

  // 直属上级方向：同一层级值 1，BOTTOM_UP=张伟，TOP_DOWN=管理员。
  await updateFlow(adminToken, flowId, `${suffix}_DIRECT_BOTTOM`, [
    approverNode('直属上级自下而上', 'DIRECT_LEADER', ['1'], { approverDirection: 'BOTTOM_UP' }),
  ])
  const directBottomOrder = await createOrder(linaToken, lina.user.id, `${suffix}_DIRECT_BOTTOM`)
  const directBottomPending = await pending(managerToken, directBottomOrder.id)
  assert.equal(directBottomPending.tasks.find((task) => task.status === 'PENDING')?.approverId, manager.user.id)
  await approve(managerToken, directBottomPending.myPendingTaskId, 'direct bottom pass')

  await updateFlow(adminToken, flowId, `${suffix}_DIRECT_TOP`, [
    approverNode('直属上级自上而下', 'DIRECT_LEADER', ['1'], { approverDirection: 'TOP_DOWN' }),
  ])
  const directTopOrder = await createOrder(linaToken, lina.user.id, `${suffix}_DIRECT_TOP`)
  const directTopPending = await pending(adminToken, directTopOrder.id)
  assert.equal(directTopPending.tasks.find((task) => task.status === 'PENDING')?.approverId, admin.user.id)
  await approve(adminToken, directTopPending.myPendingTaskId, 'direct top pass')

  // 部门负责人方向同样生效：level 1 BOTTOM_UP=李娜，TOP_DOWN=管理员。
  await updateFlow(adminToken, flowId, `${suffix}_DEPT_BOTTOM`, [
    approverNode('部门负责人自下而上', 'DEPT_LEADER', ['1'], {
      approverDirection: 'BOTTOM_UP',
      sameSubmitterAction: 'ALLOW',
    }),
  ])
  const deptBottomOrder = await createOrder(linaToken, lina.user.id, `${suffix}_DEPT_BOTTOM`)
  const deptBottomPending = await pending(linaToken, deptBottomOrder.id)
  assert.equal(deptBottomPending.tasks.find((task) => task.status === 'PENDING')?.approverId, lina.user.id)
  await approve(linaToken, deptBottomPending.myPendingTaskId, 'dept bottom pass')

  await updateFlow(adminToken, flowId, `${suffix}_DEPT_TOP`, [
    approverNode('部门负责人自上而下', 'DEPT_LEADER', ['1'], { approverDirection: 'TOP_DOWN' }),
  ])
  const deptTopOrder = await createOrder(linaToken, lina.user.id, `${suffix}_DEPT_TOP`)
  const deptTopPending = await pending(adminToken, deptTopOrder.id)
  assert.equal(deptTopPending.tasks.find((task) => task.status === 'PENDING')?.approverId, admin.user.id)
  await approve(adminToken, deptTopPending.myPendingTaskId, 'dept top pass')

  // FIRST_ONLY：张伟在节点 1 已审批，节点 3 再次出现时自动通过，即使中间隔着管理员节点。
  await updateFlow(adminToken, flowId, `${suffix}_FIRST_ONLY`, [
    approverNode('首次张伟', 'USER', [manager.user.id]),
    approverNode('中间管理员', 'USER', [admin.user.id]),
    approverNode('再次张伟', 'USER', [manager.user.id]),
  ], 'FIRST_ONLY')
  const firstOnlyOrder = await createOrder(linaToken, lina.user.id, `${suffix}_FIRST_ONLY`)
  const firstManager = await pending(managerToken, firstOnlyOrder.id)
  await approve(managerToken, firstManager.myPendingTaskId, 'first manager pass')
  const firstAdmin = await pending(adminToken, firstOnlyOrder.id)
  await approve(adminToken, firstAdmin.myPendingTaskId, 'middle admin pass')
  const firstOnlyInstance = await instance(linaToken, firstOnlyOrder.id)
  assert.equal(firstOnlyInstance.status, 'APPROVED')
  assert(firstOnlyInstance.tasks.some((task) => task.nodeName === '再次张伟' && task.status === 'SKIPPED'))
  assert(firstOnlyInstance.records.some((record) => /重复出现/.test(record.comment ?? '')))

  // SEQUENTIAL_ALL：只比较紧邻上一审批节点；隔一个管理员后张伟必须再次审批。
  await updateFlow(adminToken, flowId, `${suffix}_SEQUENTIAL`, [
    approverNode('顺序张伟1', 'USER', [manager.user.id]),
    approverNode('顺序管理员', 'USER', [admin.user.id]),
    approverNode('顺序张伟2', 'USER', [manager.user.id]),
  ], 'SEQUENTIAL_ALL')
  const sequentialOrder = await createOrder(linaToken, lina.user.id, `${suffix}_SEQUENTIAL`)
  const seqManager1 = await pending(managerToken, sequentialOrder.id)
  await approve(managerToken, seqManager1.myPendingTaskId, 'sequential manager first pass')
  const seqAdmin = await pending(adminToken, sequentialOrder.id)
  await approve(adminToken, seqAdmin.myPendingTaskId, 'sequential admin pass')
  const seqManager2 = await pending(managerToken, sequentialOrder.id)
  assert.equal(seqManager2.tasks.find((task) => task.status === 'PENDING')?.nodeName, '顺序张伟2')
  await approve(managerToken, seqManager2.myPendingTaskId, 'sequential manager second pass')

  // EACH：连续相同审批人也必须每个节点都审批。
  await updateFlow(adminToken, flowId, `${suffix}_EACH`, [
    approverNode('每次张伟1', 'USER', [manager.user.id]),
    approverNode('每次张伟2', 'USER', [manager.user.id]),
  ], 'EACH')
  const eachOrder = await createOrder(linaToken, lina.user.id, `${suffix}_EACH`)
  const each1 = await pending(managerToken, eachOrder.id)
  await approve(managerToken, each1.myPendingTaskId, 'each first pass')
  const each2 = await pending(managerToken, eachOrder.id)
  assert.equal(each2.tasks.find((task) => task.status === 'PENDING')?.nodeName, '每次张伟2')
  await approve(managerToken, each2.myPendingTaskId, 'each second pass')

  console.log(JSON.stringify({
    migrations: 65,
    emptyAutoPass: true,
    emptyAutoRecord: true,
    fallbackApprover: true,
    fallbackReferenceGate: true,
    sameSubmitterSkip: true,
    sameSubmitterAssignSuperior: true,
    directLeaderDirection: true,
    departmentLeaderDirection: true,
    duplicateFirstOnly: true,
    duplicateSequentialAll: true,
    duplicateEach: true,
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
