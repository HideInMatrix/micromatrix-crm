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
  if (!line) throw new Error('W3.6.6 access-matrix smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w366_scope_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source)
target.pathname = `/${database}`
const managementUrl = new URL(source)
managementUrl.pathname = '/postgres'
const port = 33000 + Math.floor(Math.random() * 1000)
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
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`isolated API exited: ${child.exitCode}\n${childOutput}`)
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {
      // API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 125))
  }
  throw new Error(`isolated API health timeout\n${childOutput}`)
}

async function login(email, password) {
  const result = await request('/auth/login', { method: 'POST', body: { email, password } })
  assert(result.data?.accessToken, `login token missing for ${email}`)
  return result.data
}

function contains(page, id) {
  return Array.isArray(page?.list) && page.list.some((item) => item.id === id)
}

function assertContains(page, id, label) {
  assert(contains(page, id), `${label} should contain ${id}`)
}

function assertNotContains(page, id, label) {
  assert(!contains(page, id), `${label} leaked ${id}`)
}

async function expectHiddenDetail(path, token, label) {
  const result = await request(path, { token, allow: [403, 404] })
  assert([403, 404].includes(result.status), `${label} expected 403/404, got ${result.status}`)
}

async function expectRelationNoLeak(path, token, body, ids, label) {
  const result = await request(path, { method: 'POST', token, body, allow: [403, 404] })
  if ([403, 404].includes(result.status)) return
  assert([200, 201].includes(result.status), `${label} unexpected status ${result.status}`)
  for (const id of ids) assertNotContains(result.data, id, label)
}

let management
let prisma
let api
try {
  console.log(`W3.6.6 access-matrix smoke: ${database}`)
  management = await prismaClient(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)

  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'prisma', 'migrate', 'deploy'])
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])
  run('pnpm', ['--filter', '@micromatrix/api', 'build'])

  prisma = await prismaClient(target.toString())
  api = spawn(process.execPath, ['dist/main.js'], {
    cwd: apiRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitHealth(api)

  const admin = await login('admin@demo.com', 'admin123')
  const manager = await login('zhangwei@demo.com', 'admin123')
  const lina = await login('lina@demo.com', 'demo123')
  const tenantId = admin.user.tenantId
  const prefix = `W366_SCOPE_${Date.now()}`

  // 7.2 tests DataScope/tenant isolation, not approval branches.
  await prisma.approvalFlow.updateMany({
    where: { tenantId, formType: { in: ['QUOTATION', 'CONTRACT', 'INVOICE', 'ORDER'] } },
    data: { enabled: false },
  })

  const product = (await request('/product/add', {
    method: 'POST', token: admin.accessToken,
    body: { name: `${prefix}_PRODUCT`, price: 100, status: '1' },
  })).data
  assert(product?.id, 'shared product create failed')

  async function createChain(actor, label) {
    const token = actor.accessToken
    const userId = actor.user.id
    const customer = (await request('/account/add', {
      method: 'POST', token,
      body: { name: `${prefix}_${label}_CUSTOMER` },
    })).data
    assert(customer?.id, `${label} customer create failed`)

    const opportunity = (await request('/opportunity/add', {
      method: 'POST', token,
      body: {
        name: `${prefix}_${label}_OPPORTUNITY`,
        customerId: customer.id,
        owner: userId,
        amount: 100,
        products: [product.id],
      },
    })).data
    assert(opportunity?.id, `${label} opportunity create failed`)

    const quoteForm = (await request('/opportunity/quotation/module/form', { token })).data
    const quotation = (await request('/opportunity/quotation/add', {
      method: 'POST', token,
      body: {
        name: `${prefix}_${label}_QUOTATION`,
        opportunityId: opportunity.id,
        untilTime: Date.now() + 86_400_000,
        amount: 100,
        moduleFields: [],
        moduleFormConfigDTO: quoteForm,
        products: [{ product: product.id, productAmount: 100, discount: 100, tax: 0, amount: 100 }],
      },
    })).data
    assert(quotation?.id, `${label} quotation create failed`)

    const contractForm = (await request('/contract/module/form', { token })).data
    const contract = (await request('/contract/add', {
      method: 'POST', token,
      body: {
        name: `${prefix}_${label}_CONTRACT`,
        customerId: customer.id,
        owner: userId,
        amount: 100,
        moduleFields: [],
        moduleFormConfigDTO: contractForm,
      },
    })).data
    assert(contract?.id, `${label} contract create failed`)

    const plan = (await request('/contract/payment-plan/add', {
      method: 'POST', token,
      body: {
        name: `${prefix}_${label}_PLAN`,
        contractId: contract.id,
        owner: userId,
        planAmount: 100,
        planEndTime: Date.now() + 86_400_000,
      },
    })).data
    assert(plan?.id, `${label} plan create failed`)

    const record = (await request('/contract/payment-record/add', {
      method: 'POST', token,
      body: {
        name: `${prefix}_${label}_RECORD`,
        contractId: contract.id,
        paymentPlanId: plan.id,
        owner: userId,
        recordAmount: 10,
        recordEndTime: Date.now(),
        moduleFields: [
          { fieldId: 'contractPaymentRecordBank', fieldValue: '1' },
          { fieldId: 'contractPaymentRecordBankNo', fieldValue: '1' },
        ],
      },
    })).data
    assert(record?.id, `${label} record create failed`)

    const title = (await request('/contract/business-title/add', {
      method: 'POST', token,
      body: {
        name: `${prefix}_${label}_TITLE`,
        type: 'THIRD_PARTY',
        identificationNumber: `9131${randomUUID().replaceAll('-', '').slice(0, 14)}`,
        openingBank: '测试银行',
        bankAccount: `ACCT${Date.now()}${label}`,
        registrationAddress: '测试地址',
        phoneNumber: '021-12345678',
        registrationNumber: `REG-${randomUUID().slice(0, 8)}`,
        province: '上海市', city: '上海市', scale: '中型', industry: '软件', remark: 'W3.6.6 7.2',
      },
    })).data
    assert(title?.id, `${label} title create failed`)

    const invoice = (await request('/invoice/add', {
      method: 'POST', token,
      body: {
        name: `${prefix}_${label}_INVOICE`,
        contractId: contract.id,
        owner: userId,
        businessTitleId: title.id,
        amount: 10,
        invoiceType: '增值税普通发票',
        taxRate: 0,
        moduleFields: [],
      },
    })).data
    assert(invoice?.id, `${label} invoice create failed`)

    const orderForm = (await request('/order/module/form', { token })).data
    const order = (await request('/order/add', {
      method: 'POST', token,
      body: {
        name: `${prefix}_${label}_ORDER`,
        customerId: customer.id,
        contractId: contract.id,
        owner: userId,
        amount: 100,
        moduleFields: [],
        moduleFormConfigDTO: orderForm,
      },
    })).data
    assert(order?.id, `${label} order create failed`)

    return { customer, opportunity, quotation, contract, plan, record, invoice, order }
  }

  const linaChain = await createChain(lina, 'LINA')
  const adminChain = await createChain(admin, 'ADMIN')

  const resources = [
    { key: 'opportunity', page: '/opportunity/page', get: (id) => `/opportunity/get/${id}` },
    { key: 'quotation', page: '/opportunity/quotation/page', get: (id) => `/opportunity/quotation/get/${id}` },
    { key: 'contract', page: '/contract/page', get: (id) => `/contract/get/${id}` },
    { key: 'plan', page: '/contract/payment-plan/page', get: (id) => `/contract/payment-plan/get/${id}` },
    { key: 'record', page: '/contract/payment-record/page', get: (id) => `/contract/payment-record/get/${id}` },
    { key: 'invoice', page: '/invoice/page', get: (id) => `/invoice/get/${id}` },
    { key: 'order', page: '/order/page', get: (id) => `/order/get/${id}` },
  ]

  for (const resource of resources) {
    const adminPage = (await request(resource.page, {
      method: 'POST', token: admin.accessToken,
      body: { current: 1, pageSize: 100, keyword: prefix },
    })).data
    assertContains(adminPage, linaChain[resource.key].id, `ALL ${resource.key}`)
    assertContains(adminPage, adminChain[resource.key].id, `ALL ${resource.key}`)
    assert.equal((await request(resource.get(linaChain[resource.key].id), { token: admin.accessToken })).status, 200)
    assert.equal((await request(resource.get(adminChain[resource.key].id), { token: admin.accessToken })).status, 200)

    const managerPage = (await request(resource.page, {
      method: 'POST', token: manager.accessToken,
      body: { current: 1, pageSize: 100, keyword: prefix },
    })).data
    assertContains(managerPage, linaChain[resource.key].id, `DEPT_AND_CHILD ${resource.key}`)
    assertNotContains(managerPage, adminChain[resource.key].id, `DEPT_AND_CHILD ${resource.key}`)
    assert.equal((await request(resource.get(linaChain[resource.key].id), { token: manager.accessToken })).status, 200)
    await expectHiddenDetail(resource.get(adminChain[resource.key].id), manager.accessToken, `manager ${resource.key}`)

    const selfPage = (await request(resource.page, {
      method: 'POST', token: lina.accessToken,
      body: { current: 1, pageSize: 100, keyword: prefix },
    })).data
    assertContains(selfPage, linaChain[resource.key].id, `SELF ${resource.key}`)
    assertNotContains(selfPage, adminChain[resource.key].id, `SELF ${resource.key}`)
    assert.equal((await request(resource.get(linaChain[resource.key].id), { token: lina.accessToken })).status, 200)
    await expectHiddenDetail(resource.get(adminChain[resource.key].id), lina.accessToken, `self ${resource.key}`)
  }

  // Relation consumers may not bypass the parent/customer scope.
  const customerRelations = [
    ['/account/opportunity/page', [adminChain.opportunity.id]],
    ['/account/contract/page', [adminChain.contract.id]],
    ['/account/contract/payment-plan/page', [adminChain.plan.id]],
    ['/account/contract/payment-record/page', [adminChain.record.id]],
    ['/account/invoice/page', [adminChain.invoice.id]],
    ['/account/order/page', [adminChain.order.id]],
  ]
  for (const [path, ids] of customerRelations) {
    await expectRelationNoLeak(path, manager.accessToken, { accountId: adminChain.customer.id, current: 1, pageSize: 100 }, ids, `manager ${path}`)
    await expectRelationNoLeak(path, lina.accessToken, { accountId: adminChain.customer.id, current: 1, pageSize: 100 }, ids, `self ${path}`)
  }

  const contractRelations = [
    ['/contract/payment-plan/page', [adminChain.plan.id]],
    ['/contract/payment-record/page', [adminChain.record.id]],
    ['/invoice/page', [adminChain.invoice.id]],
    ['/order/page', [adminChain.order.id]],
  ]
  for (const [path, ids] of contractRelations) {
    await expectRelationNoLeak(path, manager.accessToken, { contractId: adminChain.contract.id, current: 1, pageSize: 100 }, ids, `manager ${path}`)
    await expectRelationNoLeak(path, lina.accessToken, { contractId: adminChain.contract.id, current: 1, pageSize: 100 }, ids, `self ${path}`)
  }

  const secondEmail = `w366-second-${randomUUID().slice(0, 8)}@demo.local`
  const second = (await request('/auth/register', {
    method: 'POST',
    body: { tenantName: `${prefix}_SECOND_TENANT`, name: 'Second Tenant Admin', email: secondEmail, password: 'second123' },
  })).data
  assert(second?.accessToken && second.user?.tenantId !== tenantId, 'second tenant register failed')

  for (const resource of resources) {
    await expectHiddenDetail(resource.get(linaChain[resource.key].id), second.accessToken, `second tenant ${resource.key}`)
    const secondPage = (await request(resource.page, {
      method: 'POST', token: second.accessToken,
      body: { current: 1, pageSize: 100, keyword: prefix },
    })).data
    assertNotContains(secondPage, linaChain[resource.key].id, `second tenant ${resource.key}`)
    assertNotContains(secondPage, adminChain[resource.key].id, `second tenant ${resource.key}`)
  }

  const now = BigInt(Date.now())
  const secondOrder = await prisma.order.create({
    data: {
      number: `W366-SECOND-${Date.now()}`,
      name: `${prefix}_SECOND_ORDER`,
      owner: second.user.id,
      amount: 1,
      stage: 'second-tenant-stage',
      approvalStatus: 'NONE',
      organizationId: second.user.tenantId,
      pos: 1,
      approved: false,
      createTime: now,
      updateTime: now,
      createUser: second.user.id,
      updateUser: second.user.id,
    },
  })
  const secondOwnOrder = (await request(`/order/get/${secondOrder.id}`, { token: second.accessToken })).data
  assert.equal(secondOwnOrder.id, secondOrder.id, 'second tenant cannot read own direct order')
  await expectHiddenDetail(`/order/get/${secondOrder.id}`, admin.accessToken, 'first tenant -> second order')
  const firstTenantSecondOrderSearch = (await request('/order/page', {
    method: 'POST', token: admin.accessToken,
    body: { current: 1, pageSize: 100, keyword: `${prefix}_SECOND_ORDER` },
  })).data
  assertNotContains(firstTenantSecondOrderSearch, secondOrder.id, 'first tenant order page')

  console.log(JSON.stringify({
    database,
    migrationsAndSeed: true,
    allScopeSevenResources: true,
    deptAndChildSevenResources: true,
    selfScopeSevenResources: true,
    listAndKnownIdFailClosed: true,
    customer360NoBypass: true,
    contractRelationNoBypass: true,
    secondTenantKnownIdIsolation: true,
    secondTenantReverseOrderIsolation: true,
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
