/**
 * W3.4.3 / task 4.2 客户 API + 客户 360 Smoke。
 * 前置：API 已启动，当前 Prisma migration 已应用，apps/api dist 已生成 Prisma Client。
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
  if (!line) throw new Error('W3.4.3 客户 Smoke 需要 DATABASE_URL')
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
    // empty/file response
  }
  return { response, data }
}

async function login(email, password) {
  const result = await jsonRequest('POST', '/auth/login', undefined, { email, password })
  if (!result.response.ok || !result.data?.accessToken) {
    throw new Error(`登录失败 ${email}: ${result.response.status} ${JSON.stringify(result.data)}`)
  }
  return { Authorization: `Bearer ${result.data.accessToken}` }
}

async function cleanupTenant(targetTenantId) {
  if (!targetTenantId) return
  const exportTasks = await prisma.exportTask.findMany({
    where: { tenantId: targetTenantId },
    select: { filePath: true },
  })
  for (const task of exportTasks) if (task.filePath) rmSync(task.filePath, { force: true })
  await prisma.exportTask.deleteMany({ where: { tenantId: targetTenantId } })
  const customers = await prisma.customer.findMany({
    where: { organizationId: targetTenantId },
    select: { id: true },
  })
  const customerIds = customers.map((item) => item.id)
  if (customerIds.length) {
    await prisma.customerField.deleteMany({ where: { resourceId: { in: customerIds } } })
    await prisma.customerFieldBlob.deleteMany({ where: { resourceId: { in: customerIds } } })
  }

  await prisma.order.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.invoiceRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.invoiceTitle.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.receivableRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.receivablePlan.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.contractItem.deleteMany({ where: { contract: { tenantId: targetTenantId } } })
  await prisma.contract.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.opportunityStageLog.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.opportunityItem.deleteMany({ where: { opportunity: { tenantId: targetTenantId } } })
  await prisma.opportunity.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.opportunityStage.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.customerContact.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.followUpPlan.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.attachment.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.customerCollaboration.deleteMany({
    where: { customer: { organizationId: targetTenantId } },
  })
  await prisma.customerRelation.deleteMany({
    where: { sourceCustomer: { organizationId: targetTenantId } },
  })
  await prisma.customerOwner.deleteMany({
    where: { customer: { organizationId: targetTenantId } },
  })
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

  await prisma.messageDelivery.deleteMany({ where: { tenantId: targetTenantId } })
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
    where: { name: { startsWith: 'W343 Customer ' } },
    select: { id: true },
  })
  for (const row of stale) await cleanupTenant(row.id)
  if (stale.length) console.log(`  · 已清理 ${stale.length} 个历史 W3.4.3 客户 Smoke 租户`)
}

try {
  console.log('\nW3.4.3 task 4.2 客户 API + 360 Smoke')
  await cleanupStaleTenants()

  const adminPassword = 'Smoke123!'
  const registered = await jsonRequest('POST', '/auth/register', undefined, {
    tenantName: `W343 Customer ${suffix}`,
    name: 'W343 Admin',
    email: `w343-admin-${suffix}@smoke.local`,
    password: adminPassword,
  })
  check('注册临时管理员成功', registered.response.ok && !!registered.data?.accessToken)
  if (!registered.response.ok || !registered.data?.accessToken) {
    throw new Error(`注册失败: ${registered.response.status} ${JSON.stringify(registered.data)}`)
  }
  tenantId = registered.data.user.tenantId
  const adminId = registered.data.user.id
  const adminHeaders = { Authorization: `Bearer ${registered.data.accessToken}` }
  const rootDept = await prisma.department.findFirstOrThrow({ where: { tenantId, parentId: null } })

  const memberRole = await prisma.role.create({
    data: {
      tenantId,
      name: `W343 Customer Self ${suffix}`,
      permissions: ['customer:read', 'menu:opportunity', 'menu:contract', 'menu:order'],
      dataScope: 'SELF',
    },
  })
  const memberPassword = 'Member123!'
  const member = await prisma.user.create({
    data: {
      tenantId,
      email: `w343-member-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(memberPassword, 10),
      name: 'W343 Member',
      deptId: rootDept.id,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: memberRole.id } },
    },
  })
  const target = await prisma.user.create({
    data: {
      tenantId,
      email: `w343-target-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(memberPassword, 10),
      name: 'W343 Target',
      deptId: rootDept.id,
      status: 'ACTIVE',
    },
  })

  const form = await jsonRequest('GET', '/account/module/form', adminHeaders)
  check('/account/module/form 返回真实客户表单', form.response.ok && Array.isArray(form.data?.fields))

  const customerName = `W343 Customer Main ${suffix}`
  const created = await jsonRequest('POST', '/account/add', adminHeaders, { name: customerName })
  check('/account/add 创建普通客户', created.response.ok && created.data?.name === customerName)
  const customerId = created.data?.id
  if (!customerId) throw new Error('客户创建后缺少 id')

  const page = await jsonRequest('POST', '/account/page', adminHeaders, {
    current: 1,
    pageSize: 20,
    keyword: customerName,
  })
  check(
    '/account/page 使用 Cordys Pager 契约',
    page.response.ok && page.data?.current === 1 && page.data?.list?.[0]?.id === customerId,
    JSON.stringify(page.data),
  )

  const template = await fetch(`${base}/account/template/download?importType=ADD`, {
    headers: adminHeaders,
  })
  check(
    '/account/template/download 返回真实 xlsx 模板',
    template.ok && (template.headers.get('content-type') ?? '').includes('spreadsheetml'),
  )

  const exported = await jsonRequest('POST', '/account/export-all', adminHeaders, {
    current: 1,
    pageSize: 20,
    keyword: customerName,
    fileName: `w343-customer-${suffix}`,
    headList: ['name'],
  })
  check(
    '/account/export-all 创建真实导出任务',
    exported.response.ok && exported.data?.status === 'SUCCESS' && exported.data?.rowCount === 1,
    JSON.stringify(exported.data),
  )

  const categoryField = form.data?.fields?.find((field) => field.id)
  if (categoryField?.id) {
    const chart = await jsonRequest('POST', '/account/chart', adminHeaders, {
      chartConfig: {
        categoryAxis: { fieldId: categoryField.id },
        valueAxis: { aggregateMethod: 'COUNT' },
      },
    })
    check('/account/chart 基于真实客户字段聚合', chart.response.ok && Array.isArray(chart.data))
  }

  const option = await jsonRequest('POST', '/account/option', adminHeaders, {
    current: 1,
    pageSize: 20,
    keyword: customerName,
  })
  check('/account/option 为 POST 且返回客户候选', option.response.ok && option.data?.list?.[0]?.id === customerId)

  const transferred = await jsonRequest('POST', '/account/batch/transfer', adminHeaders, {
    ids: [customerId],
    owner: member.id,
  })
  check('/account/batch/transfer 转移客户', transferred.response.ok && transferred.data?.count === 1)

  const stage = await prisma.opportunityStage.create({
    data: { tenantId, name: `W343 Stage ${suffix}`, probability: 10 },
  })
  await prisma.opportunity.createMany({
    data: [
      {
        tenantId,
        name: `Visible Opportunity ${suffix}`,
        customerId,
        stageId: stage.id,
        amount: 100,
        ownerId: member.id,
        deptId: rootDept.id,
      },
      {
        tenantId,
        name: `Hidden Opportunity ${suffix}`,
        customerId,
        stageId: stage.id,
        amount: 900,
        ownerId: adminId,
        deptId: rootDept.id,
      },
    ],
  })
  const visibleContract = await prisma.contract.create({
    data: {
      tenantId,
      code: `W343-C-V-${suffix}`,
      name: `Visible Contract ${suffix}`,
      customerId,
      amount: 200,
      ownerId: member.id,
      deptId: rootDept.id,
    },
  })
  const hiddenContract = await prisma.contract.create({
    data: {
      tenantId,
      code: `W343-C-H-${suffix}`,
      name: `Hidden Contract ${suffix}`,
      customerId,
      amount: 800,
      ownerId: adminId,
      deptId: rootDept.id,
    },
  })
  const visiblePlan = await prisma.receivablePlan.create({
    data: { tenantId, contractId: visibleContract.id, period: 1, amount: 120, dueDate: new Date() },
  })
  const hiddenPlan = await prisma.receivablePlan.create({
    data: { tenantId, contractId: hiddenContract.id, period: 1, amount: 720, dueDate: new Date() },
  })
  await prisma.receivableRecord.createMany({
    data: [
      {
        tenantId,
        contractId: visibleContract.id,
        planId: visiblePlan.id,
        amount: 50,
        receivedAt: new Date(),
        ownerId: member.id,
        deptId: rootDept.id,
      },
      {
        tenantId,
        contractId: hiddenContract.id,
        planId: hiddenPlan.id,
        amount: 500,
        receivedAt: new Date(),
        ownerId: adminId,
        deptId: rootDept.id,
      },
    ],
  })
  await prisma.invoiceRecord.createMany({
    data: [
      { tenantId, contractId: visibleContract.id, amount: 80, ownerId: member.id },
      { tenantId, contractId: hiddenContract.id, amount: 700, ownerId: adminId },
    ],
  })
  await prisma.order.createMany({
    data: [
      {
        tenantId,
        code: `W343-O-V-${suffix}`,
        name: `Visible Order ${suffix}`,
        contractId: visibleContract.id,
        amount: 60,
        ownerId: member.id,
        deptId: rootDept.id,
      },
      {
        tenantId,
        code: `W343-O-H-${suffix}`,
        name: `Hidden Order ${suffix}`,
        contractId: hiddenContract.id,
        amount: 600,
        ownerId: adminId,
        deptId: rootDept.id,
      },
    ],
  })

  const memberHeaders = await login(member.email, memberPassword)
  for (const [label, path] of [
    ['商机', '/account/opportunity/page'],
    ['合同', '/account/contract/page'],
    ['回款计划', '/account/contract/payment-plan/page'],
    ['回款记录', '/account/contract/payment-record/page'],
    ['发票', '/account/invoice/page'],
    ['订单', '/account/order/page'],
  ]) {
    const result = await jsonRequest('POST', path, memberHeaders, {
      accountId: customerId,
      current: 1,
      pageSize: 20,
    })
    check(
      `客户 360 ${label}叠加关联模块 SELF DataScope`,
      result.response.ok && result.data?.total === 1 && result.data?.list?.length === 1,
      `${result.response.status} ${JSON.stringify(result.data)}`,
    )
  }

  const contractStatistic = await jsonRequest(
    'GET',
    `/account/contract/statistic/${customerId}`,
    memberHeaders,
  )
  const planStatistic = await jsonRequest(
    'GET',
    `/account/contract/payment-plan/statistic/${customerId}`,
    memberHeaders,
  )
  const recordStatistic = await jsonRequest(
    'GET',
    `/account/contract/payment-record/statistic/${customerId}`,
    memberHeaders,
  )
  const invoiceStatistic = await jsonRequest(
    'GET',
    `/account/invoice/statistic/${customerId}`,
    memberHeaders,
  )
  check('合同统计按 DataScope 裁剪', contractStatistic.data?.totalAmount === 200)
  check('回款计划统计按合同 DataScope 裁剪', planStatistic.data?.totalPlanAmount === 120)
  check(
    '回款记录统计按合同 DataScope 裁剪',
    recordStatistic.data?.totalAmount === 200 && recordStatistic.data?.receivedAmount === 50,
  )
  check(
    '发票统计按合同 DataScope 裁剪',
    invoiceStatistic.data?.contractAmount === 200 && invoiceStatistic.data?.invoicedAmount === 80,
  )

  const now = BigInt(Date.now())
  const contact = await prisma.customerContact.create({
    data: {
      customerId,
      name: `Transfer Contact ${suffix}`,
      owner: member.id,
      createTime: now,
      updateTime: now,
      createUser: adminId,
      updateUser: adminId,
      organizationId: tenantId,
      enable: true,
    },
  })
  const update = await jsonRequest('POST', '/account/update', adminHeaders, {
    id: customerId,
    name: `${customerName} Updated`,
    owner: target.id,
  })
  const [updatedCustomer, updatedContact, ownerHistory] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.customerContact.findUnique({ where: { id: contact.id } }),
    prisma.customerOwner.findFirst({ where: { customerId, owner: member.id } }),
  ])
  check(
    '/account/update 同事务维护负责人、联系人和 Owner History',
    update.response.ok &&
      updatedCustomer?.owner === target.id &&
      updatedCustomer?.name.endsWith('Updated') &&
      updatedContact?.owner === target.id &&
      !!ownerHistory,
    JSON.stringify(update.data),
  )

  const disposable = await jsonRequest('POST', '/account/add', adminHeaders, {
    name: `W343 Delete ${suffix}`,
  })
  const disposableId = disposable.data?.id
  if (!disposableId) throw new Error('删除链路测试客户创建失败')
  await prisma.customerField.create({
    data: { resourceId: disposableId, fieldId: `field-${suffix}`, fieldValue: 'value' },
  })
  await prisma.customerFieldBlob.create({
    data: { resourceId: disposableId, fieldId: `blob-${suffix}`, fieldValue: 'blob-value' },
  })
  await prisma.followUpPlan.create({
    data: {
      tenantId,
      targetType: 'customer',
      targetId: disposableId,
      content: 'delete smoke',
      ownerId: adminId,
      createdById: adminId,
    },
  })
  const deleted = await jsonRequest('GET', `/account/delete/${disposableId}`, adminHeaders)
  const [deletedCustomer, fieldCount, blobCount, planCount] = await Promise.all([
    prisma.customer.findUnique({ where: { id: disposableId } }),
    prisma.customerField.count({ where: { resourceId: disposableId } }),
    prisma.customerFieldBlob.count({ where: { resourceId: disposableId } }),
    prisma.followUpPlan.count({ where: { tenantId, targetType: 'customer', targetId: disposableId } }),
  ])
  check(
    '/account/delete 同事务清理客户动态字段、Blob 和跟进计划',
    deleted.response.ok && deletedCustomer === null && fieldCount === 0 && blobCount === 0 && planCount === 0,
  )

  const oldController = await jsonRequest('GET', '/customers', adminHeaders)
  check('旧 /api/customers Controller 已删除并返回 404', oldController.response.status === 404)
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

console.log(`\nW3.4.3 task 4.2 客户 API + 360 Smoke：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
