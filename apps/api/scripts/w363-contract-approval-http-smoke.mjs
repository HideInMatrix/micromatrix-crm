import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const repoRoot = new URL('../../../', import.meta.url)
const apiRoot = new URL('../', import.meta.url)
const requireFromApi = createRequire(new URL('../package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.6.3 contract smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w363_contract_http_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source)
target.pathname = `/${database}`
const managementUrl = new URL(source)
managementUrl.pathname = '/postgres'
const port = 31363
const base = `http://127.0.0.1:${port}/api`
const nodeDir = new URL('.', `file://${process.execPath}`).pathname
const env = {
  ...process.env,
  DATABASE_URL: target.toString(),
  PORT: String(port),
  SWAGGER_ENABLED: 'false',
  PATH: `${nodeDir}:${process.env.PATH ?? ''}`,
}

async function prismaClient(connectionString) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

function run(program, args, cwd = repoRoot) {
  const result = spawnSync(program, args, { cwd, env, encoding: 'utf8' })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} failed: ${result.status}`)
}

async function request(path, { method = 'GET', token, body, allow = [] } = {}) {
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
  if (!response.ok && !allow.includes(response.status)) {
    throw new Error(`${method} ${path} -> ${response.status} ${text}`)
  }
  return { status: response.status, data, text }
}

async function waitHealth(child) {
  let childOutput = ''
  child.stdout?.on('data', (chunk) => { childOutput += chunk.toString() })
  child.stderr?.on('data', (chunk) => { childOutput += chunk.toString() })
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`isolated API exited: ${child.exitCode}\n${childOutput}`)
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {
      // Isolated API may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 125))
  }
  throw new Error(`isolated API health timeout\n${childOutput}`)
}

async function pendingTask(prisma, targetId) {
  const task = await prisma.approvalTask.findFirst({
    where: { status: 'PENDING', instance: { module: 'contract', targetId } },
    orderBy: { createdAt: 'desc' },
  })
  assert(task, `contract ${targetId} pending approval task missing`)
  return task
}

async function latestInstance(prisma, targetId) {
  const instance = await prisma.approvalInstance.findFirst({
    where: { module: 'contract', targetId },
    orderBy: { createdAt: 'desc' },
  })
  assert(instance, `contract ${targetId} approval instance missing`)
  return instance
}

let management
let prisma
let api
try {
  console.log(`W3.6.3 contract approval HTTP smoke: ${database}`)
  management = await prismaClient(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'prisma', 'migrate', 'deploy'])
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])

  prisma = await prismaClient(target.toString())
  api = spawn(process.execPath, ['dist/main.js'], { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitHealth(api)

  const login = (await request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@demo.com', password: 'admin123' },
  })).data
  const token = login.accessToken
  const userId = login.user.id
  const tenantId = login.user.tenantId
  const customer = await prisma.customer.findFirst({
    where: { organizationId: tenantId, inSharedPool: false },
    select: { id: true, name: true },
  })
  assert(customer, 'seed customer missing')

  const prefix = `W363_${Date.now()}`
  const product = (await request('/product/add', {
    method: 'POST', token,
    body: { name: `${prefix}_PRODUCT`, price: 100, status: '1' },
  })).data

  const flowBody = {
    name: `${prefix}_FLOW`,
    enabled: true,
    createExecute: true,
    updateExecute: true,
    deleteExecute: true,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: false,
    allowAddSign: false,
    duplicateApproverRule: 'FIRST_ONLY',
    requireComment: false,
    condition: null,
    createNodes: [{
      name: '管理员审批', approverType: 'USER', approverIds: [userId], ccUserIds: [], mode: 'ANY',
    }],
  }
  const existingFlows = (await request('/approvals/flows?formType=contract', { token })).data
  if (existingFlows.items.length) {
    await request(`/approvals/flows/${existingFlows.items[0].id}`, { method: 'PUT', token, body: flowBody })
  } else {
    await request('/approvals/flows', { method: 'POST', token, body: { formType: 'contract', ...flowBody } })
  }

  const originalName = `${prefix}_CONTRACT`
  const contract = (await request('/contracts', {
    method: 'POST', token,
    body: {
      name: originalName,
      customerId: customer.id,
      ownerId: userId,
      startAt: '2026-08-29',
      endAt: '2026-12-31',
      items: [{ productId: product.id, productName: product.name, quantity: 2, unitPrice: 100 }],
      customData: {},
    },
  })).data
  assert.equal(contract.approvalStatus, 'APPROVING', 'CREATE should auto submit approval')
  assert.equal(contract.approved, false)
  assert.equal(contract.products.length, 1)
  assert.equal(contract.products[0].productNumber, 2)
  assert.equal(contract.amount, 200)
  assert.equal(await prisma.contractField.count({ where: { resourceId: contract.id } }) >= 3, true)
  assert.equal(await prisma.contractSnapshot.count({ where: { contractId: contract.id } }), 1)

  let task = await pendingTask(prisma, contract.id)
  await request(`/approvals/tasks/${task.id}/approve`, { method: 'POST', token, body: { comment: 'create ok' } })
  let current = (await request(`/contracts/${contract.id}`, { token })).data
  assert.equal(current.approvalStatus, 'APPROVED')
  assert.equal(current.approved, true)

  await request(`/contracts/${contract.id}`, {
    method: 'PATCH', token,
    body: { name: `${prefix}_EDIT_REJECT` },
  })
  current = (await request(`/contracts/${contract.id}`, { token })).data
  assert.equal(current.name, `${prefix}_EDIT_REJECT`)
  assert.equal(current.approvalStatus, 'APPROVING')
  task = await pendingTask(prisma, contract.id)
  await request(`/approvals/tasks/${task.id}/reject`, { method: 'POST', token, body: { comment: 'reject update' } })
  current = (await request(`/contracts/${contract.id}`, { token })).data
  assert.equal(current.name, originalName, 'UPDATE reject must restore business snapshot')
  assert.equal(current.approvalStatus, 'UNAPPROVED')
  assert.equal(current.approved, true)

  await request(`/contracts/${contract.id}`, {
    method: 'PATCH', token,
    body: { name: `${prefix}_EDIT_REVOKE` },
  })
  let instance = await latestInstance(prisma, contract.id)
  assert.equal(instance.executeTiming, 'UPDATE', 'contract update must always use UPDATE timing')
  await request(`/approvals/${instance.id}/cancel`, { method: 'POST', token })
  current = (await request(`/contracts/${contract.id}`, { token })).data
  assert.equal(current.name, originalName, 'UPDATE revoke must restore business snapshot')
  assert.equal(current.approvalStatus, 'REVOKED')
  assert.equal(current.approved, true)

  // Cordys deletion guard: payment record and invoice both block physical delete before approval submission.
  const record = await prisma.receivableRecord.create({
    data: {
      tenantId,
      contractId: contract.id,
      amount: 1,
      receivedAt: new Date(),
      approvalStatus: 'NONE',
      ownerId: userId,
    },
  })
  const blocked = await request(`/contracts/${contract.id}`, { method: 'DELETE', token, allow: [400] })
  assert.equal(blocked.status, 400)
  assert.match(blocked.text, /回款记录/)
  await prisma.receivableRecord.delete({ where: { id: record.id } })

  const deletion = (await request(`/contracts/${contract.id}`, { method: 'DELETE', token })).data
  assert.equal(deletion.pendingApproval, true, 'DELETE should wait for approval')
  const stillThere = await request(`/contracts/${contract.id}`, { token })
  assert.equal(stillThere.status, 200)
  task = await pendingTask(prisma, contract.id)
  await request(`/approvals/tasks/${task.id}/approve`, { method: 'POST', token, body: { comment: 'delete ok' } })
  const gone = await request(`/contracts/${contract.id}`, { token, allow: [404] })
  assert.equal(gone.status, 404, 'DELETE approval success must physically delete contract')

  console.log(JSON.stringify({
    createApproval: true,
    directProductFields: true,
    snapshot: true,
    updateTiming: 'UPDATE',
    updateRejectRollback: true,
    updateRevokeRollback: true,
    approvedFactPreserved: true,
    paymentRecordDeleteProtected: true,
    deleteDelayedUntilApproval: true,
    deleteApprovedPhysical: true,
  }, null, 2))
} finally {
  if (api && api.exitCode === null) {
    api.kill('SIGTERM')
    await new Promise((resolve) => api.once('exit', resolve)).catch(() => undefined)
  }
  if (prisma) await prisma.$disconnect().catch(() => undefined)
  if (!management) management = await prismaClient(managementUrl.toString())
  await management.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
  ).catch(() => undefined)
  await management.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`).catch(() => undefined)
  await management.$disconnect().catch(() => undefined)
}
