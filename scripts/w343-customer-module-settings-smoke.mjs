/**
 * W3.4.3 / task 4.5.0～4.5.1 客户模块设置 API Smoke。
 * 验证客户公海 / 客户库容 / CUSTOMER_POOL_RS 与人工移入公海业务消费闭环。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const bcrypt = requireFromApi('bcryptjs')
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')

const base = process.env.API_BASE ?? 'http://localhost:3000/api'
const suffix = Date.now().toString(36)
let tenantId = ''
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
  if (!line) throw new Error('W3.4.3 客户模块设置 Smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }) })

async function request(method, path, headers, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    // empty response
  }
  return { response, data }
}

async function cleanup(targetTenantId) {
  if (!targetTenantId) return
  await prisma.sysDict.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.sysDictConfig.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.notification.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpPlan.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.opportunityStageLog.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.opportunityItem.deleteMany({ where: { opportunity: { tenantId: targetTenantId } } })
  await prisma.opportunity.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.opportunityStage.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.customerContact.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.customerCollaboration.deleteMany({ where: { customer: { organizationId: targetTenantId } } })
  await prisma.customerRelation.deleteMany({ where: { sourceCustomer: { organizationId: targetTenantId } } })
  await prisma.customerOwner.deleteMany({ where: { customer: { organizationId: targetTenantId } } })
  await prisma.customer.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.customerCapacity.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.customerPool.deleteMany({ where: { organizationId: targetTenantId } })
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

async function cleanupStale() {
  const tenants = await prisma.tenant.findMany({
    where: { name: { startsWith: 'W343 Customer Settings ' } },
    select: { id: true },
  })
  for (const tenant of tenants) await cleanup(tenant.id)
}

const defaultPoolPayload = (name, scopeIds, ownerIds) => ({
  name,
  scopeIds,
  ownerIds,
  enable: true,
  auto: false,
  hiddenFieldIds: [],
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

try {
  console.log('\nW3.4.3 客户模块设置 API Smoke')
  await cleanupStale()

  const password = 'Smoke123!'
  const registered = await request('POST', '/auth/register', undefined, {
    tenantName: `W343 Customer Settings ${suffix}`,
    name: 'Customer Settings Admin',
    email: `w343-customer-settings-${suffix}@smoke.local`,
    password,
  })
  check('注册临时管理员', registered.response.ok && !!registered.data?.accessToken)
  if (!registered.response.ok) throw new Error(JSON.stringify(registered.data))
  tenantId = registered.data.user.tenantId
  const adminId = registered.data.user.id
  const headers = { Authorization: `Bearer ${registered.data.accessToken}` }
  const rootDept = await prisma.department.findFirstOrThrow({ where: { tenantId, parentId: null } })

  const memberRole = await prisma.role.create({
    data: {
      tenantId,
      name: `客户公海Scope-${suffix}`,
      permissions: ['customerPool:read', 'customerPool:pick', 'menu:customer'],
      dataScope: 'SELF',
    },
  })
  const member = await prisma.user.create({
    data: {
      tenantId,
      email: `w343-customer-role-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(password, 10),
      name: 'Customer Role Scope Member',
      deptId: rootDept.id,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: memberRole.id } },
    },
  })
  const memberLogin = await request('POST', '/auth/login', undefined, { email: member.email, password })
  const memberHeaders = { Authorization: `Bearer ${memberLogin.data.accessToken}` }

  const stage = await prisma.opportunityStage.create({
    data: { tenantId, name: `客户库容排除阶段-${suffix}`, probability: 30, sort: 30 },
  })

  const poolName = `模块设置公海-${suffix}`
  const createdPool = await request(
    'POST',
    '/account-pool/add',
    headers,
    defaultPoolPayload(poolName, [`role:${memberRole.id}`], [`user:${adminId}`]),
  )
  check('模块设置可创建角色 Scope 客户公海', createdPool.response.ok)
  const poolPage = await request('POST', '/account-pool/page', headers, {
    current: 1,
    pageSize: 20,
    keyword: poolName,
  })
  const pool = poolPage.data?.list?.find((item) => item.name === poolName)
  check(
    '客户公海管理分页返回新公海与审计字段',
    !!pool?.id && !!pool.createUserName && pool.scopeIds.includes(`role:${memberRole.id}`),
  )

  const options = await request('GET', '/pool/account/options', memberHeaders)
  check(
    '角色 Scope 成员真实命中客户公海',
    options.response.ok && options.data?.some((item) => item.id === pool.id),
  )

  const capacity = await request('POST', '/account-capacity/add', headers, {
    scopeIds: [`role:${memberRole.id}`],
    capacity: 3,
    filters: [{ column: 'stage', operator: 'IN', value: [stage.id] }],
  })
  check('客户库容支持角色 Scope 与商机阶段排除', capacity.response.ok)
  const capacityRows = await request('GET', '/account-capacity/get', headers)
  const capacityRow = capacityRows.data?.find((item) =>
    item.scopeIds.includes(`role:${memberRole.id}`),
  )
  check(
    '客户库容读取保留 stage 排除条件',
    capacityRow?.filters?.[0]?.column === 'stage' && capacityRow.filters[0].value?.includes(stage.id),
  )
  const duplicateCapacity = await request('POST', '/account-capacity/add', headers, {
    scopeIds: [`user:${member.id}`],
    capacity: 5,
    filters: [],
  })
  check('客户库容重复 Scope 按实际成员拒绝', duplicateCapacity.response.status === 400)
  const invalidStage = await request('POST', '/account-capacity/update', headers, {
    id: capacityRow.id,
    scopeIds: [`role:${memberRole.id}`],
    capacity: 3,
    filters: [{ column: 'stage', operator: 'IN', value: [`missing-${suffix}`] }],
  })
  check('客户库容拒绝不存在的商机阶段', invalidStage.response.status === 400)

  const reasonA = await request('POST', '/dict/add', headers, {
    module: 'CUSTOMER_POOL_RS',
    name: `客户无效-${suffix}`,
  })
  const reasonB = await request('POST', '/dict/add', headers, {
    module: 'CUSTOMER_POOL_RS',
    name: `暂不合作-${suffix}`,
  })
  check('可新增两条移入公海原因', reasonA.response.ok && reasonB.response.ok)
  const renamedReasonName = `暂不合作-已修改-${suffix}`
  const renamedReason = await request('POST', '/dict/update', headers, {
    id: reasonB.data.id,
    name: renamedReasonName,
  })
  check('移入公海原因支持改名', renamedReason.response.ok && renamedReason.data?.name === renamedReasonName)
  const sorted = await request('POST', '/dict/sort', headers, {
    start: 2,
    end: 1,
    dragDictId: reasonB.data.id,
  })
  check('移入公海原因支持拖拽排序', sorted.response.ok && sorted.data?.[0]?.id === reasonB.data.id)
  const switched = await request('POST', '/dict/switch', headers, {
    module: 'CUSTOMER_POOL_RS',
    enable: true,
  })
  const reasonConfig = await request('GET', '/dict/config/CUSTOMER_POOL_RS', memberHeaders)
  check(
    '客户原因开关与 system 自动回收项可读取',
    switched.response.ok &&
      reasonConfig.data?.enable === true &&
      reasonConfig.data?.dictList?.some((item) => item.id === 'system'),
  )

  const customer = await request('POST', '/account/add', headers, {
    name: `原因移入公海客户-${suffix}`,
  })
  check('创建待移入公海客户', customer.response.ok && !!customer.data?.id)
  const noReason = await request('POST', '/account/to-pool', headers, {
    id: customer.data.id,
    poolId: pool.id,
  })
  const invalidReason = await request('POST', '/account/to-pool', headers, {
    id: customer.data.id,
    poolId: pool.id,
    reasonId: `missing-${suffix}`,
  })
  check('原因开启后无原因移入公海被后端拒绝', noReason.response.status === 400)
  check('不存在原因不能绕过移入公海校验', invalidReason.response.status === 400)
  const moved = await request('POST', '/account/to-pool', headers, {
    id: customer.data.id,
    poolId: pool.id,
    reasonId: reasonB.data.id,
  })
  check('携带合法原因可移入指定客户公海', moved.response.ok)

  const history = await request(
    'GET',
    `/account/owner/history/list/${customer.data.id}`,
    headers,
  )
  check(
    '客户负责人历史返回移入公海原因名称',
    history.response.ok &&
      history.data?.some(
        (item) => item.reasonId === reasonB.data.id && item.reasonName === renamedReasonName,
      ),
  )
  const noPick = await request('GET', `/account-pool/no-pick/${pool.id}`, headers)
  const deniedDelete = await request('GET', `/account-pool/delete/${pool.id}`, headers)
  check('有未领取客户时 no-pick 返回 true', noPick.data === true)
  check('绕过 UI 删除有数据客户公海仍被后端拒绝', deniedDelete.response.status === 400)

  const assigned = await request('POST', '/pool/account/assign', headers, {
    customerId: customer.data.id,
    assignUserId: member.id,
  })
  check('清空公海数据后可继续删除公海', assigned.response.ok)
  const deletedPool = await request('GET', `/account-pool/delete/${pool.id}`, headers)
  check('空客户公海可删除', deletedPool.response.ok)

  const deleteA = await request('GET', `/dict/delete/${reasonA.data.id}`, headers)
  const deleteLastDenied = await request('GET', `/dict/delete/${reasonB.data.id}`, headers)
  check('客户原因开启时可删除非最后一条', deleteA.response.ok)
  check('客户原因开启时最后一条原因禁止删除', deleteLastDenied.response.status === 400)
  await request('POST', '/dict/switch', headers, { module: 'CUSTOMER_POOL_RS', enable: false })
  const deleteLast = await request('GET', `/dict/delete/${reasonB.data.id}`, headers)
  check('关闭客户原因配置后最后一条可删除', deleteLast.response.ok)

  if (capacityRow?.id) {
    const deletedCapacity = await request(
      'GET',
      `/account-capacity/delete/${capacityRow.id}`,
      headers,
    )
    check('客户库容可删除', deletedCapacity.response.ok)
  } else {
    check('客户库容可删除', false, '未找到容量记录')
  }
} finally {
  await cleanup(tenantId).catch((error) => console.error(`  · 清理失败: ${error.message}`))
  await prisma.$disconnect()
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed) process.exitCode = 1
