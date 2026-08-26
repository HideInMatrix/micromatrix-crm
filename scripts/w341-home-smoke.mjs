/**
 * W3.4.1 首页真实数据库/API Smoke。
 * 前置：API 已启动，当前 schema migration 已应用，API production build 已生成 Prisma Client。
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const bcrypt = requireFromApi('bcryptjs')
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')

const base = process.env.API_BASE ?? 'http://localhost:3000/api'
let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`)
  }
}

function resolveDatabaseUrl() {
  if (process.env.SMOKE_DATABASE_URL) return process.env.SMOKE_DATABASE_URL
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.4.1 Smoke 需要 DATABASE_URL 或 apps/api/.env 中的 DATABASE_URL')
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }),
})
const id = () => randomUUID().replaceAll('-', '')
const suffix = Date.now().toString(36)

async function jsonRequest(method, path, headers, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let data
  try {
    data = await response.json()
  } catch {
    data = null
  }
  return { response, data }
}

async function register(label) {
  const email = `w341-${label}-${suffix}@smoke.local`
  const password = 'Smoke123!'
  const { response, data } = await jsonRequest('POST', '/auth/register', undefined, {
    tenantName: `W341 ${label} ${suffix}`,
    name: `W341 ${label}`,
    email,
    password,
  })
  if (!response.ok || !data?.accessToken) {
    throw new Error(`注册 ${label} 失败: ${response.status} ${JSON.stringify(data)}`)
  }
  return {
    email,
    password,
    user: data.user,
    headers: { Authorization: `Bearer ${data.accessToken}` },
  }
}

async function login(email, password) {
  const { response, data } = await jsonRequest('POST', '/auth/login', undefined, {
    email,
    password,
  })
  if (!response.ok || !data?.accessToken) {
    throw new Error(`登录失败 ${email}: ${response.status} ${JSON.stringify(data)}`)
  }
  return { user: data.user, headers: { Authorization: `Bearer ${data.accessToken}` } }
}

async function apiGet(path, headers) {
  return jsonRequest('GET', path, headers)
}

async function apiPost(path, headers, body) {
  return jsonRequest('POST', path, headers, body)
}

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

const tenantIds = []
const directIds = {
  clues: [],
  customers: [],
  opportunities: [],
  stages: [],
  approvalInstances: [],
}

async function cleanupTenants(ids) {
  if (!ids.length) return
  const instances = await prisma.approvalInstance.findMany({
    where: { tenantId: { in: ids } },
    select: { id: true },
  })
  const instanceIds = instances.map((item) => item.id)
  if (instanceIds.length) {
    await prisma.approvalTask.deleteMany({ where: { instanceId: { in: instanceIds } } })
    await prisma.approvalInstance.deleteMany({ where: { id: { in: instanceIds } } })
  }
  await prisma.opportunity.deleteMany({ where: { tenantId: { in: ids } } })
  await prisma.opportunityStage.deleteMany({ where: { tenantId: { in: ids } } })
  await prisma.customer.deleteMany({ where: { organizationId: { in: ids } } })
  await prisma.clue.deleteMany({ where: { organizationId: { in: ids } } })
  await prisma.notification.deleteMany({ where: { tenantId: { in: ids } } })
  await prisma.loginLog.deleteMany({ where: { tenantId: { in: ids } } })
  await prisma.subscription.deleteMany({ where: { tenantId: { in: ids } } })
  await prisma.userRole.deleteMany({ where: { tenantId: { in: ids } } })
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } })
  await prisma.department.deleteMany({ where: { tenantId: { in: ids } } })
  await prisma.role.deleteMany({ where: { tenantId: { in: ids } } })
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } })
}

async function cleanup() {
  if (directIds.approvalInstances.length) {
    await prisma.approvalTask.deleteMany({
      where: { instanceId: { in: directIds.approvalInstances } },
    })
    await prisma.approvalInstance.deleteMany({ where: { id: { in: directIds.approvalInstances } } })
  }
  if (directIds.opportunities.length) {
    await prisma.opportunity.deleteMany({ where: { id: { in: directIds.opportunities } } })
  }
  if (directIds.stages.length) {
    await prisma.opportunityStage.deleteMany({ where: { id: { in: directIds.stages } } })
  }
  if (directIds.customers.length) {
    await prisma.customer.deleteMany({ where: { id: { in: directIds.customers } } })
  }
  if (directIds.clues.length) {
    await prisma.clue.deleteMany({ where: { id: { in: directIds.clues } } })
  }
  await cleanupTenants(tenantIds)
}

try {
  console.log('\nW3.4.1 首页 Smoke')
  const staleTenants = await prisma.tenant.findMany({
    where: { name: { startsWith: 'W341 ' } },
    select: { id: true },
  })
  if (staleTenants.length) {
    await cleanupTenants(staleTenants.map((tenant) => tenant.id))
    console.log(`  · 已清理 ${staleTenants.length} 个历史 W3.4.1 Smoke 临时租户`)
  }
  const primary = await register('primary')
  const isolated = await register('isolated')
  tenantIds.push(primary.user.tenantId, isolated.user.tenantId)

  const rootDept = await prisma.department.findFirstOrThrow({
    where: { tenantId: primary.user.tenantId, parentId: null },
  })
  const salesDept = await prisma.department.create({
    data: {
      tenantId: primary.user.tenantId,
      name: `销售一部 ${suffix}`,
      parentId: rootDept.id,
      sort: 1,
    },
  })
  const salesRole = await prisma.role.create({
    data: {
      tenantId: primary.user.tenantId,
      name: `首页销售 ${suffix}`,
      permissions: ['menu:dashboard', 'menu:lead', 'menu:opportunity'],
      dataScope: 'DEPT',
    },
  })
  const noReadRole = await prisma.role.create({
    data: {
      tenantId: primary.user.tenantId,
      name: `首页无读权 ${suffix}`,
      permissions: ['menu:dashboard'],
      dataScope: 'ALL',
    },
  })
  const salesPassword = 'Sales123!'
  const noReadPassword = 'NoRead123!'
  const salesUser = await prisma.user.create({
    data: {
      tenantId: primary.user.tenantId,
      email: `w341-sales-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(salesPassword, 10),
      name: '首页销售',
      deptId: salesDept.id,
      defaultPwd: true,
      userRoles: { create: { tenantId: primary.user.tenantId, roleId: salesRole.id } },
    },
  })
  const noReadUser = await prisma.user.create({
    data: {
      tenantId: primary.user.tenantId,
      email: `w341-noread-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(noReadPassword, 10),
      name: '首页无读权',
      deptId: salesDept.id,
      defaultPwd: true,
      userRoles: { create: { tenantId: primary.user.tenantId, roleId: noReadRole.id } },
    },
  })

  const salesSession = await login(salesUser.email, salesPassword)
  const noReadSession = await login(noReadUser.email, noReadPassword)
  check('登录返回真实 defaultPwd=true', salesSession.user.defaultPwd === true)
  const changedPassword = 'Sales456!'
  const changePasswordResponse = await apiPost('/auth/change-password', salesSession.headers, {
    oldPassword: salesPassword,
    newPassword: changedPassword,
  })
  check(
    '修改密码接口成功',
    changePasswordResponse.response.ok,
    JSON.stringify(changePasswordResponse.data),
  )
  const salesAfterPassword = await login(salesUser.email, changedPassword)
  check('修改密码后 defaultPwd=false', salesAfterPassword.user.defaultPwd === false)

  const now = Date.now()
  const yesterday = startOfToday().getTime() - 60 * 60 * 1000
  const clueFixtures = [
    {
      id: id(),
      name: '首页管理员今日线索',
      owner: primary.user.id,
      stage: 'FOLLOWING',
      organizationId: primary.user.tenantId,
      createTime: BigInt(now),
      updateTime: BigInt(now),
      createUser: primary.user.id,
      updateUser: primary.user.id,
    },
    {
      id: id(),
      name: '首页销售今日线索',
      owner: salesUser.id,
      stage: 'FOLLOWING',
      organizationId: primary.user.tenantId,
      createTime: BigInt(now),
      updateTime: BigInt(now),
      createUser: salesUser.id,
      updateUser: salesUser.id,
    },
    {
      id: id(),
      name: '首页昨日线索',
      owner: primary.user.id,
      stage: 'FOLLOWING',
      organizationId: primary.user.tenantId,
      createTime: BigInt(yesterday),
      updateTime: BigInt(yesterday),
      createUser: primary.user.id,
      updateUser: primary.user.id,
    },
    {
      id: id(),
      name: '已转换不统计',
      owner: primary.user.id,
      stage: 'CONVERTED',
      organizationId: primary.user.tenantId,
      createTime: BigInt(now),
      updateTime: BigInt(now),
      createUser: primary.user.id,
      updateUser: primary.user.id,
      transitionId: id(),
    },
  ]
  for (const fixture of clueFixtures) {
    await prisma.clue.create({ data: fixture })
    directIds.clues.push(fixture.id)
  }
  const isolatedClue = {
    id: id(),
    name: '隔离组织线索',
    owner: isolated.user.id,
    stage: 'FOLLOWING',
    organizationId: isolated.user.tenantId,
    createTime: BigInt(now),
    updateTime: BigInt(now),
    createUser: isolated.user.id,
    updateUser: isolated.user.id,
  }
  await prisma.clue.create({ data: isolatedClue })
  directIds.clues.push(isolatedClue.id)

  const adminAllPayload = {
    searchType: 'ALL',
    deptIds: [],
    userField: 'OWNER',
    timeField: 'CREATE_TIME',
    winOrderTimeField: 'ACTUAL_END_TIME',
    priorPeriodEnable: true,
  }
  const leadAll = await apiPost('/home/statistic/lead', primary.headers, adminAllPayload)
  check(
    'ALL 今日线索只统计当前组织未转换线索',
    leadAll.data?.todayClue?.value === 2,
    JSON.stringify(leadAll.data),
  )
  check(
    '今日线索较昨日环比为 100%',
    leadAll.data?.todayClue?.priorPeriodCompareRate === 100,
    JSON.stringify(leadAll.data?.todayClue),
  )

  const leadSelf = await apiPost('/home/statistic/lead', primary.headers, {
    ...adminAllPayload,
    searchType: 'SELF',
  })
  check(
    'SELF 今日线索只统计本人 Owner',
    leadSelf.data?.todayClue?.value === 1,
    JSON.stringify(leadSelf.data),
  )

  const leadDept = await apiPost('/home/statistic/lead', primary.headers, {
    ...adminAllPayload,
    searchType: 'DEPARTMENT',
    deptIds: [salesDept.id],
  })
  check(
    'DEPARTMENT 今日线索按所选部门负责人裁剪',
    leadDept.data?.todayClue?.value === 1,
    JSON.stringify(leadDept.data),
  )

  const salesTree = await apiGet('/home/statistic/department/tree', salesAfterPassword.headers)
  check(
    'DEPT 数据范围部门树只暴露当前有权部门',
    salesTree.response.ok && salesTree.data?.length === 1 && salesTree.data[0]?.id === salesDept.id,
    JSON.stringify(salesTree.data),
  )

  const deniedLead = await apiPost('/home/statistic/lead', noReadSession.headers, adminAllPayload)
  check(
    '无 menu:lead 权限的首页线索统计被后端 403 拒绝',
    deniedLead.response.status === 403,
    `${deniedLead.response.status}`,
  )

  const customer = {
    id: id(),
    name: '首页 Smoke 客户',
    owner: primary.user.id,
    organizationId: primary.user.tenantId,
    createTime: BigInt(now),
    updateTime: BigInt(now),
    createUser: primary.user.id,
    updateUser: primary.user.id,
  }
  await prisma.customer.create({ data: customer })
  directIds.customers.push(customer.id)

  const underwayStage = await prisma.opportunityStage.create({
    data: {
      id: id(),
      tenantId: primary.user.tenantId,
      name: `进行中 ${suffix}`,
      probability: 50,
      sort: 1,
    },
  })
  const wonStage = await prisma.opportunityStage.create({
    data: {
      id: id(),
      tenantId: primary.user.tenantId,
      name: `赢单 ${suffix}`,
      probability: 100,
      sort: 2,
      isWon: true,
    },
  })
  directIds.stages.push(underwayStage.id, wonStage.id)

  const opportunities = [
    {
      id: id(),
      tenantId: primary.user.tenantId,
      name: '首页进行中商机',
      customerId: customer.id,
      stageId: underwayStage.id,
      amount: 1200,
      ownerId: primary.user.id,
      deptId: rootDept.id,
      expectedCloseAt: new Date(now),
      createdAt: new Date(now),
    },
    {
      id: id(),
      tenantId: primary.user.tenantId,
      name: '首页赢单商机',
      customerId: customer.id,
      stageId: wonStage.id,
      amount: 3400,
      ownerId: primary.user.id,
      deptId: rootDept.id,
      expectedCloseAt: new Date(now),
      wonAt: new Date(now),
      createdAt: new Date(now),
    },
  ]
  for (const fixture of opportunities) {
    await prisma.opportunity.create({ data: fixture })
    directIds.opportunities.push(fixture.id)
  }

  const opportunityAll = await apiPost(
    '/home/statistic/opportunity',
    primary.headers,
    adminAllPayload,
  )
  const underwayAll = await apiPost(
    '/home/statistic/opportunity/underway',
    primary.headers,
    adminAllPayload,
  )
  const successAll = await apiPost(
    '/home/statistic/opportunity/success',
    primary.headers,
    adminAllPayload,
  )
  check(
    '今日商机数量聚合真实 Opportunity',
    opportunityAll.data?.todayOpportunity?.value === 2,
    JSON.stringify(opportunityAll.data),
  )
  check(
    '今日商机金额聚合真实 Opportunity',
    opportunityAll.data?.todayOpportunityAmount?.value === 4600,
    JSON.stringify(opportunityAll.data),
  )
  check(
    '进行中商机只统计非赢非输阶段',
    underwayAll.data?.todayOpportunity?.value === 1,
    JSON.stringify(underwayAll.data),
  )
  check(
    '赢单只统计 isWon 阶段',
    successAll.data?.todayOpportunity?.value === 1,
    JSON.stringify(successAll.data),
  )
  check(
    '赢单金额使用真实聚合',
    successAll.data?.todayOpportunityAmount?.value === 3400,
    JSON.stringify(successAll.data),
  )

  const leadHomeFilter = {
    module: 'lead',
    period: 'TODAY',
    searchType: 'ALL',
    deptIds: [],
    userField: 'OWNER',
  }
  const leadList = await apiGet(
    `/leads?page=1&pageSize=100&scope=mine&homeFilter=${encodeURIComponent(JSON.stringify(leadHomeFilter))}`,
    primary.headers,
  )
  check(
    '首页线索点击后的真实列表 total 与统计口径一致',
    leadList.response.ok && leadList.data?.total === leadAll.data?.todayClue?.value,
    `list=${leadList.data?.total} statistic=${leadAll.data?.todayClue?.value}`,
  )

  const successFilter = {
    module: 'opportunity',
    period: 'TODAY',
    searchType: 'ALL',
    deptIds: [],
    timeField: 'ACTUAL_END_TIME',
    status: 'SUCCESS',
  }
  const opportunityList = await apiGet(
    `/opportunities?page=1&pageSize=100&homeFilter=${encodeURIComponent(JSON.stringify(successFilter))}`,
    primary.headers,
  )
  check(
    '首页赢单点击后的真实商机列表 total 与统计口径一致',
    opportunityList.response.ok &&
      opportunityList.data?.total === successAll.data?.todayOpportunity?.value,
    `list=${opportunityList.data?.total} statistic=${successAll.data?.todayOpportunity?.value}`,
  )

  const approvalInstance = await prisma.approvalInstance.create({
    data: {
      id: id(),
      tenantId: primary.user.tenantId,
      executeTiming: 'CREATE',
      module: 'contract',
      targetId: id(),
      targetName: '首页抄送 Smoke',
      nodesSnapshot: [],
      submitterId: primary.user.id,
      submitterName: primary.user.name,
    },
  })
  directIds.approvalInstances.push(approvalInstance.id)
  await prisma.approvalTask.create({
    data: {
      tenantId: primary.user.tenantId,
      instanceId: approvalInstance.id,
      nodeIndex: 0,
      nodeName: '抄送节点',
      approverId: salesUser.id,
      taskType: 'CC',
    },
  })
  const copied = await apiGet('/approvals/my-copied?page=1&pageSize=10', salesAfterPassword.headers)
  check(
    '抄送我的与审批任务使用同一真实数据源',
    copied.response.ok &&
      copied.data?.total === 1 &&
      copied.data?.items?.[0]?.id === approvalInstance.id,
    JSON.stringify(copied.data),
  )
} finally {
  await cleanup().catch((error) => console.error('  ! Smoke 清理失败', error))
  await prisma.$disconnect()
}

console.log(`\nW3.4.1 首页 Smoke：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
