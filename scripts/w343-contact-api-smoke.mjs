/**
 * W3.4.3 / task 4.3 联系人 API Smoke。
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
  if (!line) throw new Error('W3.4.3 联系人 Smoke 需要 DATABASE_URL')
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
  await prisma.followUpPlan.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.attachment.deleteMany({ where: { tenantId: targetTenantId } })

  await prisma.customerContact.deleteMany({ where: { organizationId: targetTenantId } })
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
    where: { name: { startsWith: 'W343 Contact ' } },
    select: { id: true },
  })
  for (const row of stale) await cleanupTenant(row.id)
  if (stale.length) console.log(`  · 已清理 ${stale.length} 个历史 W3.4.3 联系人 Smoke 租户`)
}

try {
  console.log('\nW3.4.3 task 4.3 联系人 API Smoke')
  await cleanupStaleTenants()

  const password = 'Smoke123!'
  const registered = await jsonRequest('POST', '/auth/register', undefined, {
    tenantName: `W343 Contact ${suffix}`,
    name: 'W343 Contact Admin',
    email: `w343-contact-admin-${suffix}@smoke.local`,
    password,
  })
  check('注册临时管理员成功', registered.response.ok && !!registered.data?.accessToken)
  if (!registered.response.ok || !registered.data?.accessToken) {
    throw new Error(`注册失败: ${registered.response.status} ${JSON.stringify(registered.data)}`)
  }
  tenantId = registered.data.user.tenantId
  const adminId = registered.data.user.id
  const adminHeaders = { Authorization: `Bearer ${registered.data.accessToken}` }
  const rootDept = await prisma.department.findFirstOrThrow({ where: { tenantId, parentId: null } })

  const positionFieldResult = await jsonRequest('POST', '/metadata/contact/fields', adminHeaders, {
    label: `职位-${suffix}`,
    type: 'text',
    showInList: true,
    config: { unique: true },
  })
  const notesFieldResult = await jsonRequest('POST', '/metadata/contact/fields', adminHeaders, {
    label: `备注-${suffix}`,
    type: 'textarea',
  })
  const positionField = positionFieldResult.data
  const notesField = notesFieldResult.data
  check('联系人动态字段可创建普通值与 Blob 字段', !!positionField?.id && !!notesField?.id)

  const moduleForm = await jsonRequest('GET', '/account/contact/module/form', adminHeaders)
  check(
    '/account/contact/module/form 返回真实表单',
    moduleForm.response.ok &&
      moduleForm.data?.fields?.some((field) => field.id === positionField.id) &&
      moduleForm.data?.fields?.some((field) => field.id === notesField.id),
  )

  const orphanName = `W343 Orphan ${suffix}`
  const orphan = await jsonRequest('POST', '/account/contact/add', adminHeaders, {
    name: orphanName,
    phone: '13900000001',
    moduleFields: [
      { fieldId: positionField.id, fieldValue: '采购负责人' },
      { fieldId: notesField.id, fieldValue: '独立联系人允许不关联客户' },
    ],
  })
  const orphanRow = orphan.data?.id
    ? await prisma.customerContact.findUnique({ where: { id: orphan.data.id } })
    : null
  check(
    '/account/contact/add 允许 customerId 为空并保存动态字段',
    orphan.response.ok && orphanRow?.customerId === null && orphan.data?.customData?.[positionField.key] === '采购负责人',
    JSON.stringify(orphan.data),
  )

  const duplicateDynamic = await jsonRequest('POST', '/account/contact/add', adminHeaders, {
    name: `W343 Duplicate ${suffix}`,
    moduleFields: [{ fieldId: positionField.id, fieldValue: '采购负责人' }],
  })
  check(
    '联系人动态字段唯一规则在新增时强制执行',
    !duplicateDynamic.response.ok,
    `${duplicateDynamic.response.status} ${JSON.stringify(duplicateDynamic.data)}`,
  )

  const orphanPage = await jsonRequest('POST', '/account/contact/page', adminHeaders, {
    current: 1,
    pageSize: 20,
    keyword: orphanName,
    sort: { fieldId: 'name', direction: 'ASC' },
  })
  check(
    '/account/contact/page 使用 Cordys Pager 契约',
    orphanPage.response.ok &&
      Array.isArray(orphanPage.data?.list) &&
      orphanPage.data?.current === 1 &&
      orphanPage.data?.list?.[0]?.id === orphan.data?.id,
    JSON.stringify(orphanPage.data),
  )

  const customer = await jsonRequest('POST', '/account/add', adminHeaders, {
    name: `W343 Contact Customer ${suffix}`,
  })
  const customerId = customer.data?.id
  if (!customerId) throw new Error('创建客户失败')

  const memberRole = await prisma.role.create({
    data: {
      tenantId,
      name: `W343 Contact Self ${suffix}`,
      permissions: ['contact:read', 'contact:update', 'contact:delete', 'customer:read'],
      dataScope: 'SELF',
    },
  })
  const memberPassword = 'Member123!'
  const member = await prisma.user.create({
    data: {
      tenantId,
      email: `w343-contact-member-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(memberPassword, 10),
      name: 'W343 Contact Member',
      deptId: rootDept.id,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: memberRole.id } },
    },
  })
  const memberHeaders = await login(member.email, memberPassword)

  const memberContact = await jsonRequest('POST', '/account/contact/add', adminHeaders, {
    customerId,
    owner: member.id,
    name: `W343 Member Contact ${suffix}`,
    phone: '13900000002',
  })
  const adminContact = await jsonRequest('POST', '/account/contact/add', adminHeaders, {
    customerId,
    owner: adminId,
    name: `W343 Admin Contact ${suffix}`,
    phone: '13900000003',
  })
  check('客户下可创建不同负责人的联系人', memberContact.response.ok && adminContact.response.ok)

  const memberPage = await jsonRequest('POST', '/account/contact/page', memberHeaders, {
    current: 1,
    pageSize: 50,
  })
  check(
    '独立联系人页执行 CONTACT SELF DataScope',
    memberPage.response.ok &&
      memberPage.data?.list?.some((item) => item.id === memberContact.data?.id) &&
      !memberPage.data?.list?.some((item) => item.id === adminContact.data?.id) &&
      !memberPage.data?.list?.some((item) => item.id === orphan.data?.id),
  )

  await prisma.customerCollaboration.create({
    data: {
      customerId,
      userId: member.id,
      collaborationType: 'READ_ONLY',
      createTime: BigInt(Date.now()),
      updateTime: BigInt(Date.now()),
      createUser: adminId,
      updateUser: adminId,
    },
  })
  const readOnlyList = await jsonRequest(
    'GET',
    `/account/contact/list/${customerId}`,
    memberHeaders,
  )
  check(
    '客户 360 READ_ONLY 协作可只读查看客户联系人',
    readOnlyList.response.ok &&
      readOnlyList.data?.list?.some((item) => item.id === memberContact.data?.id) &&
      readOnlyList.data?.list?.some((item) => item.id === adminContact.data?.id),
  )

  await prisma.customerCollaboration.updateMany({
    where: { customerId, userId: member.id },
    data: { collaborationType: 'COLLABORATION', updateTime: BigInt(Date.now()) },
  })
  const collaborationList = await jsonRequest(
    'GET',
    `/account/contact/list/${customerId}`,
    memberHeaders,
  )
  check(
    '客户 360 COLLABORATION 仅返回协作人自己负责的联系人',
    collaborationList.response.ok &&
      collaborationList.data?.list?.length === 1 &&
      collaborationList.data?.list?.[0]?.id === memberContact.data?.id,
    JSON.stringify(collaborationList.data),
  )

  const disabled = await jsonRequest(
    'POST',
    `/account/contact/disable/${orphan.data?.id}`,
    adminHeaders,
    { reason: '离职' },
  )
  const disabledRow = await prisma.customerContact.findUnique({ where: { id: orphan.data.id } })
  check(
    '/account/contact/disable 保存停用原因',
    disabled.response.ok && disabledRow?.enable === false && disabledRow?.disableReason === '离职',
  )
  await jsonRequest('GET', `/account/contact/enable/${orphan.data?.id}`, adminHeaders)
  const enabledRow = await prisma.customerContact.findUnique({ where: { id: orphan.data.id } })
  check('/account/contact/enable 清空停用原因', enabledRow?.enable === true && enabledRow?.disableReason === null)

  const chart = await jsonRequest('POST', '/account/contact/chart', adminHeaders, {
    chartConfig: {
      categoryAxis: { fieldId: positionField.id },
      valueAxis: { aggregateMethod: 'COUNT' },
    },
  })
  check(
    '/account/contact/chart 基于真实联系人动态字段聚合',
    chart.response.ok &&
      Array.isArray(chart.data) &&
      chart.data.some((item) => item.categoryAxis === '采购负责人' && Number(item.valueAxis) === 1),
    JSON.stringify(chart.data),
  )

  const template = await fetch(`${base}/account/contact/template/download`, { headers: adminHeaders })
  check(
    '/account/contact/template/download 返回真实 xlsx',
    template.ok && (template.headers.get('content-type') ?? '').includes('spreadsheetml'),
  )

  const exported = await jsonRequest('POST', '/account/contact/export-all', adminHeaders, {
    current: 1,
    pageSize: 100,
    keyword: orphanName,
    fileName: `w343-contact-${suffix}`,
    headList: ['name', positionField.key],
  })
  check(
    '/account/contact/export-all 创建真实导出任务',
    exported.response.ok && exported.data?.status === 'SUCCESS' && exported.data?.rowCount === 1,
    JSON.stringify(exported.data),
  )

  const stage = await prisma.opportunityStage.create({
    data: { tenantId, name: `W343 Contact Stage ${suffix}`, probability: 10 },
  })
  await prisma.opportunity.create({
    data: {
      tenantId,
      name: `W343 Contact Opportunity ${suffix}`,
      customerId,
      contactId: adminContact.data.id,
      stageId: stage.id,
      ownerId: adminId,
      deptId: rootDept.id,
    },
  })
  const opportunityCheck = await jsonRequest(
    'GET',
    `/account/contact/opportunity/check/${adminContact.data.id}`,
    adminHeaders,
  )
  const blockedDelete = await jsonRequest(
    'GET',
    `/account/contact/delete/${adminContact.data.id}`,
    adminHeaders,
  )
  check(
    '商机关联检查返回 boolean 且后端强制拒删',
    opportunityCheck.response.ok &&
      opportunityCheck.data === true &&
      blockedDelete.response.status === 400 &&
      !!(await prisma.customerContact.findUnique({ where: { id: adminContact.data.id } })),
  )

  const deletable = await jsonRequest('POST', '/account/contact/add', adminHeaders, {
    name: `W343 Delete Contact ${suffix}`,
    moduleFields: [
      { fieldId: positionField.id, fieldValue: '待删除' },
      { fieldId: notesField.id, fieldValue: 'Blob 待删除' },
    ],
  })
  const deleteResult = await jsonRequest(
    'GET',
    `/account/contact/delete/${deletable.data.id}`,
    adminHeaders,
  )
  const [deletedContact, normalValues, blobValues] = await Promise.all([
    prisma.customerContact.findUnique({ where: { id: deletable.data.id } }),
    prisma.customerContactField.count({ where: { resourceId: deletable.data.id } }),
    prisma.customerContactFieldBlob.count({ where: { resourceId: deletable.data.id } }),
  ])
  check(
    '/account/contact/delete 同事务清理联系人及动态字段/Blob',
    deleteResult.response.ok && deletedContact === null && normalValues === 0 && blobValues === 0,
  )

  const oldPage = await jsonRequest('POST', '/contacts/page', adminHeaders, {
    page: 1,
    pageSize: 10,
  })
  check('旧 /api/contacts Controller 已移除并返回 404', oldPage.response.status === 404)
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

console.log(`\nW3.4.3 task 4.3 联系人 API Smoke：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
