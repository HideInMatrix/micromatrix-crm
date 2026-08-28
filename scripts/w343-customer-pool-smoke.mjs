/**
 * W3.4.3 / task 4.5 客户公海资源链路 Smoke。
 * 验证 /pool/account/* 的 Pool Scope、领取/分配、批量同池约束、导入模板与导出边界。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const bcrypt = requireFromApi('bcryptjs')
const ExcelJS = requireFromApi('exceljs')
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')
const { CluePoolRepository } = requireFromApi('./dist/modules/pool-rules/clue-pool.repository.js')
const { CustomerPoolRepository } = requireFromApi('./dist/modules/pool-rules/customer-pool.repository.js')
const { PoolRecycleService } = requireFromApi('./dist/modules/pool-rules/pool-recycle.service.js')
const { PoolRuleCalculator } = requireFromApi('./dist/modules/pool-rules/pool-rule-calculator.service.js')
const { ResourceRecycleConditionEvaluator } = requireFromApi(
  './dist/modules/pool-rules/resource-recycle-condition-evaluator.service.js',
)

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
  if (!line) throw new Error('W3.4.3 客户公海 Smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }) })

async function request(method, path, headers, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const raw = await response.text()
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    // Binary or empty response.
  }
  return { response, data, raw }
}

async function binaryRequest(method, path, headers) {
  const response = await fetch(`${base}${path}`, { method, headers: headers ?? {} })
  return { response, buffer: Buffer.from(await response.arrayBuffer()) }
}

async function multipartImport(path, headers, fileBuffer, poolId, importType = 'ADD') {
  const form = new FormData()
  form.append(
    'file',
    new Blob([fileBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'customer-pool-import.xlsx',
  )
  form.append('poolId', poolId)
  form.append('importType', importType)
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: form,
  })
  const raw = await response.text()
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    // ignore
  }
  return { response, data, raw }
}

async function cleanup(targetTenantId) {
  if (!targetTenantId) return
  const exportTasks = await prisma.exportTask.findMany({
    where: { tenantId: targetTenantId },
    select: { id: true },
  })
  if (exportTasks.length) await prisma.exportTask.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.notification.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpPlan.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.customerContact.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.customerCollaboration.deleteMany({ where: { customer: { organizationId: targetTenantId } } })
  await prisma.customerRelation.deleteMany({ where: { sourceCustomer: { organizationId: targetTenantId } } })
  await prisma.customerOwner.deleteMany({ where: { customer: { organizationId: targetTenantId } } })
  await prisma.customerField.deleteMany({ where: { resource: { organizationId: targetTenantId } } }).catch(() => {})
  await prisma.customerFieldBlob.deleteMany({ where: { resource: { organizationId: targetTenantId } } }).catch(() => {})
  await prisma.customer.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.customerCapacity.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.customerPool.deleteMany({ where: { organizationId: targetTenantId } })
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

async function cleanupStale() {
  const tenants = await prisma.tenant.findMany({
    where: { name: { startsWith: 'W343 Customer Pool ' } },
    select: { id: true },
  })
  for (const tenant of tenants) await cleanup(tenant.id)
}

const poolPayload = (name, scopeIds, ownerIds, pickNumber = null) => ({
  name,
  scopeIds,
  ownerIds,
  enable: true,
  auto: false,
  hiddenFieldIds: [],
  pickRule: {
    limitOnNumber: pickNumber !== null,
    pickNumber,
    limitPreOwner: false,
    pickIntervalDays: null,
    limitNew: false,
    newPickInterval: null,
  },
  recycleRule: { operator: 'AND', conditions: [] },
})

async function createCustomerInPool(headers, name, poolId) {
  const created = await request('POST', '/account/add', headers, { name })
  if (!created.response.ok) throw new Error(`创建客户失败: ${created.response.status} ${created.raw}`)
  const moved = await request('POST', '/account/to-pool', headers, { id: created.data.id, poolId })
  if (!moved.response.ok) throw new Error(`移入公海失败: ${moved.response.status} ${moved.raw}`)
  return created.data.id
}

try {
  console.log('\nW3.4.3 客户公海资源 API Smoke')
  await cleanupStale()

  const password = 'Smoke123!'
  const registered = await request('POST', '/auth/register', undefined, {
    tenantName: `W343 Customer Pool ${suffix}`,
    name: 'Customer Pool Admin',
    email: `w343-customer-pool-${suffix}@smoke.local`,
    password,
  })
  check('注册临时管理员', registered.response.ok && !!registered.data?.accessToken)
  if (!registered.response.ok) throw new Error(registered.raw)
  tenantId = registered.data.user.tenantId
  const adminId = registered.data.user.id
  const adminHeaders = { Authorization: `Bearer ${registered.data.accessToken}` }
  const rootDept = await prisma.department.findFirstOrThrow({ where: { tenantId, parentId: null } })

  const poolRole = await prisma.role.create({
    data: {
      tenantId,
      name: `Pool Member ${suffix}`,
      permissions: [
        'menu:customer',
        'customerPool:read',
        'customerPool:pick',
        'customerPool:assign',
        'customerPool:update',
        'customerPool:delete',
        'customerPool:export',
        'customerPool:import',
      ],
      dataScope: 'SELF',
    },
  })
  const member = await prisma.user.create({
    data: {
      tenantId,
      email: `pool-member-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(password, 10),
      name: 'Pool Member',
      deptId: rootDept.id,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: poolRole.id } },
    },
  })
  const memberLogin = await request('POST', '/auth/login', undefined, {
    email: member.email,
    password,
  })
  const memberHeaders = { Authorization: `Bearer ${memberLogin.data.accessToken}` }

  const outsiderRole = await prisma.role.create({
    data: {
      tenantId,
      name: `Pool Outsider ${suffix}`,
      permissions: ['menu:customer', 'customerPool:read'],
      dataScope: 'SELF',
    },
  })
  const outsider = await prisma.user.create({
    data: {
      tenantId,
      email: `pool-outsider-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(password, 10),
      name: 'Pool Outsider',
      deptId: rootDept.id,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: outsiderRole.id } },
    },
  })
  const outsiderLogin = await request('POST', '/auth/login', undefined, {
    email: outsider.email,
    password,
  })
  const outsiderHeaders = { Authorization: `Bearer ${outsiderLogin.data.accessToken}` }

  await request('POST', '/account-pool/add', adminHeaders, poolPayload(
    `公海A-${suffix}`,
    [`role:${poolRole.id}`],
    [`user:${adminId}`],
    1,
  ))
  await request('POST', '/account-pool/add', adminHeaders, poolPayload(
    `公海B-${suffix}`,
    [`user:${adminId}`],
    [`user:${adminId}`],
  ))
  const poolPage = await request('POST', '/account-pool/page', adminHeaders, { current: 1, pageSize: 20 })
  const poolA = poolPage.data.list.find((item) => item.name === `公海A-${suffix}`)
  const poolB = poolPage.data.list.find((item) => item.name === `公海B-${suffix}`)
  check('创建两个客户公海', Boolean(poolA?.id && poolB?.id))

  const memberOptions = await request('GET', '/pool/account/options', memberHeaders)
  check(
    '普通成员只看到命中 Scope 的启用公海',
    memberOptions.response.ok &&
      memberOptions.data.some((item) => item.id === poolA.id) &&
      !memberOptions.data.some((item) => item.id === poolB.id),
  )
  const outsiderOptions = await request('GET', '/pool/account/options', outsiderHeaders)
  check('未命中 Scope 的用户看不到公海', outsiderOptions.response.ok && outsiderOptions.data.length === 0)

  const pageWithoutPool = await request('POST', '/pool/account/page', memberHeaders, {
    current: 1,
    pageSize: 10,
  })
  check('/pool/account/page 强制 poolId', pageWithoutPool.response.status === 400)
  const deniedPage = await request('POST', '/pool/account/page', memberHeaders, {
    current: 1,
    pageSize: 10,
    poolId: poolB.id,
  })
  check(
    '不能分页读取未命中 Scope 的公海',
    [400, 403, 404].includes(deniedPage.response.status),
  )

  const customerA1 = await createCustomerInPool(adminHeaders, `公海A客户1-${suffix}`, poolA.id)
  const customerA2 = await createCustomerInPool(adminHeaders, `公海A客户2-${suffix}`, poolA.id)
  const customerA3 = await createCustomerInPool(adminHeaders, `公海A客户3-${suffix}`, poolA.id)
  const customerB1 = await createCustomerInPool(adminHeaders, `公海B客户1-${suffix}`, poolB.id)
  const customerB2 = await createCustomerInPool(adminHeaders, `公海B客户2-${suffix}`, poolB.id)

  const pageA = await request('POST', '/pool/account/page', memberHeaders, {
    current: 1,
    pageSize: 20,
    poolId: poolA.id,
  })
  check(
    '公海分页只返回指定 Pool 数据',
    pageA.response.ok && pageA.data.list.length === 3 && pageA.data.list.every((item) => item.poolId === poolA.id),
  )
  const detail = await request('GET', `/pool/account/get/${customerA1}`, memberHeaders)
  check('公海详情通过 /pool/account/get 读取', detail.response.ok && detail.data.id === customerA1)
  const normalDetail = await request('GET', `/account/get/${customerA1}`, memberHeaders)
  check(
    '公海客户不能绕普通客户详情读取',
    [403, 404].includes(normalDetail.response.status),
  )
  const collaboration = await request('GET', `/account/collaboration/list/${customerA1}`, memberHeaders)
  check('公海详情不开放协作页签后端链路', collaboration.response.status === 403 || collaboration.response.status === 404)

  await request('POST', '/account-capacity/add', adminHeaders, {
    scopeIds: [`role:${poolRole.id}`],
    capacity: 0,
    filters: [],
  })
  const capacityRows = await request('GET', '/account-capacity/get', adminHeaders)
  const capacity = capacityRows.data.find((item) => item.scopeIds.includes(`role:${poolRole.id}`))
  const zeroCapacityPick = await request('POST', '/pool/account/pick', memberHeaders, {
    customerId: customerA1,
    poolId: poolA.id,
  })
  check('客户库容 0 真实阻止领取', zeroCapacityPick.response.status === 400)
  await request('POST', '/account-capacity/update', adminHeaders, {
    id: capacity.id,
    scopeIds: [`role:${poolRole.id}`],
    capacity: null,
    filters: [],
  })

  const mismatchPick = await request('POST', '/pool/account/pick', memberHeaders, {
    customerId: customerA1,
    poolId: poolB.id,
  })
  check('单条领取校验请求 poolId 与客户真实公海一致', mismatchPick.response.status === 400)
  const picked = await request('POST', '/pool/account/pick', memberHeaders, {
    customerId: customerA1,
    poolId: poolA.id,
  })
  check('成员可领取命中 Scope 的公海客户', picked.response.ok)
  const pickedRow = await prisma.customer.findUnique({ where: { id: customerA1 } })
  check('领取后清空公海并写负责人/领取时间', !pickedRow.inSharedPool && pickedRow.owner === member.id && pickedRow.collectionTime !== null)
  const dailyLimit = await request('POST', '/pool/account/pick', memberHeaders, {
    customerId: customerA2,
    poolId: poolA.id,
  })
  check('每日领取上限对普通成员生效', dailyLimit.response.status === 400)

  const mixedAssign = await request('POST', '/pool/account/batch-assign', adminHeaders, {
    batchIds: [customerA2, customerB1],
    assignUserId: member.id,
  })
  check('批量分配拒绝跨公海选择', mixedAssign.response.status === 400)
  const mixedRowsAfterAssign = await prisma.customer.findMany({
    where: { id: { in: [customerA2, customerB1] } },
  })
  check('跨公海批量分配失败不产生部分领取', mixedRowsAfterAssign.every((item) => item.inSharedPool))

  const mixedUpdate = await request('POST', '/pool/account/batch-update', adminHeaders, {
    ids: [customerA2, customerB1],
    fieldId: 'invalid-field-is-not-reached',
    fieldValue: 'noop',
  })
  check('批量编辑拒绝跨公海选择', mixedUpdate.response.status === 400)

  const mixedDelete = await request('POST', '/pool/account/batch-delete', adminHeaders, {
    batchIds: [customerA3, customerB2],
  })
  check('批量删除无需 poolId 但拒绝跨公海选择', mixedDelete.response.status === 400)
  const samePoolDelete = await request('POST', '/pool/account/batch-delete', adminHeaders, {
    batchIds: [customerA3],
  })
  check('同公海批量删除按 Cordys 契约无需 poolId', samePoolDelete.response.ok)

  const mixedExport = await request('POST', '/pool/account/export-select', adminHeaders, {
    ids: [customerA2, customerB1],
    fileName: `mixed-${suffix}`,
    headList: ['name'],
  })
  check('导出选中拒绝跨公海数据', mixedExport.response.status === 400)
  const samePoolExport = await request('POST', '/pool/account/export-select', adminHeaders, {
    ids: [customerA2],
    fileName: `pool-${suffix}`,
    headList: ['name'],
  })
  const exportTask = samePoolExport.response.ok
    ? await prisma.exportTask.findFirst({ where: { id: samePoolExport.data?.id ?? '' } })
    : null
  check('同公海导出选中创建导出任务', samePoolExport.response.ok && !!samePoolExport.data)
  check('公海导出任务使用 customer_pool 模块', exportTask?.module === 'customer_pool')

  const exportAll = await request('POST', '/pool/account/export-all', adminHeaders, {
    current: 1,
    pageSize: 20,
    poolId: poolA.id,
    fileName: `pool-all-${suffix}`,
    headList: ['name'],
  })
  check('公海导出全部按指定 poolId 创建任务', exportAll.response.ok && !!exportAll.data)

  const customerForm = await prisma.sysModuleForm.findFirst({
    where: { organizationId: tenantId, formKey: 'customer' },
    include: { fields: true },
  })
  const nameField = customerForm?.fields.find((field) => field.internalKey === 'name')
  const chart = nameField
    ? await request('POST', '/pool/account/chart', adminHeaders, {
        poolId: poolA.id,
        chartConfig: {
          categoryAxis: { fieldId: nameField.id },
          valueAxis: { aggregateMethod: 'COUNT' },
        },
      })
    : null
  check('公海图表按 Pool Scope 生成', Boolean(chart?.response.ok && Array.isArray(chart.data)))

  const template = await binaryRequest('GET', '/pool/account/template/download?importType=ADD', adminHeaders)
  const workbook = new ExcelJS.Workbook()
  if (template.response.ok) await workbook.xlsx.load(template.buffer)
  const worksheet = workbook.worksheets[0]
  const headers = worksheet
    ? worksheet.getRow(1).values.slice(1).map((value) => String(value ?? ''))
    : []
  check('客户公海导入模板可下载', template.response.ok && template.buffer.length > 0)
  check('客户公海导入模板不暴露负责人列', !headers.some((value) => value.includes('负责人')))

  const importName = `公海导入客户-${suffix}`
  const importNameColumn = headers.findIndex((value) => value.includes('客户名称')) + 1
  if (worksheet && importNameColumn > 0) {
    worksheet.getCell(2, importNameColumn).value = importName
  }
  const importBuffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const precheckImport = await multipartImport(
    '/pool/account/import/pre-check',
    adminHeaders,
    importBuffer,
    poolA.id,
  )
  check(
    '客户公海导入预检按 Pool Scope 通过',
    precheckImport.response.ok && precheckImport.data?.successCount === 1,
  )
  const imported = await multipartImport(
    '/pool/account/import',
    adminHeaders,
    importBuffer,
    poolA.id,
  )
  const importedCustomer = await prisma.customer.findFirst({
    where: { organizationId: tenantId, name: importName },
  })
  check('客户公海真实导入成功', imported.response.ok && imported.data?.successCount === 1)
  check(
    '导入客户直接落入指定公海且负责人为空',
    importedCustomer?.inSharedPool === true &&
      importedCustomer.poolId === poolA.id &&
      importedCustomer.owner === null,
  )

  const deleteOne = await createCustomerInPool(adminHeaders, `公海单删客户-${suffix}`, poolB.id)
  const deletedOne = await request('GET', `/pool/account/delete/${deleteOne}`, adminHeaders)
  check('公海单条删除按客户反查 Pool 后执行', deletedOne.response.ok)

  const batchPick1 = await createCustomerInPool(adminHeaders, `公海批领1-${suffix}`, poolB.id)
  const batchPick2 = await createCustomerInPool(adminHeaders, `公海批领2-${suffix}`, poolB.id)
  const batchPicked = await request('POST', '/pool/account/batch-pick', adminHeaders, {
    poolId: poolB.id,
    batchIds: [batchPick1, batchPick2],
  })
  check('公海管理员可批量领取同池客户', batchPicked.response.ok && batchPicked.data?.success === 2)

  const autoPoolName = `自动回收公海-${suffix}`
  await request('POST', '/account-pool/add', adminHeaders, {
    ...poolPayload(autoPoolName, [`user:${member.id}`], [`user:${adminId}`]),
    auto: true,
    recycleRule: {
      operator: 'AND',
      conditions: [
        {
          column: 'storageTime',
          operator: 'DYNAMICS',
          value: 'CUSTOM,1,BEFORE_DAY',
          scope: ['Picked'],
        },
      ],
    },
  })
  const autoPoolPage = await request('POST', '/account-pool/page', adminHeaders, {
    current: 1,
    pageSize: 20,
    keyword: autoPoolName,
  })
  const autoPool = autoPoolPage.data?.list?.find((item) => item.name === autoPoolName)
  const autoCustomer = await request('POST', '/account/add', adminHeaders, {
    name: `自动回收客户-${suffix}`,
    owner: member.id,
  })
  await prisma.customer.update({
    where: { id: autoCustomer.data.id },
    data: {
      collectionTime: BigInt(Date.now() - 3 * 24 * 60 * 60 * 1000),
      updateTime: BigInt(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
  })
  const calculator = new PoolRuleCalculator()
  const recycleNotifications = []
  const recycleService = new PoolRecycleService(
    prisma,
    { send: async (input) => recycleNotifications.push(input) },
    new CluePoolRepository(prisma, calculator),
    new CustomerPoolRepository(prisma, calculator),
    new ResourceRecycleConditionEvaluator(),
  )
  const recycled = await recycleService.recycleTenant(tenantId)
  const recycledCustomer = await prisma.customer.findUnique({ where: { id: autoCustomer.data.id } })
  check('客户自动回收任务消费 customer_pool recycle rule', recycled.recycledCustomers >= 1)
  check(
    '自动回收写入目标公海、清空负责人并记录 system 原因',
    recycledCustomer?.inSharedPool === true &&
      recycledCustomer.poolId === autoPool.id &&
      recycledCustomer.owner === null &&
      recycledCustomer.reasonId === 'system',
  )
  check(
    '客户自动回收发送 CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS 通知',
    recycleNotifications.some((item) => item.event === 'CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS'),
  )

  const ownerHistory = await request('GET', `/account/owner/history/list/${customerA2}`, memberHeaders)
  check('公海详情允许读取负责人历史', ownerHistory.response.ok)
} finally {
  await cleanup(tenantId).catch((error) => console.error(`  · 清理失败: ${error.message}`))
  await prisma.$disconnect()
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed) process.exitCode = 1
