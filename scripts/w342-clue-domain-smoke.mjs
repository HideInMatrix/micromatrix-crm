/**
 * W3.4.2 / task 3.6 最终线索域连续生命周期 Smoke。
 * 同一条线索贯穿普通线索 -> 跟进 -> User View -> 退池 -> 领取 -> 再退池 -> 分配。
 */
import { readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const bcrypt = requireFromApi('bcryptjs')
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')

const base = process.env.API_BASE ?? 'http://localhost:3000/api'
const suffix = Date.now().toString(36)
let tenantId = ''
let viewId = ''
let adminHeaders = null
let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
    return
  }
  failed += 1
  console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`)
}

function resolveDatabaseUrl() {
  if (process.env.SMOKE_DATABASE_URL) return process.env.SMOKE_DATABASE_URL
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.4.2 线索域 Smoke 需要 DATABASE_URL')
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }),
})

async function jsonRequest(method, path, headers, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    // 文件/空 body 接口无需 JSON。
  }
  return { response, data }
}

async function login(email, password) {
  const result = await jsonRequest('POST', '/auth/login', undefined, { email, password })
  if (!result.response.ok || !result.data?.accessToken) {
    throw new Error(`登录失败 ${email}: ${result.response.status} ${JSON.stringify(result.data)}`)
  }
  return {
    user: result.data.user,
    headers: { Authorization: `Bearer ${result.data.accessToken}` },
  }
}

async function cleanupTenant(targetTenantId) {
  if (!targetTenantId) return
  const exportTasks = await prisma.exportTask.findMany({
    where: { tenantId: targetTenantId },
    select: { filePath: true },
  })
  for (const task of exportTasks) if (task.filePath) rmSync(task.filePath, { force: true })
  await prisma.exportTask.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.messageDelivery.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.notification.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpPlan.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.attachment.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.clue.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.clueCapacity.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.cluePool.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.sysUserView.deleteMany({ where: { organizationId: targetTenantId } })

  const forms = await prisma.sysModuleForm.findMany({
    where: { organizationId: targetTenantId },
    select: { id: true },
  })
  const formIds = forms.map((item) => item.id)
  if (formIds.length) {
    const fieldIds = (
      await prisma.sysModuleField.findMany({
        where: { formId: { in: formIds } },
        select: { id: true },
      })
    ).map((item) => item.id)
    if (fieldIds.length) {
      await prisma.sysModuleFieldBlob.deleteMany({ where: { id: { in: fieldIds } } })
      await prisma.sysModuleField.deleteMany({ where: { id: { in: fieldIds } } })
    }
    await prisma.sysModuleFormBlob.deleteMany({ where: { id: { in: formIds } } })
    await prisma.sysModuleForm.deleteMany({ where: { id: { in: formIds } } })
  }

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
  const rows = await prisma.tenant.findMany({
    where: { name: { startsWith: 'W342 Domain ' } },
    select: { id: true },
  })
  for (const row of rows) await cleanupTenant(row.id)
  if (rows.length) console.log(`  · 已清理 ${rows.length} 个历史线索域 Smoke 租户`)
}

async function createPool(headers, payload) {
  const created = await jsonRequest('POST', '/lead-pool/add', headers, payload)
  if (!created.response.ok) {
    throw new Error(`创建线索池失败: ${created.response.status} ${JSON.stringify(created.data)}`)
  }
  const page = await jsonRequest('POST', '/lead-pool/page', headers, {
    current: 1,
    pageSize: 200,
    keyword: payload.name,
  })
  const pool = page.data?.list?.find((item) => item.name === payload.name)
  if (!pool?.id) throw new Error('创建后无法回查线索池')
  return pool
}

try {
  console.log('\nW3.4.2 线索域最终连续生命周期 Smoke')
  await cleanupStaleTenants()

  const adminPassword = 'Smoke123!'
  const registered = await jsonRequest('POST', '/auth/register', undefined, {
    tenantName: `W342 Domain ${suffix}`,
    name: 'W342 Domain Admin',
    email: `w342-domain-${suffix}@smoke.local`,
    password: adminPassword,
  })
  check('注册临时管理员成功', registered.response.ok && !!registered.data?.accessToken)
  if (!registered.response.ok || !registered.data?.accessToken) {
    throw new Error(`注册失败: ${registered.response.status} ${JSON.stringify(registered.data)}`)
  }

  tenantId = registered.data.user.tenantId
  const adminId = registered.data.user.id
  adminHeaders = { Authorization: `Bearer ${registered.data.accessToken}` }
  const rootDept = await prisma.department.findFirstOrThrow({ where: { tenantId, parentId: null } })

  const memberRole = await prisma.role.create({
    data: {
      tenantId,
      name: `生命周期池成员 ${suffix}`,
      permissions: [
        'menu:lead',
        'lead:update',
        'lead:recycle',
        'leadPool:read',
        'leadPool:pick',
      ],
      dataScope: 'SELF',
    },
  })
  const memberPassword = 'Member123!'
  const member = await prisma.user.create({
    data: {
      tenantId,
      email: `w342-domain-member-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(memberPassword, 10),
      name: 'Domain Member',
      deptId: rootDept.id,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: memberRole.id } },
    },
  })
  const target = await prisma.user.create({
    data: {
      tenantId,
      email: `w342-domain-target-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(memberPassword, 10),
      name: 'Domain Target',
      deptId: rootDept.id,
      status: 'ACTIVE',
    },
  })
  const memberSession = await login(member.email, memberPassword)

  const form = await jsonRequest('GET', '/lead/module/form', adminHeaders)
  const phoneField = form.data?.fields?.find((field) => field.key === 'phone')
  check('真实线索表单已初始化', form.response.ok && !!phoneField?.id)

  const pool = await createPool(adminHeaders, {
    name: `Domain Pool ${suffix}`,
    scopeIds: [member.id, target.id],
    ownerIds: [adminId],
    enable: true,
    auto: false,
    hiddenFieldIds: phoneField?.id ? [phoneField.id] : [],
    pickRule: {
      limitOnNumber: false,
      pickNumber: null,
      limitPreOwner: false,
      pickIntervalDays: null,
      limitNew: false,
      newPickInterval: null,
    },
    recycleRule: { operator: 'AND', conditions: [] },
  })
  check('创建生命周期专用直接模型线索池', !!pool.id)

  const leadName = `Domain Lead ${suffix}`
  const lead = await jsonRequest('POST', '/lead/add', adminHeaders, {
    name: leadName,
    contact: 'Lifecycle Contact',
    phone: '13900001234',
  })
  if (!lead.response.ok || !lead.data?.id) {
    throw new Error(`创建线索失败: ${lead.response.status} ${JSON.stringify(lead.data)}`)
  }
  const leadId = lead.data.id
  const createdLead = await prisma.clue.findUniqueOrThrow({ where: { id: leadId } })
  check(
    '新增普通线索为 NEW 且归当前管理员',
    lead.data.status === 'NEW' && createdLead.stage === 'NEW' && createdLead.owner === adminId,
  )

  const decoy = await jsonRequest('POST', '/lead/add', adminHeaders, {
    name: `Other Lead ${suffix}`,
  })
  if (!decoy.response.ok) throw new Error('创建 User View 对照线索失败')

  const follow = await jsonRequest('POST', '/follow-ups', adminHeaders, {
    targetType: 'lead',
    targetId: leadId,
    type: '电话',
    content: `生命周期跟进 ${suffix}`,
  })
  const plan = await jsonRequest('POST', '/follow-up-plans', adminHeaders, {
    targetType: 'lead',
    targetId: leadId,
    content: `生命周期计划 ${suffix}`,
    method: '电话',
    ownerId: adminId,
  })
  check('同一线索写入跟进记录与跟进计划', follow.response.ok && !!follow.data?.id && plan.response.ok && !!plan.data?.id)

  const savedView = await jsonRequest('POST', '/lead/view/add', adminHeaders, {
    name: `生命周期视图 ${suffix}`,
    searchMode: 'AND',
    conditions: [{ name: 'name', operator: 'contains', value: leadName, type: 'text' }],
  })
  viewId = savedView.data?.id ?? ''
  check('创建 Cordys 线索 User View', savedView.response.ok && !!viewId)

  const viewPage = await jsonRequest('POST', '/lead/page', adminHeaders, {
    current: 1,
    pageSize: 20,
    viewId,
  })
  check(
    'User View 条件真实参与 /lead/page 查询',
    viewPage.response.ok &&
      viewPage.data?.total === 1 &&
      viewPage.data?.list?.[0]?.id === leadId,
    JSON.stringify(viewPage.data),
  )

  const toPool = await jsonRequest('POST', '/lead/to-pool', adminHeaders, {
    id: leadId,
    poolId: pool.id,
  })
  check('普通线索退入指定线索池', toPool.response.ok)

  const memberOptions = await jsonRequest('GET', '/pool/lead/options', memberSession.headers)
  const memberPool = memberOptions.data?.find((item) => item.id === pool.id)
  const phoneConfig = memberPool?.fieldConfigs?.find((item) => item.fieldId === phoneField?.id)
  check(
    'Pool Scope 与 Hidden Field 在成员上下文生效',
    memberOptions.response.ok && !!memberPool && phoneConfig?.enable === false,
  )

  const poolPage = await jsonRequest('POST', '/pool/lead/page', memberSession.headers, {
    current: 1,
    pageSize: 20,
    poolId: pool.id,
  })
  check(
    '成员在授权 Pool 中读取同一条线索',
    poolPage.response.ok && poolPage.data?.list?.some((item) => item.id === leadId),
  )

  const pick = await jsonRequest('POST', '/pool/lead/pick', memberSession.headers, {
    clueId: leadId,
    poolId: pool.id,
  })
  const afterPick = await prisma.clue.findUniqueOrThrow({ where: { id: leadId } })
  check(
    '成员领取后资源离池并进入 FOLLOWING',
    pick.response.ok &&
      afterPick.owner === member.id &&
      afterPick.inSharedPool === false &&
      afterPick.poolId === null &&
      afterPick.stage === 'FOLLOWING',
  )

  const followAfterPick = await jsonRequest(
    'GET',
    `/follow-ups?targetType=lead&targetId=${leadId}`,
    memberSession.headers,
  )
  const planAfterPick = await jsonRequest(
    'GET',
    `/follow-up-plans?page=1&pageSize=20&targetType=lead&targetId=${leadId}`,
    memberSession.headers,
  )
  check(
    '领取不丢失原跟进记录和计划',
    followAfterPick.response.ok &&
      followAfterPick.data?.some((item) => item.id === follow.data.id) &&
      planAfterPick.response.ok &&
      planAfterPick.data?.items?.some((item) => item.id === plan.data.id),
  )

  const memberToPool = await jsonRequest('POST', '/lead/to-pool', memberSession.headers, {
    id: leadId,
    poolId: pool.id,
  })
  check('领取成员可按普通线索权限再次退回授权 Pool', memberToPool.response.ok)

  const assign = await jsonRequest('POST', '/pool/lead/assign', adminHeaders, {
    clueId: leadId,
    assignUserId: target.id,
  })
  const afterAssign = await prisma.clue.findUniqueOrThrow({ where: { id: leadId } })
  check(
    '管理员从 Pool 分配给目标成员',
    assign.response.ok &&
      afterAssign.owner === target.id &&
      afterAssign.inSharedPool === false &&
      afterAssign.poolId === null &&
      afterAssign.stage === 'FOLLOWING',
  )

  const history = await jsonRequest('GET', `/lead/owner/history/list/${leadId}`, adminHeaders)
  const historyOwners = new Set((history.data ?? []).map((item) => item.ownerId ?? item.owner))
  check(
    '连续退池/领取/再退池形成完整 Owner History',
    history.response.ok && historyOwners.has(adminId) && historyOwners.has(member.id),
    JSON.stringify(history.data),
  )

  const exportSelected = await jsonRequest('POST', '/lead/export-select', adminHeaders, {
    fileName: `domain-export-${suffix}`,
    headList: ['name', 'status'],
    ids: [leadId],
  })
  check('生命周期最终普通线索仍可创建选中导出任务', exportSelected.response.ok && !!exportSelected.data?.id)

  const oldController = await jsonRequest('GET', '/leads', adminHeaders)
  check('最终状态旧 /api/leads Controller 仍为 404', oldController.response.status === 404)
} catch (error) {
  failed += 1
  console.error(`  ✗ 生命周期 Smoke 执行失败: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try {
    if (viewId && adminHeaders) await jsonRequest('GET', `/lead/view/delete/${viewId}`, adminHeaders)
    await cleanupTenant(tenantId)
  } catch (error) {
    failed += 1
    console.error(`  ✗ Smoke 清理失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  await prisma.$disconnect()
}

console.log(`\nW3.4.2 线索域连续生命周期 Smoke：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
