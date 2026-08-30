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
  if (!line) throw new Error('W3.6.6 transaction-chain smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w366_chain_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source)
target.pathname = `/${database}`
const managementUrl = new URL(source)
managementUrl.pathname = '/postgres'
const port = 32000 + Math.floor(Math.random() * 1000)
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
      // Isolated API may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 125))
  }
  throw new Error(`isolated API health timeout\n${childOutput}`)
}

async function login(email, password = 'admin123') {
  const result = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  assert(result.data?.accessToken, `login token missing for ${email}`)
  return result.data
}

function firstProduct(row, label) {
  assert(Array.isArray(row?.products) && row.products.length > 0, `${label} products missing`)
  return row.products[0]
}

function assertListContains(page, id, label) {
  assert(Array.isArray(page?.list), `${label} list missing`)
  assert(page.list.some((item) => item.id === id), `${label} does not contain ${id}`)
}

let management
let prisma
let api
try {
  console.log(`W3.6.6 transaction-chain smoke: ${database}`)
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

  const admin = await login('admin@demo.com')
  const token = admin.accessToken
  const userId = admin.user.id
  const tenantId = admin.user.tenantId
  const prefix = `W366_CHAIN_${Date.now()}`

  // 7.1 tests cross-module linkage, not the already-covered approval matrix.
  // In this isolated database only, keep quotation CREATE approval deterministic
  // because Contract.fromQuotationId intentionally requires APPROVED + !invalid.
  await prisma.approvalFlow.updateMany({
    where: { tenantId, formType: { in: ['QUOTATION', 'CONTRACT', 'INVOICE', 'ORDER'] } },
    data: { enabled: false },
  })
  await request('/approvals/flows', {
    method: 'POST',
    token,
    body: {
      formType: 'quotation',
      name: `${prefix}_QUOTE_FLOW`,
      description: 'W3.6.6 transaction chain quotation prerequisite',
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
      createNodes: [{
        name: '链路报价审批',
        approverType: 'USER',
        approverIds: [userId],
        ccUserIds: [],
        mode: 'ANY',
      }],
    },
  })

  const customer = (await request('/account/add', {
    method: 'POST', token,
    body: { name: `${prefix}_CUSTOMER` },
  })).data
  assert(customer?.id, 'customer create failed')

  const product = (await request('/product/add', {
    method: 'POST', token,
    body: { name: `${prefix}_PRODUCT`, price: 30000, status: '1' },
  })).data
  assert(product?.id, 'product create failed')

  const opportunity = (await request('/opportunity/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_OPPORTUNITY`,
      customerId: customer.id,
      owner: userId,
      amount: 30000,
      products: [product.id],
    },
  })).data
  assert(opportunity?.id, 'opportunity create failed')
  assert.equal(opportunity.customerId, customer.id, 'opportunity customer linkage broken')
  assert(opportunity.products?.includes(product.id), 'opportunity product linkage broken')

  const quotationForm = (await request('/opportunity/quotation/module/form', { token })).data
  const quotation = (await request('/opportunity/quotation/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_QUOTATION`,
      opportunityId: opportunity.id,
      untilTime: Date.now() + 30 * 24 * 60 * 60 * 1000,
      amount: 30000,
      moduleFields: [],
      moduleFormConfigDTO: quotationForm,
      products: [{
        product: product.id,
        productAmount: 30000,
        discount: 100,
        tax: 0,
        amount: 30000,
      }],
    },
  })).data
  assert.equal(quotation.opportunityId, opportunity.id, 'quotation opportunity linkage broken')
  assert.equal(firstProduct(quotation, 'quotation').productId, product.id, 'quotation product linkage broken')
  assert.equal(quotation.approvalStatus, 'APPROVING', 'quotation should enter deterministic CREATE approval')

  await request('/opportunity/quotation/approve', {
    method: 'POST', token,
    body: { id: quotation.id, approvalStatus: 'APPROVED' },
  })
  const approvedQuotation = (await request(`/opportunity/quotation/get/${quotation.id}`, { token })).data
  assert.equal(approvedQuotation.approvalStatus, 'APPROVED')
  assert.equal(approvedQuotation.approved, true)
  assert.equal(approvedQuotation.invalid, false)

  const contractForm = (await request('/contract/module/form', { token })).data
  const contract = (await request('/contract/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_CONTRACT`,
      customerId: customer.id,
      owner: userId,
      fromQuotationId: quotation.id,
      moduleFields: [],
      moduleFormConfigDTO: contractForm,
    },
  })).data
  assert(contract?.id, 'contract create failed')
  assert.equal(contract.customerId, customer.id, 'contract customer linkage broken')
  assert.equal(Number(contract.amount), 30000, 'contract amount was not derived from quotation products')
  const contractProduct = firstProduct(contract, 'contract')
  assert.equal(contractProduct.productId, product.id, 'contract did not consume quotation product')
  assert.equal(Number(contractProduct.productAmount), 30000, 'contract quotation product amount mismatch')

  const plan = (await request('/contract/payment-plan/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_PAYMENT_PLAN`,
      contractId: contract.id,
      owner: userId,
      planAmount: 30000,
      planEndTime: Date.now() + 60 * 24 * 60 * 60 * 1000,
    },
  })).data
  assert.equal(plan.contractId, contract.id, 'payment plan contract linkage broken')

  const paymentRecord = (await request('/contract/payment-record/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_PAYMENT_RECORD`,
      contractId: contract.id,
      paymentPlanId: plan.id,
      owner: userId,
      recordAmount: 30000,
      recordEndTime: Date.now(),
      moduleFields: [
        { fieldId: 'contractPaymentRecordBank', fieldValue: '1' },
        { fieldId: 'contractPaymentRecordBankNo', fieldValue: '1' },
      ],
    },
  })).data
  assert.equal(paymentRecord.contractId, contract.id, 'payment record contract linkage broken')
  assert.equal(paymentRecord.paymentPlanId, plan.id, 'payment record plan linkage broken')

  const paidContract = (await request(`/contract/get/${contract.id}`, { token })).data
  assert.equal(Number(paidContract.paidAmount), 30000, 'contract paidAmount aggregate broken')

  const businessTitle = (await request('/contract/business-title/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_TITLE`,
      type: 'THIRD_PARTY',
      identificationNumber: `91310000${String(Date.now()).slice(-10)}`,
      openingBank: '中国银行上海分行',
      bankAccount: '6222000000000000000',
      registrationAddress: '上海市浦东新区测试路1号',
      phoneNumber: '021-12345678',
      registeredCapital: '1000万人民币',
      companySize: '100-499人',
      registrationNumber: `REG-${Date.now()}`,
      province: '上海市',
      city: '上海市',
      scale: '中型',
      industry: '软件与信息服务',
      remark: 'W3.6.6 transaction chain smoke',
    },
  })).data
  assert(businessTitle?.id, 'business title create failed')

  const invoice = (await request('/invoice/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_INVOICE`,
      contractId: contract.id,
      owner: userId,
      businessTitleId: businessTitle.id,
      amount: 30000,
      invoiceType: '增值税普通发票',
      taxRate: 0,
      moduleFields: [],
    },
  })).data
  assert.equal(invoice.contractId, contract.id, 'invoice contract linkage broken')
  assert.equal(invoice.businessTitleId, businessTitle.id, 'invoice title linkage broken')

  const orderForm = (await request('/order/module/form', { token })).data
  const order = (await request('/order/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_ORDER`,
      customerId: customer.id,
      contractId: contract.id,
      owner: userId,
      amount: 30000,
      moduleFields: [],
      moduleFormConfigDTO: orderForm,
      products: [{
        product: contractProduct.productId,
        productPrice: Number(contractProduct.productAmount),
        productNumber: Number(contractProduct.productNumber ?? 1),
        amount: Number(contractProduct.amount ?? contractProduct.productAmount),
      }],
    },
  })).data
  assert(order?.id && order.number, 'direct order create failed')
  assert.equal(order.customerId, customer.id, 'order customer linkage broken')
  assert.equal(order.contractId, contract.id, 'order contract linkage broken')
  assert.equal(firstProduct(order, 'order').productId, product.id, 'order product linkage broken')

  const [
    customerOpportunity,
    customerContract,
    customerPlan,
    customerRecord,
    customerInvoice,
    customerOrder,
  ] = await Promise.all([
    request('/account/opportunity/page', { method: 'POST', token, body: { accountId: customer.id, current: 1, pageSize: 100 } }),
    request('/account/contract/page', { method: 'POST', token, body: { accountId: customer.id, current: 1, pageSize: 100 } }),
    request('/account/contract/payment-plan/page', { method: 'POST', token, body: { accountId: customer.id, current: 1, pageSize: 100 } }),
    request('/account/contract/payment-record/page', { method: 'POST', token, body: { accountId: customer.id, current: 1, pageSize: 100 } }),
    request('/account/invoice/page', { method: 'POST', token, body: { accountId: customer.id, current: 1, pageSize: 100 } }),
    request('/account/order/page', { method: 'POST', token, body: { accountId: customer.id, current: 1, pageSize: 100 } }),
  ])
  assertListContains(customerOpportunity.data, opportunity.id, 'customer 360 opportunity')
  assertListContains(customerContract.data, contract.id, 'customer 360 contract')
  assertListContains(customerPlan.data, plan.id, 'customer 360 payment plan')
  assertListContains(customerRecord.data, paymentRecord.id, 'customer 360 payment record')
  assertListContains(customerInvoice.data, invoice.id, 'customer 360 invoice')
  assertListContains(customerOrder.data, order.id, 'customer 360 order')

  const [contractPlans, contractRecords, contractInvoices, contractOrders] = await Promise.all([
    request('/contract/payment-plan/page', { method: 'POST', token, body: { contractId: contract.id, current: 1, pageSize: 100 } }),
    request('/contract/payment-record/page', { method: 'POST', token, body: { contractId: contract.id, current: 1, pageSize: 100 } }),
    request('/invoice/page', { method: 'POST', token, body: { contractId: contract.id, current: 1, pageSize: 100 } }),
    request('/order/page', { method: 'POST', token, body: { contractId: contract.id, current: 1, pageSize: 100 } }),
  ])
  assertListContains(contractPlans.data, plan.id, 'contract payment plan')
  assertListContains(contractRecords.data, paymentRecord.id, 'contract payment record')
  assertListContains(contractInvoices.data, invoice.id, 'contract invoice')
  assertListContains(contractOrders.data, order.id, 'contract order')

  const invoiceStatistic = (await request(`/contract/invoice/statistic/${contract.id}`, { token })).data
  assert.equal(Number(invoiceStatistic.contractAmount), 30000)
  assert.equal(Number(invoiceStatistic.invoicedAmount), 30000)
  assert.equal(Number(invoiceStatistic.uninvoicedAmount), 0)

  console.log(JSON.stringify({
    database,
    migrationsAndSeed: true,
    opportunityToQuotation: true,
    quotationApproved: true,
    quotationToContractViaFromQuotationId: true,
    productContinuity: true,
    paymentPlanAndRecord: true,
    contractPaidAmount: true,
    invoiceAndBusinessTitle: true,
    directOrder: true,
    customer360SixResources: true,
    contractRelatedConsumers: true,
    invoiceStatistic: true,
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
