import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const repoRoot = new URL('../../../', import.meta.url)
const apiRoot = new URL('../', import.meta.url)
const requireFromApi = createRequire(new URL('../package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')
const { ApprovalResourceRestoreService } = requireFromApi('./dist/modules/approvals/approval-resource-restore.service.js')
const migrationCount = readdirSync(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.7 DB-010 regression smoke requires DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w370_db010_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source)
target.pathname = `/${database}`
const managementUrl = new URL(source)
managementUrl.pathname = '/postgres'
const port = 31370
const base = `http://127.0.0.1:${port}/api`
const nodeDir = new URL('.', `file://${process.execPath}`).pathname
const env = {
  ...process.env,
  DATABASE_URL: target.toString(),
  PORT: String(port),
  SWAGGER_ENABLED: 'false',
  W362_API_BASE: base,
  API_BASE_URL: base,
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

async function waitHealth(child) {
  let childOutput = ''
  child.stdout?.on('data', (chunk) => { childOutput += chunk.toString() })
  child.stderr?.on('data', (chunk) => { childOutput += chunk.toString() })
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`isolated API exited: ${child.exitCode}\n${childOutput}`)
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {
      // API may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 125))
  }
  throw new Error(`isolated API health timeout\n${childOutput}`)
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text}`)
  return data
}

let management
let prisma
let api
try {
  console.log(`W3.7 DB-010 approval regression: ${database}`)
  management = await prismaClient(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)

  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'prisma', 'migrate', 'deploy'])
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])

  prisma = await prismaClient(target.toString())
  const admin = await prisma.user.findFirst({
    where: { email: 'admin@demo.com' },
    select: { id: true, tenantId: true },
  })
  if (!admin) throw new Error('seed admin missing')
  const customer = await prisma.customer.findFirst({
    where: { organizationId: admin.tenantId, inSharedPool: false },
    select: { id: true },
  })
  if (!customer) throw new Error('seed customer missing')
  const stage = await prisma.contractStageConfig.findFirst({
    where: { organizationId: admin.tenantId },
    orderBy: { pos: 'asc' },
    select: { id: true },
  })
  if (!stage) throw new Error('seed contract stage missing')
  const now = BigInt(Date.now())
  await prisma.contract.create({
    data: {
      name: 'W370 DB010 Invoice Fixture Contract',
      customerId: customer.id,
      owner: admin.id,
      amount: 1000,
      number: `W370-DB010-${Date.now()}`,
      approvalStatus: 'APPROVED',
      stage: stage.id,
      organizationId: admin.tenantId,
      approved: true,
      createTime: now,
      updateTime: now,
      createUser: admin.id,
      updateUser: admin.id,
    },
  })

  api = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitHealth(api)

  console.log('\n[DB-010] generic snapshot lifecycle')
  const legacyColumn = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS count
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'approval_instances'
        AND column_name = 'business_snapshot'`,
  )
  assert.equal(legacyColumn[0]?.count, 0, 'migration 59 must remove approval_instances.business_snapshot')

  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@demo.com', password: 'admin123' },
  })
  const token = login.accessToken
  const userId = login.user.id
  const prefix = `W370_DB010_${Date.now()}`
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
    createNodes: [
      {
        name: '管理员审批',
        approverType: 'USER',
        approverIds: [userId],
        ccUserIds: [],
        mode: 'ANY',
        sameSubmitterAction: 'ALLOW',
      },
    ],
  }
  const flows = await request('/approvals/flows?formType=quotation', { token })
  if (flows.items.length) {
    await request(`/approvals/flows/${flows.items[0].id}`, { method: 'PUT', token, body: flowBody })
  } else {
    await request('/approvals/flows', {
      method: 'POST',
      token,
      body: { formType: 'quotation', ...flowBody },
    })
  }
  const opportunity = await request('/opportunity/add', {
    method: 'POST',
    token,
    body: { name: `${prefix}_OPP`, amount: 500, owner: userId },
  })
  const quotationForm = await request('/opportunity/quotation/module/form', { token })
  const originalName = `${prefix}_QUOTE`
  const quotation = await request('/opportunity/quotation/add', {
    method: 'POST',
    token,
    body: {
      name: originalName,
      opportunityId: opportunity.id,
      untilTime: Date.now() + 86_400_000,
      amount: 100,
      moduleFields: [],
      moduleFormConfigDTO: quotationForm,
      products: [],
    },
  })
  await request('/opportunity/quotation/approve', {
    method: 'POST',
    token,
    body: { id: quotation.id, approvalStatus: 'APPROVED' },
  })

  const updateAndAssertSnapshot = async (suffix, amount) => {
    const comment = `${prefix}_${suffix}_COMMENT`
    const editedName = `${prefix}_${suffix}`
    await request('/opportunity/quotation/update', {
      method: 'POST',
      token,
      body: {
        id: quotation.id,
        name: editedName,
        amount,
        comment,
        moduleFields: [],
        moduleFormConfigDTO: quotationForm,
        products: [],
      },
    })
    const instance = await prisma.approvalInstance.findFirst({
      where: { tenantId: admin.tenantId, module: 'quote', targetId: quotation.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })
    assert(instance, 'UPDATE must create a pending approval instance')
    assert.equal(instance.executeTiming, 'UPDATE')
    assert.equal(instance.comment, comment, 'instance comment must persist the update submission comment')
    const updateFields = JSON.parse(instance.updateFields ?? '[]')
    assert(updateFields.includes('name'), 'updateFields must contain changed main field: name')
    assert(updateFields.includes('amount'), 'updateFields must contain changed main field: amount')
    const snapshots = await prisma.approvalResourceSnapshot.findMany({
      where: { tenantId: admin.tenantId, formType: 'QUOTATION', resourceId: quotation.id },
    })
    assert.equal(snapshots.length, 1, 'one resource may have exactly one active generic snapshot')
    const snapshotRoot = snapshots[0].snapshotData?.quotation
    assert.equal(snapshotRoot?.name, originalName, 'generic snapshot must preserve pre-update business state')
    return { snapshot: snapshots[0], editedName }
  }

  const rejected = await updateAndAssertSnapshot('EDIT_REJECT', 111)
  const crossTenantRestore = new ApprovalResourceRestoreService(prisma)
  await crossTenantRestore.restore(
    `other-${randomUUID()}`,
    'quote',
    quotation.id,
    rejected.snapshot.snapshotData,
    userId,
  )
  let current = await request(`/opportunity/quotation/get/${quotation.id}`, { token })
  assert.equal(current.name, rejected.editedName, 'cross-tenant restore attempt must not mutate the resource')
  await request('/opportunity/quotation/approve', {
    method: 'POST',
    token,
    body: { id: quotation.id, approvalStatus: 'UNAPPROVED' },
  })
  current = await request(`/opportunity/quotation/get/${quotation.id}`, { token })
  assert.equal(current.name, originalName, 'reject must restore the generic snapshot')
  assert.equal(
    await prisma.approvalResourceSnapshot.count({
      where: { tenantId: admin.tenantId, formType: 'QUOTATION', resourceId: quotation.id },
    }),
    0,
    'reject must clear the consumed generic snapshot',
  )

  await updateAndAssertSnapshot('EDIT_REVOKE', 122)
  await request(`/opportunity/quotation/revoke/${quotation.id}`, { token })
  current = await request(`/opportunity/quotation/get/${quotation.id}`, { token })
  assert.equal(current.name, originalName, 'submitter revoke must restore the generic snapshot')
  assert.equal(
    await prisma.approvalResourceSnapshot.count({
      where: { tenantId: admin.tenantId, formType: 'QUOTATION', resourceId: quotation.id },
    }),
    0,
    'submitter revoke must clear the consumed generic snapshot',
  )

  await updateAndAssertSnapshot('EDIT_APPROVE', 133)
  await request('/opportunity/quotation/approve', {
    method: 'POST',
    token,
    body: { id: quotation.id, approvalStatus: 'APPROVED' },
  })
  assert.equal(
    await prisma.approvalResourceSnapshot.count({
      where: { tenantId: admin.tenantId, formType: 'QUOTATION', resourceId: quotation.id },
    }),
    0,
    'approval success must clear the obsolete generic snapshot',
  )

  console.log('\n[DB-010] quotation approval regression')
  run(process.execPath, ['scripts/w362-quotation-approval-http-smoke.mjs'], apiRoot)

  console.log('\n[DB-010] invoice approval regression')
  run('pnpm', ['exec', 'tsx', 'scripts/w364-invoice-approval-smoke.ts'], apiRoot)

  console.log('\n[DB-010] order approval regression')
  run('pnpm', ['exec', 'tsx', 'scripts/w365-order-approval-smoke.ts'], apiRoot)

  console.log(JSON.stringify({
    database,
    migrations: migrationCount,
    legacyBusinessSnapshotColumnAbsent: true,
    genericSnapshotLifecycle: true,
    instanceUpdateFieldsAndComment: true,
    crossTenantRestoreFailClosed: true,
    quotationApprovalRegression: true,
    invoiceApprovalRegression: true,
    orderApprovalRegression: true,
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
