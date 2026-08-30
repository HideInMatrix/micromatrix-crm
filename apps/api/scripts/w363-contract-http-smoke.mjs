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
  if (!line) throw new Error('W3.6.3 contract HTTP smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w363_contract_api_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source)
target.pathname = `/${database}`
const managementUrl = new URL(source)
managementUrl.pathname = '/postgres'
const port = 31364
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
  for (let i = 0; i < 100; i += 1) {
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

function assertDirectContract(contract, label = 'contract') {
  assert(contract?.id, `${label} id missing`)
  assert.equal(typeof contract.number, 'string', `${label} number missing`)
  assert.equal(typeof contract.stage, 'string', `${label} stage missing`)
  assert.equal(typeof contract.stageName, 'string', `${label} stageName missing`)
  assert(Array.isArray(contract.products), `${label} products missing`)
  assert(Array.isArray(contract.moduleFields), `${label} moduleFields missing`)
  for (const legacy of ['code', 'status', 'items', 'customData', 'ownerId', 'signedAt', 'quoteId', 'opportunityId']) {
    assert.equal(Object.prototype.hasOwnProperty.call(contract, legacy), false, `${label} exposes ${legacy}`)
  }
}

async function login(email, password = 'admin123') {
  const result = await request('/auth/login', { method: 'POST', body: { email, password } })
  assert(result.data?.accessToken, `login token missing for ${email}`)
  return result.data
}

async function createScopedUser(prisma, { tenantId, passwordHash, deptId, suffix, dataScope }) {
  const role = await prisma.role.create({
    data: {
      tenantId,
      name: `W363_${dataScope}_${suffix}`,
      permissions: ['menu:contract', 'contract:create', 'contract:update', 'contract:delete', 'contract:submit'],
      dataScope,
      scopeDeptIds: [],
      isSystem: false,
    },
  })
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `w363_${dataScope.toLowerCase()}_${suffix}@demo.local`,
      passwordHash,
      name: `W363 ${dataScope}`,
      status: 'ACTIVE',
      deptId,
      passwordLoginEnabled: true,
    },
  })
  await prisma.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } })
  return { user, role }
}

async function addContract(token, form, body) {
  const result = await request('/contract/add', {
    method: 'POST', token,
    body: { moduleFields: [], moduleFormConfigDTO: form, products: [], ...body },
  })
  assertDirectContract(result.data, body.name)
  return result.data
}

let management
let prisma
let api
try {
  console.log(`W3.6.3 contract direct HTTP smoke: ${database}`)
  management = await prismaClient(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'prisma', 'migrate', 'deploy'])
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])

  prisma = await prismaClient(target.toString())
  api = spawn(process.execPath, ['dist/main.js'], { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitHealth(api)

  const admin = await login('admin@demo.com')
  const token = admin.accessToken
  const userId = admin.user.id
  const tenantId = admin.user.tenantId
  const adminRow = await prisma.user.findFirstOrThrow({ where: { id: userId, tenantId } })
  const customer = await prisma.customer.findFirst({
    where: { organizationId: tenantId, inSharedPool: false },
    select: { id: true, name: true },
  })
  assert(customer, 'seed customer missing')
  await prisma.approvalFlow.updateMany({
    where: { tenantId, formType: 'CONTRACT' },
    data: { enabled: false },
  })

  const prefix = `W363_API_${Date.now()}`
  const form = (await request('/contract/module/form', { token })).data
  assert.equal(form?.formKey, 'contract')
  assert(Array.isArray(form?.fields), 'contract form fields missing')
  const stageResult = (await request('/contract/stage/get', { token })).data
  const defaultStages = stageResult.stageConfigList
  assert.equal(defaultStages.length, 7)
  assert.equal(defaultStages[0].name, '待签署')
  assert.equal(defaultStages.at(-1).name, '作废')
  const firstStage = defaultStages[0]
  const secondStage = defaultStages[1]
  const archivedStage = defaultStages.find((item) => item.name === '合同完结')
  const voidStage = defaultStages.find((item) => item.name === '作废')
  assert(archivedStage, 'archived stage missing')
  assert(voidStage, 'void stage missing')

  const product = (await request('/product/add', {
    method: 'POST', token,
    body: { name: `${prefix}_PRODUCT`, price: 88.8, status: '1' },
  })).data
  assert(product?.id, 'product create failed')

  const originalName = `${prefix}_MAIN`
  let mainContract = await addContract(token, form, {
    name: originalName,
    customerId: customer.id,
    owner: userId,
    startTime: Date.now(),
    endTime: Date.now() + 30 * 86_400_000,
    products: [{ product: product.id, productAmount: 88.8, productNumber: 2, amount: 177.6 }],
  })
  assert.equal(mainContract.stage, firstStage.id)
  assert.equal(mainContract.amount, 177.6)
  assert.equal(mainContract.products.length, 1)
  assert.equal(mainContract.products[0].productId, product.id)
  assert.equal(mainContract.products[0].productNumber, 2)

  const page = (await request('/contract/page', {
    method: 'POST', token,
    body: { current: 1, pageSize: 20, keyword: prefix },
  })).data
  assert(Array.isArray(page.list))
  assert.equal(Object.prototype.hasOwnProperty.call(page, 'items'), false, 'page must use Cordys list')
  assert(page.list.some((item) => item.id === mainContract.id))
  assert.equal(page.stages.length, 7)
  assertDirectContract(page.list.find((item) => item.id === mainContract.id), 'page contract')

  const detail = (await request(`/contract/get/${mainContract.id}`, { token })).data
  assertDirectContract(detail, 'detail contract')
  const snapshot = (await request(`/contract/get/snapshot/${mainContract.id}`, { token })).data
  assert.equal(snapshot.id, mainContract.id)
  assert.equal(snapshot.name, originalName)
  assert(Array.isArray(snapshot.products), 'business snapshot products missing')
  const snapshotForm = (await request(`/contract/module/form/snapshot/${mainContract.id}`, { token })).data
  assert.equal(snapshotForm.formKey, 'contract')

  const editedName = `${prefix}_MAIN_EDITED`
  mainContract = (await request('/contract/update', {
    method: 'POST', token,
    body: {
      id: mainContract.id,
      name: editedName,
      amount: 266.4,
      moduleFields: [],
      moduleFormConfigDTO: form,
      products: [{ product: product.id, productAmount: 88.8, productNumber: 3, amount: 266.4 }],
    },
  })).data
  assert.equal(mainContract.name, editedName)
  assert.equal(mainContract.amount, 266.4)
  assert.equal(mainContract.products[0].productNumber, 3)
  assert.equal((await request(`/contract/get/snapshot/${mainContract.id}`, { token })).data.name, editedName)

  const primaryView = (await request('/contract/view/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_VIEW_PRIMARY`,
      searchMode: 'AND',
      conditions: [{ name: 'name', operator: 'contains', value: `${prefix}_MAIN`, type: 'text' }],
    },
  })).data
  const secondaryView = (await request('/contract/view/add', {
    method: 'POST', token,
    body: {
      name: `${prefix}_VIEW_SECONDARY`,
      searchMode: 'AND',
      conditions: [{ name: 'amount', operator: 'gte', value: 0, type: 'number' }],
    },
  })).data
  assert(primaryView?.id && secondaryView?.id, 'contract views create failed')
  const viewList = (await request('/contract/view/list', { token })).data
  assert(viewList.some((item) => item.id === primaryView.id))
  assert.equal((await request(`/contract/view/detail/${primaryView.id}`, { token })).data.id, primaryView.id)
  await request(`/contract/view/fixed/${primaryView.id}`, { token })
  await request(`/contract/view/enable/${secondaryView.id}`, { token })
  await request(`/contract/view/enable/${secondaryView.id}`, { token })
  await request('/contract/view/edit/pos', {
    method: 'POST', token,
    body: { orgId: tenantId, moveId: secondaryView.id, targetId: primaryView.id, moveMode: 'BEFORE' },
  })
  await request('/contract/view/update', {
    method: 'POST', token,
    body: {
      id: primaryView.id,
      name: `${prefix}_VIEW_RENAMED`,
      searchMode: 'AND',
      conditions: [{ name: 'name', operator: 'contains', value: `${prefix}_MAIN`, type: 'text' }],
    },
  })
  const filteredByView = (await request('/contract/page', {
    method: 'POST', token,
    body: {
      current: 1,
      pageSize: 20,
      viewId: primaryView.id,
      filters: [{ key: 'amount', op: 'gte', value: 200 }],
    },
  })).data
  assert(filteredByView.list.some((item) => item.id === mainContract.id))
  assert(filteredByView.list.every((item) => item.name.includes(`${prefix}_MAIN`) && item.amount >= 200))
  await request(`/contract/view/delete/${secondaryView.id}`, { token })

  const batchA = await addContract(token, form, {
    name: `${prefix}_BATCH_A`, customerId: customer.id, owner: userId, amount: 10,
  })
  const batchB = await addContract(token, form, {
    name: `${prefix}_BATCH_B`, customerId: customer.id, owner: userId, amount: 20,
  })
  const batchName = `${prefix}_BATCH_UPDATED`
  const batchUpdate = (await request('/contract/batch/update', {
    method: 'POST', token,
    body: { ids: [batchA.id, batchB.id], fieldId: 'name', fieldValue: batchName },
  })).data
  assert.deepEqual(batchUpdate, { success: 2, fail: 0, skip: 0 })
  const statistic = (await request('/contract/statistic', {
    method: 'POST', token,
    body: { filters: [{ key: 'name', op: 'eq', value: batchName }] },
  })).data
  assert.equal(statistic.count, 2)
  assert.equal(statistic.amount, 30)
  await request('/contract/sort', {
    method: 'POST', token,
    body: { id: batchB.id, stage: batchB.stage, pos: 1 },
  })
  const sorted = (await request('/contract/page', {
    method: 'POST', token,
    body: {
      current: 1,
      pageSize: 20,
      stage: batchB.stage,
      filters: [{ key: 'name', op: 'eq', value: batchName }],
    },
  })).data
  assert.equal(sorted.list[0].id, batchB.id, 'contract sort must update same-stage pos')

  const normalContract = await addContract(token, form, {
    name: `${prefix}_NORMAL_STAGE`, customerId: customer.id, owner: userId, amount: 1,
  })
  let stageChanged = (await request('/contract/update/stage', {
    method: 'POST', token,
    body: { id: normalContract.id, stage: secondStage.id },
  })).data
  assert.equal(stageChanged.stage, secondStage.id)
  stageChanged = (await request('/contract/update/stage', {
    method: 'POST', token,
    body: { id: normalContract.id, stage: firstStage.id },
  })).data
  assert.equal(stageChanged.stage, firstStage.id, 'AFOOT rollback should be enabled by default')
  const missingVoidReason = await request('/contract/update/stage', {
    method: 'POST', token,
    body: { id: normalContract.id, stage: voidStage.id },
    allow: [400],
  })
  assert.equal(missingVoidReason.status, 400)
  assert.match(missingVoidReason.text, /作废原因不能为空/)
  stageChanged = (await request('/contract/update/stage', {
    method: 'POST', token,
    body: { id: normalContract.id, stage: voidStage.id, voidReason: `${prefix}_VOID_REASON` },
  })).data
  assert.equal(stageChanged.stage, voidStage.id)
  assert.equal(stageChanged.voidReason, `${prefix}_VOID_REASON`)
  const voidNotifications = (await request('/notifications?page=1&pageSize=100', { token })).data
  assert(
    voidNotifications.items?.some(
      (item) => item.title === '合同已作废' && item.content === normalContract.name,
    ),
    'CONTRACT_VOID notification missing',
  )

  const archivedContract = await addContract(token, form, {
    name: `${prefix}_ARCHIVED_STAGE`, customerId: customer.id, owner: userId, amount: 1,
  })
  stageChanged = (await request('/contract/update/stage', {
    method: 'POST', token,
    body: { id: archivedContract.id, stage: archivedStage.id },
  })).data
  assert.equal(stageChanged.stage, archivedStage.id)
  const archivedNotifications = (await request('/notifications?page=1&pageSize=100', { token })).data
  assert(
    archivedNotifications.items?.some(
      (item) => item.title === '合同已归档' && item.content === archivedContract.name,
    ),
    'CONTRACT_ARCHIVED notification missing',
  )

  const advancedContract = await addContract(token, form, {
    name: `${prefix}_ADVANCED_STAGE`, customerId: customer.id, owner: userId, amount: 1,
  })
  await request('/contract/stage/advanced/config', {
    method: 'POST', token,
    body: {
      circulationType: 'ADVANCED',
      circulationSettings: [{
        originId: firstStage.id,
        targets: [{ targetId: secondStage.id, enable: false, circulationFieldValues: [] }],
      }],
    },
  })
  const advancedBlocked = await request('/contract/update/stage', {
    method: 'POST', token,
    body: { id: advancedContract.id, stage: secondStage.id },
    allow: [400],
  })
  assert.equal(advancedBlocked.status, 400)
  assert.match(advancedBlocked.text, /不允许流转/)
  await request('/contract/stage/advanced/config', {
    method: 'POST', token,
    body: {
      circulationType: 'ADVANCED',
      circulationSettings: [{
        originId: firstStage.id,
        targets: [{ targetId: secondStage.id, enable: true, circulationFieldValues: [] }],
      }],
    },
  })
  stageChanged = (await request('/contract/update/stage', {
    method: 'POST', token,
    body: { id: advancedContract.id, stage: secondStage.id },
  })).data
  assert.equal(stageChanged.stage, secondStage.id)
  assert.equal((await request('/contract/stage/get', { token })).data.circulationType, 'ADVANCED')
  await request('/contract/stage/circulation-type/NORMAL', { token })

  const deptA = await prisma.department.create({ data: { tenantId, name: `${prefix}_DEPT_A` } })
  const deptB = await prisma.department.create({ data: { tenantId, name: `${prefix}_DEPT_B` } })
  const scopeSuffix = randomUUID().replaceAll('-', '').slice(0, 8)
  const allScoped = await createScopedUser(prisma, {
    tenantId,
    passwordHash: adminRow.passwordHash,
    deptId: deptA.id,
    suffix: scopeSuffix,
    dataScope: 'ALL',
  })
  const deptScoped = await createScopedUser(prisma, {
    tenantId,
    passwordHash: adminRow.passwordHash,
    deptId: deptA.id,
    suffix: scopeSuffix,
    dataScope: 'DEPT',
  })
  const selfScoped = await createScopedUser(prisma, {
    tenantId,
    passwordHash: adminRow.passwordHash,
    deptId: deptB.id,
    suffix: scopeSuffix,
    dataScope: 'SELF',
  })
  const dsPrefix = `${prefix}_DS`
  const dsAllMain = await addContract(token, form, {
    name: `${dsPrefix}_ALL_MAIN`, customerId: customer.id, owner: allScoped.user.id, amount: 1,
  })
  const dsAllDelete = await addContract(token, form, {
    name: `${dsPrefix}_ALL_DELETE`, customerId: customer.id, owner: allScoped.user.id, amount: 1,
  })
  const _dsDeptMain = await addContract(token, form, {
    name: `${dsPrefix}_DEPT_MAIN`, customerId: customer.id, owner: deptScoped.user.id, amount: 1,
  })
  const dsDeptDelete = await addContract(token, form, {
    name: `${dsPrefix}_DEPT_DELETE`, customerId: customer.id, owner: deptScoped.user.id, amount: 1,
  })
  const dsSelfMain = await addContract(token, form, {
    name: `${dsPrefix}_SELF_MAIN`, customerId: customer.id, owner: selfScoped.user.id, amount: 1,
  })
  const dsSelfDelete = await addContract(token, form, {
    name: `${dsPrefix}_SELF_DELETE`, customerId: customer.id, owner: selfScoped.user.id, amount: 1,
  })
  const allLogin = await login(allScoped.user.email)
  const deptLogin = await login(deptScoped.user.email)
  const selfLogin = await login(selfScoped.user.email)

  const allPage = (await request('/contract/page', {
    method: 'POST', token: allLogin.accessToken,
    body: { current: 1, pageSize: 50, keyword: dsPrefix },
  })).data
  assert.equal(allPage.total, 6, 'ALL scope must see all six scoped contracts')
  assert.equal((await request(`/contract/get/${dsSelfMain.id}`, { token: allLogin.accessToken })).status, 200)
  await request('/contract/update', {
    method: 'POST', token: allLogin.accessToken,
    body: { id: dsSelfMain.id, name: `${dsPrefix}_SELF_MAIN_ALL_EDIT` },
  })
  assert.equal(
    (await request(`/contract/delete/${dsAllDelete.id}`, { token: allLogin.accessToken })).data.pendingApproval,
    false,
  )
  assert.deepEqual(
    (await request('/contract/tab', { token: allLogin.accessToken })).data,
    { all: true, dept: false },
  )

  const deptPage = (await request('/contract/page', {
    method: 'POST', token: deptLogin.accessToken,
    body: { current: 1, pageSize: 50, keyword: dsPrefix },
  })).data
  assert.equal(deptPage.total, 3, 'DEPT scope must see the three remaining same-department contracts')
  assert.equal((await request(`/contract/get/${dsAllMain.id}`, { token: deptLogin.accessToken })).status, 200)
  assert.equal(
    (await request(`/contract/get/${dsSelfMain.id}`, { token: deptLogin.accessToken, allow: [404] })).status,
    404,
  )
  await request('/contract/update', {
    method: 'POST', token: deptLogin.accessToken,
    body: { id: dsAllMain.id, name: `${dsPrefix}_ALL_MAIN_DEPT_EDIT` },
  })
  assert.equal(
    (await request('/contract/update', {
      method: 'POST', token: deptLogin.accessToken,
      body: { id: dsSelfMain.id, name: `${dsPrefix}_DENIED` },
      allow: [404],
    })).status,
    404,
  )
  assert.equal(
    (await request(`/contract/delete/${dsDeptDelete.id}`, { token: deptLogin.accessToken })).data.pendingApproval,
    false,
  )
  assert.equal(
    (await request(`/contract/delete/${dsSelfDelete.id}`, { token: deptLogin.accessToken, allow: [404] })).status,
    404,
  )
  assert.deepEqual(
    (await request('/contract/tab', { token: deptLogin.accessToken })).data,
    { all: false, dept: true },
  )

  const selfPage = (await request('/contract/page', {
    method: 'POST', token: selfLogin.accessToken,
    body: { current: 1, pageSize: 50, keyword: dsPrefix },
  })).data
  assert.equal(selfPage.total, 2, 'SELF scope must only see its two owned contracts')
  assert.equal((await request(`/contract/get/${dsSelfMain.id}`, { token: selfLogin.accessToken })).status, 200)
  assert.equal(
    (await request(`/contract/get/${dsAllMain.id}`, { token: selfLogin.accessToken, allow: [404] })).status,
    404,
  )
  await request('/contract/update', {
    method: 'POST', token: selfLogin.accessToken,
    body: { id: dsSelfMain.id, name: `${dsPrefix}_SELF_MAIN_EDIT` },
  })
  assert.equal(
    (await request('/contract/update', {
      method: 'POST', token: selfLogin.accessToken,
      body: { id: dsAllMain.id, name: `${dsPrefix}_DENIED_SELF` },
      allow: [404],
    })).status,
    404,
  )
  assert.equal(
    (await request(`/contract/delete/${dsSelfDelete.id}`, { token: selfLogin.accessToken })).data.pendingApproval,
    false,
  )
  assert.equal(
    (await request(`/contract/delete/${dsAllMain.id}`, { token: selfLogin.accessToken, allow: [404] })).status,
    404,
  )
  assert.deepEqual(
    (await request('/contract/tab', { token: selfLogin.accessToken })).data,
    { all: false, dept: false },
  )

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
  const flow = existingFlows.items.length
    ? (await request(`/approvals/flows/${existingFlows.items[0].id}`, {
        method: 'PUT', token, body: flowBody,
      })).data
    : (await request('/approvals/flows', {
        method: 'POST', token, body: { formType: 'contract', ...flowBody },
      })).data
  assert(flow?.id, 'contract approval flow missing')

  const approvalName = `${prefix}_APPROVAL`
  const approvalContract = await addContract(token, form, {
    name: approvalName, customerId: customer.id, owner: userId, amount: 50,
  })
  assert.equal(approvalContract.approvalStatus, 'APPROVING', 'CREATE should enter approval')
  await request('/contract/approval', {
    method: 'POST', token,
    body: { id: approvalContract.id, approvalStatus: 'APPROVED' },
  })
  let approvalCurrent = (await request(`/contract/get/${approvalContract.id}`, { token })).data
  assert.equal(approvalCurrent.approvalStatus, 'APPROVED')
  assert.equal(approvalCurrent.approved, true)

  await request('/contract/update', {
    method: 'POST', token,
    body: { id: approvalContract.id, name: `${prefix}_APPROVAL_REJECT` },
  })
  assert.equal((await request(`/contract/get/${approvalContract.id}`, { token })).data.approvalStatus, 'APPROVING')
  await request('/contract/approval', {
    method: 'POST', token,
    body: { id: approvalContract.id, approvalStatus: 'UNAPPROVED' },
  })
  approvalCurrent = (await request(`/contract/get/${approvalContract.id}`, { token })).data
  assert.equal(approvalCurrent.name, approvalName, 'UPDATE reject must restore business snapshot')
  assert.equal(approvalCurrent.approvalStatus, 'UNAPPROVED')
  assert.equal(approvalCurrent.approved, true)

  await request('/contract/update', {
    method: 'POST', token,
    body: { id: approvalContract.id, name: `${prefix}_APPROVAL_REVOKE` },
  })
  await request(`/contract/revoke/${approvalContract.id}`, { token })
  approvalCurrent = (await request(`/contract/get/${approvalContract.id}`, { token })).data
  assert.equal(approvalCurrent.name, approvalName, 'UPDATE revoke must restore business snapshot')
  assert.equal(approvalCurrent.approvalStatus, 'REVOKED')
  assert.equal(approvalCurrent.approved, true)

  for (const contract of [batchA, batchB]) {
    await request('/contract/update', {
      method: 'POST', token,
      body: { id: contract.id, name: `${prefix}_BATCH_APPROVAL_${contract.id.slice(-4)}` },
    })
  }
  const batchApproval = (await request('/contract/batch/approval', {
    method: 'POST', token,
    body: { ids: [batchA.id, batchB.id], approvalStatus: 'APPROVED' },
  })).data
  assert.deepEqual(batchApproval, { success: 2, fail: 0, skip: 0 })

  const deleteApprovalContract = await addContract(token, form, {
    name: `${prefix}_DELETE_APPROVAL`, customerId: customer.id, owner: userId, amount: 60,
  })
  await request('/contract/approval', {
    method: 'POST', token,
    body: { id: deleteApprovalContract.id, approvalStatus: 'APPROVED' },
  })
  const deletePending = (await request(`/contract/delete/${deleteApprovalContract.id}`, { token })).data
  assert.equal(deletePending.pendingApproval, true)
  assert.equal((await request(`/contract/get/${deleteApprovalContract.id}`, { token })).status, 200)
  await request('/contract/approval', {
    method: 'POST', token,
    body: { id: deleteApprovalContract.id, approvalStatus: 'APPROVED' },
  })
  assert.equal(
    (await request(`/contract/get/${deleteApprovalContract.id}`, { token, allow: [404] })).status,
    404,
  )

  assert.equal((await request('/contracts', { method: 'GET', token, allow: [404] })).status, 404)
  assert.equal((await request('/contracts', { method: 'POST', token, body: {}, allow: [404] })).status, 404)
  assert.equal(
    (await request(`/contracts/${mainContract.id}`, { method: 'GET', token, allow: [404] })).status,
    404,
  )
  assert.equal(
    (await request(`/contracts/${mainContract.id}`, {
      method: 'PATCH', token, body: {}, allow: [404],
    })).status,
    404,
  )
  assert.equal(
    (await request(`/contracts/${mainContract.id}`, { method: 'DELETE', token, allow: [404] })).status,
    404,
  )

  console.log(JSON.stringify({
    moduleForm: true,
    pageGetSnapshotUpdate: true,
    userViewCrudAndIntersection: true,
    normalStageAndVoidReason: true,
    contractStageNotifications: true,
    advancedStageGuard: true,
    batchUpdateAndSort: true,
    statistic: true,
    dataScope: { ALL: true, DEPT: true, SELF: true },
    createUpdateDeleteApproval: true,
    revokeRollback: true,
    batchApproval,
    oldMainContractsRest404: true,
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
