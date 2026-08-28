import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')

const base = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` ${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function resolveDatabaseUrl() {
  if (process.env.SMOKE_DATABASE_URL) return process.env.SMOKE_DATABASE_URL
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('Dashboard Smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }),
})

async function login(email, password) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await response.json()
  if (!response.ok || !body.accessToken) throw new Error(`登录失败: ${email}`)
  return {
    user: body.user,
    headers: {
      Authorization: `Bearer ${body.accessToken}`,
      'Content-Type': 'application/json',
    },
  }
}

async function register(tenantName, name, email, password) {
  const response = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantName, name, email, password }),
  })
  const body = await response.json()
  if (!response.ok || !body.accessToken) throw new Error(`注册临时租户失败: ${JSON.stringify(body)}`)
  return {
    user: body.user,
    headers: {
      Authorization: `Bearer ${body.accessToken}`,
      'Content-Type': 'application/json',
    },
  }
}

async function request(method, path, headers, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  const data = (() => {
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  })()
  return { status: response.status, ok: response.ok, data }
}

async function must(method, path, headers, body) {
  const result = await request(method, path, headers, body)
  if (!result.ok) {
    throw new Error(`${method} ${path} -> ${result.status}: ${JSON.stringify(result.data)}`)
  }
  return result.data
}

function flattenTree(nodes, result = []) {
  for (const node of nodes ?? []) {
    result.push(node)
    flattenTree(node.children, result)
  }
  return result
}

console.log('\nW3.4.4 task 5.3 Dashboard API Smoke')

const admin = await login('admin@demo.com', 'admin123')
const manager = await login('zhangwei@demo.com', 'admin123')
const sales = await login('lina@demo.com', 'demo123')

const stamp = Date.now()
const names = {
  root: `W344目录A-${stamp}`,
  child: `W344目录B-${stamp}`,
  sibling: `W344目录C-${stamp}`,
  public: `W344公开看板-${stamp}`,
  sales: `W344个人看板-${stamp}`,
  dept: `W344部门看板-${stamp}`,
  manager: `W344主管看板-${stamp}`,
  orderA: `W344排序A-${stamp}`,
  orderB: `W344排序B-${stamp}`,
}

const createdModules = []
const createdDashboards = []
let outsiderTenantId = ''

try {
  const salesTree = await request('GET', '/dashboard/module/tree', sales.headers)
  check('销售专员拥有 dashboard:read', salesTree.status === 200)

  const deniedSalesCreate = await request('POST', '/dashboard/module/add', sales.headers, {
    name: `禁止创建-${stamp}`,
    parentId: 'NONE',
  })
  check('销售专员无 dashboard:create 时禁止新增目录', deniedSalesCreate.status === 403)

  const root = await must('POST', '/dashboard/module/add', manager.headers, {
    name: names.root,
    parentId: 'NONE',
  })
  createdModules.push(root.id)
  const child = await must('POST', '/dashboard/module/add', manager.headers, {
    name: names.child,
    parentId: root.id,
  })
  createdModules.push(child.id)
  const sibling = await must('POST', '/dashboard/module/add', manager.headers, {
    name: names.sibling,
    parentId: 'NONE',
  })
  createdModules.push(sibling.id)
  check('主管可创建多级 DashboardModule', root.parentId === 'NONE' && child.parentId === root.id)

  const renamedSibling = await must('POST', '/dashboard/module/rename', manager.headers, {
    id: sibling.id,
    name: `${names.sibling}-已改名`,
  })
  check('DashboardModule 支持成功改名', renamedSibling.name === `${names.sibling}-已改名`)

  const deleteMe = await must('POST', '/dashboard/module/add', manager.headers, {
    name: `W344待删除目录-${stamp}`,
    parentId: 'NONE',
  })
  const deleteEmptyModule = await request('POST', '/dashboard/module/delete', manager.headers, [deleteMe.id])
  check('空 DashboardModule 可删除', deleteEmptyModule.status === 201 && deleteEmptyModule.data?.deleted === 1)

  const emptyParent = await must('POST', '/dashboard/module/add', manager.headers, {
    name: `W344空父目录-${stamp}`,
    parentId: 'NONE',
  })
  createdModules.push(emptyParent.id)
  const emptyChild = await must('POST', '/dashboard/module/add', manager.headers, {
    name: `W344空子目录-${stamp}`,
    parentId: emptyParent.id,
  })
  createdModules.push(emptyChild.id)
  const deleteParentOnly = await request('POST', '/dashboard/module/delete', manager.headers, [emptyParent.id])
  check('DashboardModule 有未选中子目录时拒绝删除以防孤儿', deleteParentOnly.status === 400)

  const duplicateModule = await request('POST', '/dashboard/module/add', manager.headers, {
    name: names.root,
    parentId: 'NONE',
  })
  check('同级 DashboardModule 名称唯一', duplicateModule.status === 409)

  const invalidParent = await request('POST', '/dashboard/module/add', manager.headers, {
    name: `无效父目录-${stamp}`,
    parentId: `missing-${stamp}`,
  })
  check('新增目录拒绝不存在父节点', invalidParent.status === 404)

  const insecureDashboard = await request('POST', '/dashboard/add', manager.headers, {
    name: `W344非安全URL-${stamp}`,
    resourceUrl: `http://example.com/${stamp}/insecure`,
    dashboardModuleId: root.id,
    scopeIds: [],
  })
  check('Dashboard URL 拒绝非 localhost HTTP', insecureDashboard.status === 400)

  const credentialDashboard = await request('POST', '/dashboard/add', manager.headers, {
    name: `W344URL凭据-${stamp}`,
    resourceUrl: `https://user:password@example.com/${stamp}/credential`,
    dashboardModuleId: root.id,
    scopeIds: [],
  })
  check('Dashboard URL 拒绝内嵌账号密码', credentialDashboard.status === 400)

  const localDashboard = await must('POST', '/dashboard/add', manager.headers, {
    name: `W344本地开发URL-${stamp}`,
    resourceUrl: `http://127.0.0.1:5174/${stamp}/local`,
    dashboardModuleId: root.id,
    scopeIds: [],
  })
  createdDashboards.push(localDashboard.id)
  check('开发环境允许 localhost HTTP', localDashboard.resourceUrl.startsWith('http://127.0.0.1:5174/'))

  const publicDashboard = await must('POST', '/dashboard/add', manager.headers, {
    name: names.public,
    resourceUrl: `https://example.com/${stamp}/public`,
    dashboardModuleId: root.id,
    scopeIds: [],
    description: '空 Scope 对所有有读取权限成员可见',
  })
  createdDashboards.push(publicDashboard.id)
  const salesDashboard = await must('POST', '/dashboard/add', manager.headers, {
    name: names.sales,
    resourceUrl: `https://example.com/${stamp}/sales`,
    dashboardModuleId: root.id,
    scopeIds: [sales.user.id],
    description: '仅销售专员',
  })
  createdDashboards.push(salesDashboard.id)
  const deptDashboard = await must('POST', '/dashboard/add', manager.headers, {
    name: names.dept,
    resourceUrl: `https://example.com/${stamp}/dept`,
    dashboardModuleId: root.id,
    scopeIds: [manager.user.deptId],
    description: '销售部及下级成员',
  })
  createdDashboards.push(deptDashboard.id)
  const managerDashboard = await must('POST', '/dashboard/add', manager.headers, {
    name: names.manager,
    resourceUrl: `https://example.com/${stamp}/manager`,
    dashboardModuleId: root.id,
    scopeIds: [manager.user.id],
    description: '主管本人',
  })
  createdDashboards.push(managerDashboard.id)

  const invalidScope = await request('POST', '/dashboard/add', manager.headers, {
    name: `无效Scope-${stamp}`,
    resourceUrl: `https://example.com/${stamp}/invalid-scope`,
    dashboardModuleId: root.id,
    scopeIds: [`missing-scope-${stamp}`],
  })
  check('Dashboard 拒绝无效 Scope ID', invalidScope.status === 400)

  const duplicateDashboard = await request('POST', '/dashboard/add', manager.headers, {
    name: names.public,
    resourceUrl: `https://example.com/${stamp}/duplicate`,
    dashboardModuleId: root.id,
    scopeIds: [],
  })
  check('同目录 Dashboard 名称唯一', duplicateDashboard.status === 409)

  const salesPage = await must('POST', '/dashboard/page', sales.headers, {
    current: 1,
    pageSize: 100,
    dashboardModuleIds: [root.id],
  })
  const salesNames = new Set(salesPage.list.map((item) => item.name))
  check('空 Scope 仪表板对读取用户可见', salesNames.has(names.public))
  check('用户 ID Scope 命中可见', salesNames.has(names.sales))
  check('上级部门 Scope 对下级部门成员可见', salesNames.has(names.dept))
  check('未命中用户 Scope 不可见', !salesNames.has(names.manager))

  const deniedDetail = await request('GET', `/dashboard/detail/${managerDashboard.id}`, sales.headers)
  check('详情接口执行 Dashboard Scope', deniedDetail.status === 403)

  const deniedCollect = await request('GET', `/dashboard/collect/${managerDashboard.id}`, sales.headers)
  check('收藏接口同样执行 Dashboard Scope', deniedCollect.status === 403)

  const managerDetail = await must('GET', `/dashboard/detail/${managerDashboard.id}`, manager.headers)
  check(
    '创建人兜底可读取自己的 Dashboard',
    managerDetail.id === managerDashboard.id && managerDetail.members.some((item) => item.id === manager.user.id),
  )

  const staleCollectTime = BigInt(Date.now())
  await prisma.dashboardCollection.create({
    data: {
      userId: sales.user.id,
      dashboardId: managerDashboard.id,
      createTime: staleCollectTime,
      updateTime: staleCollectTime,
      createUser: sales.user.id,
      updateUser: sales.user.id,
    },
  })
  const staleCollectCount = await must('GET', '/dashboard/module/count', sales.headers)
  const staleCollectPage = await must('POST', '/dashboard/collect/page', sales.headers, {
    current: 1,
    pageSize: 100,
    keyword: names.manager,
  })
  check(
    '失去 Scope 的历史收藏不泄漏到收藏数量与收藏分页',
    staleCollectCount.myCollect === 0 &&
      !staleCollectPage.list.some((item) => item.id === managerDashboard.id),
  )

  const beforeCollectCount = await must('GET', '/dashboard/module/count', sales.headers)
  const collected = await must('GET', `/dashboard/collect/${publicDashboard.id}`, sales.headers)
  check('Dashboard 可收藏可见资源', collected.collected === true)
  const duplicateCollect = await request('GET', `/dashboard/collect/${publicDashboard.id}`, sales.headers)
  check('Dashboard 重复收藏由唯一约束语义拒绝', duplicateCollect.status === 409)
  const collectPage = await must('POST', '/dashboard/collect/page', sales.headers, {
    current: 1,
    pageSize: 100,
    keyword: names.public,
  })
  check(
    '我的收藏分页只返回本人可见收藏',
    collectPage.list.some((item) => item.id === publicDashboard.id && item.myCollect === true),
  )
  const afterCollectCount = await must('GET', '/dashboard/module/count', sales.headers)
  check('收藏计数随 DashboardCollection 变化', afterCollectCount.myCollect === beforeCollectCount.myCollect + 1)

  const embedPolicy = await must('GET', `/dashboard/embed/policy/${publicDashboard.id}`, sales.headers)
  check(
    'iframe 安全策略使用资源精确 origin 且不返回通配符',
    embedPolicy.origin === 'https://example.com' &&
      embedPolicy.postMessageOrigin === 'https://example.com' &&
      embedPolicy.frameSrc.length === 1 &&
      embedPolicy.frameSrc[0] === 'https://example.com' &&
      !embedPolicy.csp.includes('*'),
  )

  const uncollected = await must('GET', `/dashboard/un-collect/${publicDashboard.id}`, sales.headers)
  check('Dashboard 可取消收藏', uncollected.collected === false)
  const repeatUncollect = await must('GET', `/dashboard/un-collect/${publicDashboard.id}`, sales.headers)
  check('取消收藏重复调用保持幂等', repeatUncollect.collected === false)
  const afterUncollectCount = await must('GET', '/dashboard/module/count', sales.headers)
  check('取消收藏后计数恢复', afterUncollectCount.myCollect === beforeCollectCount.myCollect)

  const outsider = await register(
    `W344隔离租户-${stamp}`,
    'W344隔离管理员',
    `w344-${stamp}@example.test`,
    'Temp123456!',
  )
  outsiderTenantId = outsider.user.tenantId
  const crossTenantDetail = await request('GET', `/dashboard/detail/${publicDashboard.id}`, outsider.headers)
  check('其他租户不能按 Dashboard ID 读取当前租户资源', crossTenantDetail.status === 404)
  const crossTenantRename = await request('POST', '/dashboard/module/rename', outsider.headers, {
    id: root.id,
    name: `越权重命名-${stamp}`,
  })
  check('其他租户不能按 Module ID 修改当前租户目录', crossTenantRename.status === 404)
  const crossTenantPage = await must('POST', '/dashboard/page', outsider.headers, {
    current: 1,
    pageSize: 100,
  })
  check('Dashboard page 执行组织隔离', !crossTenantPage.list.some((item) => createdDashboards.includes(item.id)))

  const salesTreeAfter = flattenTree(await must('GET', '/dashboard/module/tree', sales.headers))
  const salesTreeNames = new Set(salesTreeAfter.map((item) => item.name))
  check(
    'Dashboard tree 与 page 使用相同 Scope',
    salesTreeNames.has(names.public) && salesTreeNames.has(names.sales) && salesTreeNames.has(names.dept) && !salesTreeNames.has(names.manager),
  )

  const salesCount = await must('GET', '/dashboard/module/count', sales.headers)
  check(
    'Dashboard module count 只统计当前用户可见资源',
    salesCount[root.id] === salesPage.total,
  )

  const cycleMove = await request('POST', '/dashboard/module/move', manager.headers, {
    dragNodeId: root.id,
    dropNodeId: child.id,
    dropPosition: 0,
  })
  check('DashboardModule 禁止移动到自身后代', cycleMove.status === 400)

  await must('POST', '/dashboard/module/move', manager.headers, {
    dragNodeId: child.id,
    dropNodeId: sibling.id,
    dropPosition: 1,
  })
  let managerTree = flattenTree(await must('GET', '/dashboard/module/tree', manager.headers))
  check('DashboardModule 支持跨层级移动', managerTree.find((item) => item.id === child.id)?.parentId === 'NONE')

  await must('POST', '/dashboard/module/move', manager.headers, {
    dragNodeId: child.id,
    dropNodeId: root.id,
    dropPosition: 0,
  })

  const orderA = await must('POST', '/dashboard/add', manager.headers, {
    name: names.orderA,
    resourceUrl: `https://example.com/${stamp}/order-a`,
    dashboardModuleId: sibling.id,
    scopeIds: [],
  })
  createdDashboards.push(orderA.id)
  const orderB = await must('POST', '/dashboard/add', manager.headers, {
    name: names.orderB,
    resourceUrl: `https://example.com/${stamp}/order-b`,
    dashboardModuleId: sibling.id,
    scopeIds: [],
  })
  createdDashboards.push(orderB.id)

  const updatedOrderA = await must('POST', '/dashboard/update', manager.headers, {
    id: orderA.id,
    name: names.orderA,
    resourceUrl: `https://example.com/${stamp}/order-a-updated`,
    dashboardModuleId: sibling.id,
    scopeIds: [],
    description: 'update 已生效',
  })
  check(
    'Dashboard update 更新 URL/描述并保留目录',
    updatedOrderA.resourceUrl.includes('/order-a-updated') &&
      updatedOrderA.description === 'update 已生效' &&
      updatedOrderA.dashboardModuleId === sibling.id,
  )

  const renamedOrderAName = `${names.orderA}-已改名`
  const renamedOrderA = await must('POST', '/dashboard/rename', manager.headers, {
    id: orderA.id,
    dashboardModuleId: sibling.id,
    name: renamedOrderAName,
  })
  check('Dashboard rename 成功路径', renamedOrderA.name === renamedOrderAName)

  await must('POST', '/dashboard/edit/pos', manager.headers, {
    moveId: salesDashboard.id,
    targetId: salesDashboard.id,
    dashboardModuleId: sibling.id,
    moveMode: 'APPEND',
  })
  const movedDetail = await must('GET', `/dashboard/detail/${salesDashboard.id}`, sales.headers)
  check('Dashboard 支持跨目录 APPEND', movedDetail.dashboardModuleId === sibling.id)

  await must('POST', '/dashboard/edit/pos', manager.headers, {
    moveId: orderB.id,
    targetId: orderA.id,
    dashboardModuleId: sibling.id,
    moveMode: 'BEFORE',
  })
  const orderedPage = await must('POST', '/dashboard/page', sales.headers, {
    current: 1,
    pageSize: 100,
    dashboardModuleIds: [sibling.id],
    sort: { name: 'pos', type: 'asc' },
  })
  const orderedIds = orderedPage.list.map((item) => item.id)
  check('Dashboard BEFORE 拖拽真实重排 pos', orderedIds.indexOf(orderB.id) < orderedIds.indexOf(orderA.id))

  const renameConflict = await request('POST', '/dashboard/rename', manager.headers, {
    id: orderB.id,
    dashboardModuleId: sibling.id,
    name: renamedOrderAName,
  })
  check('Dashboard rename 继续执行同目录重名校验', renameConflict.status === 409)

  const deleteBusyModule = await request('POST', '/dashboard/module/delete', manager.headers, [sibling.id])
  check('包含 Dashboard 的目录禁止删除', deleteBusyModule.status === 400)

  await must('GET', `/dashboard/delete/${orderA.id}`, manager.headers)
  createdDashboards.splice(createdDashboards.indexOf(orderA.id), 1)
  const deletedDetail = await request('GET', `/dashboard/detail/${orderA.id}`, manager.headers)
  check('Dashboard 删除后详情 404', deletedDetail.status === 404)

  await sleep(250)
  const logs = await must('GET', `/logs/operations?page=1&pageSize=100&module=dashboard`, admin.headers)
  const actions = new Set(logs.items.map((item) => item.action))
  check(
    'Dashboard 新增/移动/删除进入真实操作日志',
    actions.has('create') && actions.has('move') && actions.has('delete') && actions.has('moduleMove'),
  )
} finally {
  for (const id of [...createdDashboards].reverse()) {
    await request('GET', `/dashboard/delete/${id}`, admin.headers)
  }
  if (createdModules.length) {
    await request('POST', '/dashboard/module/delete', admin.headers, createdModules)
  }
  if (outsiderTenantId) {
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { tenantId: outsiderTenantId } })
      await tx.subscription.deleteMany({ where: { tenantId: outsiderTenantId } })
      await tx.user.deleteMany({ where: { tenantId: outsiderTenantId } })
      await tx.role.deleteMany({ where: { tenantId: outsiderTenantId } })
      await tx.department.deleteMany({ where: { tenantId: outsiderTenantId } })
      await tx.tenant.delete({ where: { id: outsiderTenantId } })
    })
  }
  await prisma.$disconnect()
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exitCode = 1
