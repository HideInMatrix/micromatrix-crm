/**
 * W3.4.2 / task 3.2 普通线索 API Smoke。
 * 前置：API 已启动，当前 Prisma migration 已应用，API production build 已生成 Prisma Client。
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
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
  if (!line) throw new Error('W3.4.2 Smoke 需要 DATABASE_URL 或 apps/api/.env 中的 DATABASE_URL')
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }),
})
const suffix = Date.now().toString(36)
const id = () => randomUUID().replaceAll('-', '')
let tenantId = ''

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

async function cleanupTenant(targetTenantId) {
  if (!targetTenantId) return

  const exportTasks = await prisma.exportTask.findMany({
    where: { tenantId: targetTenantId },
    select: { id: true, filePath: true },
  })
  for (const task of exportTasks) {
    if (task.filePath) rmSync(task.filePath, { force: true })
  }
  await prisma.exportTask.deleteMany({ where: { tenantId: targetTenantId } })

  await prisma.followUpPlan.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.attachment.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.clue.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.clueCapacity.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.cluePool.deleteMany({ where: { organizationId: targetTenantId } })

  const forms = await prisma.sysModuleForm.findMany({
    where: { organizationId: targetTenantId },
    select: { id: true },
  })
  const formIds = forms.map((form) => form.id)
  if (formIds.length) {
    const fields = await prisma.sysModuleField.findMany({
      where: { formId: { in: formIds } },
      select: { id: true },
    })
    const fieldIds = fields.map((field) => field.id)
    if (fieldIds.length) {
      await prisma.sysModuleFieldBlob.deleteMany({ where: { id: { in: fieldIds } } })
      await prisma.sysModuleField.deleteMany({ where: { id: { in: fieldIds } } })
    }
    await prisma.sysModuleFormBlob.deleteMany({ where: { id: { in: formIds } } })
    await prisma.sysModuleForm.deleteMany({ where: { id: { in: formIds } } })
  }

  await prisma.notification.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.operationLog.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.loginLog.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.subscription.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.userRole.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.user.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.department.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.role.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.tenant.deleteMany({ where: { id: targetTenantId } })
}

async function cleanupStaleTenants() {
  const stale = await prisma.tenant.findMany({
    where: { name: { startsWith: 'W342 Clue ' } },
    select: { id: true },
  })
  for (const tenant of stale) await cleanupTenant(tenant.id)
  if (stale.length) console.log(`  · 已清理 ${stale.length} 个历史 W3.4.2 Smoke 临时租户`)
}

try {
  console.log('\nW3.4.2 普通线索 API Smoke')
  await cleanupStaleTenants()

  const email = `w342-clue-${suffix}@smoke.local`
  const password = 'Smoke123!'
  const registered = await jsonRequest('POST', '/auth/register', undefined, {
    tenantName: `W342 Clue ${suffix}`,
    name: 'W342 Admin',
    email,
    password,
  })
  check('注册临时管理员成功', registered.response.ok && !!registered.data?.accessToken)
  if (!registered.response.ok || !registered.data?.accessToken) {
    throw new Error(`注册失败: ${registered.response.status} ${JSON.stringify(registered.data)}`)
  }
  tenantId = registered.data.user.tenantId
  const adminId = registered.data.user.id
  const headers = { Authorization: `Bearer ${registered.data.accessToken}` }

  const moduleForm = await jsonRequest('GET', '/lead/module/form', headers)
  const sourceField = moduleForm.data?.fields?.find((field) => field.key === 'cf_source')
  check(
    '/lead/module/form 返回真实动态表单',
    moduleForm.response.ok && Array.isArray(moduleForm.data?.fields) && !!sourceField?.id,
  )

  const clueAName = `W342 普通线索 A ${suffix}`
  const clueA = await jsonRequest('POST', '/lead/add', headers, {
    name: clueAName,
    contact: '联系人 A',
    phone: '13800000001',
    moduleFields: [{ fieldId: sourceField.id, fieldValue: '官网表单' }],
  })
  check(
    '/lead/add 创建 NEW 状态普通线索',
    clueA.response.ok && clueA.data?.name === clueAName && clueA.data?.status === 'NEW',
    JSON.stringify(clueA.data),
  )
  const clueAId = clueA.data?.id

  const clueBName = `W342 普通线索 B ${suffix}`
  const clueB = await jsonRequest('POST', '/lead/add', headers, {
    name: clueBName,
    contact: '联系人 B',
    phone: '13800000002',
    moduleFields: [{ fieldId: sourceField.id, fieldValue: '电话咨询' }],
  })
  check('/lead/add 可连续新增线索', clueB.response.ok && clueB.data?.status === 'NEW')
  const clueBId = clueB.data?.id

  const page = await jsonRequest('POST', '/lead/page', headers, {
    current: 1,
    pageSize: 20,
    keyword: 'W342 普通线索',
    sort: { fieldId: 'name', direction: 'ASC' },
  })
  check(
    '/lead/page 使用 Cordys Pager 字段并执行排序',
    page.response.ok &&
      Array.isArray(page.data?.list) &&
      page.data?.current === 1 &&
      page.data?.list?.[0]?.name === clueAName &&
      page.data?.list?.[1]?.name === clueBName,
    JSON.stringify(page.data),
  )

  const detail = await jsonRequest('GET', `/lead/get/${clueAId}`, headers)
  check('/lead/get/:id 返回普通线索详情', detail.response.ok && detail.data?.id === clueAId)

  const partialUpdate = await jsonRequest('POST', '/lead/update', headers, {
    id: clueAId,
    phone: '13900000001',
  })
  check(
    '/lead/update 支持不携带 name 的部分更新',
    partialUpdate.response.ok && partialUpdate.data?.phone === '13900000001',
    JSON.stringify(partialUpdate.data),
  )

  const statusUpdate = await jsonRequest('POST', '/lead/status/update', headers, {
    id: clueAId,
    stage: 'INTERESTED',
  })
  check(
    '/lead/status/update 使用 Cordys 状态并维护 lastStage',
    statusUpdate.response.ok &&
      statusUpdate.data?.stage === 'INTERESTED' &&
      statusUpdate.data?.lastStage === 'NEW',
    JSON.stringify(statusUpdate.data),
  )

  const phoneField = moduleForm.data.fields.find((field) => field.key === 'phone')
  const batchUpdate = await jsonRequest('POST', '/lead/batch/update', headers, {
    ids: [clueAId, clueBId],
    fieldId: phoneField.id,
    fieldValue: '13700000000',
  })
  check(
    '/lead/batch/update 批量修改字段',
    batchUpdate.response.ok && batchUpdate.data?.success === 2 && batchUpdate.data?.fail === 0,
    JSON.stringify(batchUpdate.data),
  )

  const targetPassword = 'Target123!'
  const targetUser = await prisma.user.create({
    data: {
      tenantId,
      email: `w342-target-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(targetPassword, 10),
      name: 'W342 Target',
      status: 'ACTIVE',
    },
  })
  const batchTransfer = await jsonRequest('POST', '/lead/batch/transfer', headers, {
    ids: [clueAId, clueBId],
    owner: targetUser.id,
  })
  const transferred = await prisma.clue.findMany({
    where: { id: { in: [clueAId, clueBId] } },
    select: { id: true, owner: true },
  })
  const transferHistory = await prisma.clueOwner.count({
    where: { clueId: { in: [clueAId, clueBId] }, owner: adminId },
  })
  check(
    '/lead/batch/transfer 单事务转移并写 Owner History',
    batchTransfer.response.ok &&
      batchTransfer.data?.count === 2 &&
      transferred.every((item) => item.owner === targetUser.id) &&
      transferHistory === 2,
    JSON.stringify(batchTransfer.data),
  )

  const history = await jsonRequest('GET', `/lead/owner/history/list/${clueAId}`, headers)
  check(
    '/lead/owner/history/list/:id 返回负责人历史',
    history.response.ok && Array.isArray(history.data) && history.data.length >= 1,
  )

  const now = BigInt(Date.now())
  const pool = await prisma.cluePool.create({
    data: {
      id: id(),
      name: `W342 线索池 ${suffix}`,
      scopeId: JSON.stringify([adminId, targetUser.id]),
      organizationId: tenantId,
      ownerId: JSON.stringify([adminId]),
      enable: true,
      auto: false,
      createTime: now,
      updateTime: now,
      createUser: adminId,
      updateUser: adminId,
    },
  })
  const moveToPool = await jsonRequest('POST', '/lead/to-pool', headers, {
    id: clueAId,
    poolId: pool.id,
    reasonId: 'manual',
  })
  const moved = await prisma.clue.findUnique({ where: { id: clueAId } })
  check(
    '/lead/to-pool 清空 Owner/领取时间并保存池与原因',
    moveToPool.response.ok &&
      moved?.inSharedPool === true &&
      moved?.poolId === pool.id &&
      moved?.owner === null &&
      moved?.collectionTime === null &&
      moved?.reasonId === 'manual',
  )

  const ordinaryAfterPool = await jsonRequest('POST', '/lead/page', headers, {
    current: 1,
    pageSize: 20,
    keyword: clueAName,
  })
  check(
    '普通 /lead/page 强制排除线索池数据',
    ordinaryAfterPool.response.ok && ordinaryAfterPool.data?.total === 0,
    JSON.stringify(ordinaryAfterPool.data),
  )

  const templateResponse = await fetch(`${base}/lead/template/download?importType=ADD`, { headers })
  check(
    '/lead/template/download 返回真实 xlsx 模板',
    templateResponse.ok &&
      (templateResponse.headers.get('content-type') ?? '').includes('spreadsheetml'),
  )

  const exportResult = await jsonRequest('POST', '/lead/export', headers, {
    current: 1,
    pageSize: 100,
    keyword: clueBName,
    fileName: `w342-clue-${suffix}`,
    headList: ['name', 'phone'],
  })
  check(
    '/lead/export 生成真实导出任务',
    exportResult.response.ok &&
      exportResult.data?.status === 'SUCCESS' &&
      exportResult.data?.rowCount === 1,
    JSON.stringify(exportResult.data),
  )

  const chartResult = await jsonRequest('POST', '/lead/chart', headers, {
    chartConfig: {
      categoryAxis: { fieldId: sourceField.id },
      valueAxis: { aggregateMethod: 'COUNT' },
    },
  })
  check(
    '/lead/chart 基于真实动态字段聚合',
    chartResult.response.ok &&
      Array.isArray(chartResult.data) &&
      chartResult.data.some(
        (item) => item.categoryAxis === '电话咨询' && Number(item.valueAxis) === 1,
      ),
    JSON.stringify(chartResult.data),
  )

  const deleteB = await jsonRequest('GET', `/lead/delete/${clueBId}`, headers)
  const deletedB = await prisma.clue.findUnique({ where: { id: clueBId } })
  check('/lead/delete/:id 删除普通线索', deleteB.response.ok && deletedB === null)

  const oldController = await jsonRequest('GET', '/leads', headers)
  check('旧 /api/leads Controller 已删除并返回 404', oldController.response.status === 404)
} catch (error) {
  failed += 1
  console.error(`  ✗ Smoke 执行异常: ${error instanceof Error ? error.stack : String(error)}`)
} finally {
  try {
    await cleanupTenant(tenantId)
  } catch (error) {
    failed += 1
    console.error(`  ✗ 清理临时租户失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  await prisma.$disconnect()
}

console.log(`\nW3.4.2 普通线索 API Smoke：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
