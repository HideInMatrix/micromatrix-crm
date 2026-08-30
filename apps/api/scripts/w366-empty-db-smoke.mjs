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
  if (!line) throw new Error('W3.6.6 empty-db smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w366_empty_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source); target.pathname = `/${database}`
const managementUrl = new URL(source); managementUrl.pathname = '/postgres'
const port = 34000 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${port}/api`
const nodeDir = new URL('.', `file://${process.execPath}`).pathname
const env = { ...process.env, DATABASE_URL: target.toString(), PORT: String(port), SWAGGER_ENABLED: 'false', PATH: `${nodeDir}:${process.env.PATH ?? ''}` }

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

async function request(path, { method = 'GET', token, body } = {}) {
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
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text}`)
  return { status: response.status, data }
}

async function waitHealth(child) {
  let output = ''
  child.stdout?.on('data', (chunk) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk) => { output += chunk.toString() })
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`isolated API exited ${child.exitCode}\n${output}`)
    try { if ((await fetch(`${base}/health`)).ok) return } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 125))
  }
  throw new Error(`isolated API health timeout\n${output}`)
}

async function login(email, password) {
  const result = await request('/auth/login', { method: 'POST', body: { email, password } })
  assert(result.data?.accessToken, `login failed: ${email}`)
  return result.data
}

async function tableCounts(prisma) {
  const tables = [
    'tenants', 'departments', 'roles', 'users', 'user_roles',
    'sys_module_form', 'sys_module_field', 'sys_module_field_blob',
    'opportunity_stage_config', 'contract_stage_config', 'sales_order_stage_config',
  ]
  const result = {}
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}"`)
    result[table] = Number(rows[0].count)
  }
  return result
}

function assertPageContains(page, id, label) {
  assert(Array.isArray(page?.list) && page.list.some((item) => item.id === id), `${label} missing ${id}`)
}

let management
let prisma
let api
try {
  console.log(`W3.6.6 empty-db smoke: ${database}`)
  management = await prismaClient(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)

  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'prisma', 'migrate', 'deploy'])
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])
  prisma = await prismaClient(target.toString())
  const countsAfterSeed1 = await tableCounts(prisma)

  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])
  const countsAfterSeed2 = await tableCounts(prisma)
  assert.deepEqual(countsAfterSeed2, countsAfterSeed1, 'second Seed changed baseline row counts')

  run('pnpm', ['--filter', '@micromatrix/api', 'build'])
  api = spawn(process.execPath, ['dist/main.js'], { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitHealth(api)

  const admin = await login('admin@demo.com', 'admin123')
  const manager = await login('zhangwei@demo.com', 'admin123')
  const lina = await login('lina@demo.com', 'demo123')
  assert(admin.user && manager.user && lina.user, 'seed demo users unavailable')
  const token = admin.accessToken
  const tenantId = admin.user.tenantId
  const userId = admin.user.id
  const prefix = `W366_EMPTY_${Date.now()}`

  await prisma.approvalFlow.updateMany({
    where: { tenantId, formType: { in: ['QUOTATION', 'CONTRACT', 'INVOICE', 'ORDER'] } },
    data: { enabled: false },
  })

  const formPaths = [
    '/opportunity/module/form',
    '/opportunity/quotation/module/form',
    '/contract/module/form',
    '/contract/payment-plan/module/form',
    '/contract/payment-record/module/form',
    '/invoice/module/form',
    '/order/module/form',
  ]
  const forms = {}
  for (const path of formPaths) {
    forms[path] = (await request(path, { token })).data
    assert(forms[path], `module form missing: ${path}`)
  }
  for (const path of ['/opportunity/stage/get', '/contract/stage/get', '/order/stage/get']) {
    const stage = (await request(path, { token })).data
    assert(Array.isArray(stage.stageConfigList) && stage.stageConfigList.length > 0, `stage config missing: ${path}`)
  }

  const customer = (await request('/account/add', { method: 'POST', token, body: { name: `${prefix}_CUSTOMER` } })).data
  const product = (await request('/product/add', { method: 'POST', token, body: { name: `${prefix}_PRODUCT`, price: 100, status: '1' } })).data
  const opportunity = (await request('/opportunity/add', {
    method: 'POST', token,
    body: { name: `${prefix}_OPPORTUNITY`, customerId: customer.id, owner: userId, amount: 100, products: [product.id] },
  })).data
  const quotation = (await request('/opportunity/quotation/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_QUOTATION`, opportunityId: opportunity.id, untilTime: Date.now() + 86_400_000,
      amount: 100, moduleFields: [], moduleFormConfigDTO: forms['/opportunity/quotation/module/form'],
      products: [{ product: product.id, productAmount: 100, discount: 100, tax: 0, amount: 100 }],
    },
  })).data
  const contract = (await request('/contract/add', {
    method: 'POST', token,
    body: { name: `${prefix}_CONTRACT`, customerId: customer.id, owner: userId, amount: 100, moduleFields: [], moduleFormConfigDTO: forms['/contract/module/form'] },
  })).data
  const plan = (await request('/contract/payment-plan/add', {
    method: 'POST', token,
    body: { name: `${prefix}_PLAN`, contractId: contract.id, owner: userId, planAmount: 100, planEndTime: Date.now() + 86_400_000 },
  })).data
  const record = (await request('/contract/payment-record/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_RECORD`, contractId: contract.id, paymentPlanId: plan.id, owner: userId,
      recordAmount: 10, recordEndTime: Date.now(),
      moduleFields: [
        { fieldId: 'contractPaymentRecordBank', fieldValue: '1' },
        { fieldId: 'contractPaymentRecordBankNo', fieldValue: '1' },
      ],
    },
  })).data
  const title = (await request('/contract/business-title/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_TITLE`, type: 'THIRD_PARTY', identificationNumber: `9131${randomUUID().replaceAll('-', '').slice(0, 14)}`,
      openingBank: '测试银行', bankAccount: `ACCT${Date.now()}`, registrationAddress: '测试地址', phoneNumber: '021-12345678',
      registrationNumber: `REG-${randomUUID().slice(0, 8)}`, province: '上海市', city: '上海市', scale: '中型', industry: '软件', remark: 'W3.6.6 7.3',
    },
  })).data
  const invoice = (await request('/invoice/add', {
    method: 'POST', token,
    body: { name: `${prefix}_INVOICE`, contractId: contract.id, owner: userId, businessTitleId: title.id, amount: 10, invoiceType: '增值税普通发票', taxRate: 0, moduleFields: [] },
  })).data
  const order = (await request('/order/add', {
    method: 'POST', token,
    body: { name: `${prefix}_ORDER`, customerId: customer.id, contractId: contract.id, owner: userId, amount: 100, moduleFields: [], moduleFormConfigDTO: forms['/order/module/form'] },
  })).data

  const resources = [
    ['/opportunity/page', '/opportunity/get/', opportunity],
    ['/opportunity/quotation/page', '/opportunity/quotation/get/', quotation],
    ['/contract/page', '/contract/get/', contract],
    ['/contract/payment-plan/page', '/contract/payment-plan/get/', plan],
    ['/contract/payment-record/page', '/contract/payment-record/get/', record],
    ['/invoice/page', '/invoice/get/', invoice],
    ['/order/page', '/order/get/', order],
  ]
  for (const [pagePath, getPrefix, row] of resources) {
    const page = (await request(pagePath, { method: 'POST', token, body: { current: 1, pageSize: 100, keyword: prefix } })).data
    assertPageContains(page, row.id, pagePath)
    assert.equal((await request(`${getPrefix}${row.id}`, { token })).data.id, row.id, `${getPrefix} detail mismatch`)
  }

  console.log(JSON.stringify({
    database,
    migrations56: true,
    seed1: true,
    seed2: true,
    seedCountsStable: true,
    countsAfterSeed2,
    demoLogins: true,
    sevenModuleForms: true,
    threeStageConfigs: true,
    runtimeSevenResources: true,
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
