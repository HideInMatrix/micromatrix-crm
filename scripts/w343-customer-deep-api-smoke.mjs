/**
 * W3.4.3 / task 4.4 客户协作、关系与合并 Smoke。
 * 前置：API 已启动，当前 Prisma migration 已应用，apps/api dist 已生成 Prisma Client。
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
  if (!line) throw new Error('W3.4.3 task 4.4 Smoke 需要 DATABASE_URL')
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
    // empty response
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
  await prisma.order.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.invoiceRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.invoiceTitle.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.receivableRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.receivablePlan.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.contractItem.deleteMany({ where: { contract: { tenantId: targetTenantId } } })
  await prisma.contract.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.quoteItem.deleteMany({ where: { quote: { tenantId: targetTenantId } } })
  await prisma.quote.deleteMany({ where: { tenantId: targetTenantId } })
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
    where: { name: { startsWith: 'W343 Deep ' } },
    select: { id: true },
  })
  for (const row of stale) await cleanupTenant(row.id)
  if (stale.length) console.log(`  · 已清理 ${stale.length} 个历史 W3.4.3 task 4.4 Smoke 租户`)
}

async function createUser(rootDeptId, name, password, rolePermissions, dataScope = 'SELF') {
  const role = await prisma.role.create({
    data: {
      tenantId,
      name: `${name} Role ${suffix}`,
      permissions: rolePermissions,
      dataScope,
    },
  })
  const email = `${name.toLowerCase().replace(/\s+/g, '-')}-${suffix}@smoke.local`
  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      name,
      deptId: rootDeptId,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: role.id } },
    },
  })
  return { user, email, headers: await login(email, password) }
}

async function addCustomer(headers, name, owner) {
  const result = await jsonRequest('POST', '/account/add', headers, {
    name,
    ...(owner ? { owner } : {}),
  })
  if (!result.response.ok || !result.data?.id) {
    throw new Error(`创建客户失败 ${name}: ${result.response.status} ${JSON.stringify(result.data)}`)
  }
  return result.data
}

try {
  console.log('\nW3.4.3 task 4.4 客户协作 / 关系 / 合并 Smoke')
  await cleanupStaleTenants()

  const adminPassword = 'Smoke123!'
  const registered = await jsonRequest('POST', '/auth/register', undefined, {
    tenantName: `W343 Deep ${suffix}`,
    name: 'W343 Deep Admin',
    email: `w343-deep-admin-${suffix}@smoke.local`,
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

  const customerPermissions = ['customer:read', 'customer:update', 'customer:merge', 'contact:read', 'contact:create', 'contact:update']
  const password = 'Member123!'
  const collaborator = await createUser(rootDept.id, 'Deep Collaborator', password, customerPermissions)
  const readOnly = await createUser(rootDept.id, 'Deep Readonly', password, customerPermissions)
  const ownerA = await createUser(rootDept.id, 'Deep Owner A', password, customerPermissions)
  const ownerB = await createUser(rootDept.id, 'Deep Owner B', password, customerPermissions)
  const inheritedMember = await createUser(rootDept.id, 'Deep Inherited', password, customerPermissions)

  // ===== 协作 =====
  const collaborationCustomer = await addCustomer(adminHeaders, `协作客户-${suffix}`)
  const collaborationAdd = await jsonRequest('POST', '/account/collaboration/add', adminHeaders, {
    customerId: collaborationCustomer.id,
    userId: collaborator.user.id,
    collaborationType: 'COLLABORATION',
  })
  check('客户负责人可新增 COLLABORATION 协作人', collaborationAdd.response.ok)

  const duplicateCollaboration = await jsonRequest('POST', '/account/collaboration/add', adminHeaders, {
    customerId: collaborationCustomer.id,
    userId: collaborator.user.id,
    collaborationType: 'READ_ONLY',
  })
  check('同一客户与用户不能重复建立协作关系', !duplicateCollaboration.response.ok)

  const collaborationList = await jsonRequest(
    'GET',
    `/account/collaboration/list/${collaborationCustomer.id}`,
    adminHeaders,
  )
  const collaborationRow = collaborationList.data?.find?.((item) => item.userId === collaborator.user.id)
  check('客户数据范围内可读取协作列表', collaborationList.response.ok && !!collaborationRow?.id)

  const collaboratorList = await jsonRequest(
    'GET',
    `/account/collaboration/list/${collaborationCustomer.id}`,
    collaborator.headers,
  )
  check('COLLABORATION 关系不能越权进入协作管理列表', !collaboratorList.response.ok)

  const relationByCollaborator = await jsonRequest(
    'POST',
    `/account/relation/save/${collaborationCustomer.id}`,
    collaborator.headers,
    [],
  )
  check('COLLABORATION 关系不能越权维护客户关系', !relationByCollaborator.response.ok)

  const collaborationUpdate = await jsonRequest('POST', '/account/collaboration/update', adminHeaders, {
    id: collaborationRow.id,
    collaborationType: 'READ_ONLY',
  })
  check('协作类型可在 COLLABORATION/READ_ONLY 间更新', collaborationUpdate.response.ok)

  const secondCollaboration = await jsonRequest('POST', '/account/collaboration/add', adminHeaders, {
    customerId: collaborationCustomer.id,
    userId: readOnly.user.id,
    collaborationType: 'READ_ONLY',
  })
  const currentCollaborations = await jsonRequest(
    'GET',
    `/account/collaboration/list/${collaborationCustomer.id}`,
    adminHeaders,
  )
  const removeIds = currentCollaborations.data.map((item) => item.id)
  const collaborationBatchDelete = await jsonRequest(
    'POST',
    '/account/collaboration/batch/delete',
    adminHeaders,
    removeIds,
  )
  check(
    '协作关系支持 CUSTOMER UPDATE 批量删除',
    secondCollaboration.response.ok && collaborationBatchDelete.response.ok && collaborationBatchDelete.data?.count === 2,
  )

  // ===== 客户关系 =====
  const relationRoot = await addCustomer(adminHeaders, `关系主体-${suffix}`)
  const relationGroup = await addCustomer(adminHeaders, `关系集团-${suffix}`)
  const subsidiaries = []
  for (let index = 0; index < 11; index += 1) {
    subsidiaries.push(await addCustomer(adminHeaders, `关系子公司-${index}-${suffix}`))
  }
  const validRelations = [
    { relationType: 'GROUP', customerId: relationGroup.id },
    ...subsidiaries.slice(0, 10).map((item) => ({ relationType: 'SUBSIDIARY', customerId: item.id })),
  ]
  const replaceRelations = await jsonRequest(
    'POST',
    `/account/relation/save/${relationRoot.id}`,
    adminHeaders,
    validRelations,
  )
  check('客户关系允许 1 个集团 + 10 个子公司', replaceRelations.response.ok)

  const elevenSubsidiaries = await jsonRequest(
    'POST',
    `/account/relation/save/${relationRoot.id}`,
    adminHeaders,
    subsidiaries.map((item) => ({ relationType: 'SUBSIDIARY', customerId: item.id })),
  )
  check('客户关系后端拒绝 11 个子公司', !elevenSubsidiaries.response.ok)

  const duplicateRelation = await jsonRequest(
    'POST',
    `/account/relation/save/${relationRoot.id}`,
    adminHeaders,
    [
      { relationType: 'SUBSIDIARY', customerId: subsidiaries[0].id },
      { relationType: 'SUBSIDIARY', customerId: subsidiaries[0].id },
    ],
  )
  check('客户关系后端拒绝重复客户', !duplicateRelation.response.ok)

  const cycleA = await addCustomer(adminHeaders, `循环A-${suffix}`)
  const cycleB = await addCustomer(adminHeaders, `循环B-${suffix}`)
  const cycleC = await addCustomer(adminHeaders, `循环C-${suffix}`)
  await jsonRequest('POST', `/account/relation/save/${cycleA.id}`, adminHeaders, [
    { relationType: 'SUBSIDIARY', customerId: cycleB.id },
  ])
  await jsonRequest('POST', `/account/relation/save/${cycleB.id}`, adminHeaders, [
    { relationType: 'GROUP', customerId: cycleA.id },
    { relationType: 'SUBSIDIARY', customerId: cycleC.id },
  ])
  const cycleAttempt = await jsonRequest('POST', `/account/relation/save/${cycleC.id}`, adminHeaders, [
    { relationType: 'GROUP', customerId: cycleB.id },
    { relationType: 'SUBSIDIARY', customerId: cycleA.id },
  ])
  check('客户关系后端拒绝形成集团环', !cycleAttempt.response.ok)

  const rollbackAttempt = await jsonRequest('POST', `/account/relation/save/${cycleA.id}`, adminHeaders, [
    { relationType: 'SUBSIDIARY', customerId: cycleB.id },
    { relationType: 'SUBSIDIARY', customerId: cycleA.id },
  ])
  const cycleARelationsAfterFailure = await jsonRequest(
    'GET',
    `/account/relation/list/${cycleA.id}`,
    adminHeaders,
  )
  check(
    '客户关系整组保存失败时保留原关系',
    !rollbackAttempt.response.ok &&
      cycleARelationsAfterFailure.data?.length === 1 &&
      cycleARelationsAfterFailure.data[0]?.customerId === cycleB.id,
  )

  // ===== 合并 =====
  const contactForm = await jsonRequest('GET', '/account/contact/module/form', adminHeaders)
  const contactNameField = contactForm.data?.fields?.find((field) => field.key === 'name')
  const contactPhoneField = contactForm.data?.fields?.find((field) => field.key === 'phone')
  if (!contactNameField?.id || !contactPhoneField?.id) throw new Error('联系人姓名/电话系统字段不存在')

  for (const field of [contactNameField, contactPhoneField]) {
    await jsonRequest('PATCH', `/metadata/fields/${field.id}`, adminHeaders, {
      config: { ...(field.config ?? {}), unique: false },
    })
  }

  const mergeTarget = await addCustomer(adminHeaders, `合并主客户-${suffix}`, adminId)
  const mergeSourceA = await addCustomer(adminHeaders, `合并源A-${suffix}`, ownerA.user.id)
  const mergeSourceB = await addCustomer(adminHeaders, `合并源B-${suffix}`, ownerB.user.id)

  const duplicateName = `合并重复联系人-${suffix}`
  const duplicatePhone = `139${Date.now().toString().slice(-8)}`
  const targetContact = await jsonRequest('POST', '/account/contact/add', adminHeaders, {
    customerId: mergeTarget.id,
    ownerId: adminId,
    name: duplicateName,
    phone: duplicatePhone,
  })
  const sourceDuplicateContact = await jsonRequest('POST', '/account/contact/add', adminHeaders, {
    customerId: mergeSourceA.id,
    ownerId: ownerA.user.id,
    name: duplicateName,
    phone: duplicatePhone,
  })
  const sourceUniqueContact = await jsonRequest('POST', '/account/contact/add', adminHeaders, {
    customerId: mergeSourceA.id,
    ownerId: ownerA.user.id,
    name: `合并唯一联系人-${suffix}`,
    phone: `137${Date.now().toString().slice(-8)}`,
  })
  check(
    '合并前可构造历史重复联系人数据',
    targetContact.response.ok && sourceDuplicateContact.response.ok && sourceUniqueContact.response.ok,
  )

  for (const field of [contactNameField, contactPhoneField]) {
    const uniqueEnabled = await jsonRequest('PATCH', `/metadata/fields/${field.id}`, adminHeaders, {
      config: { ...(field.config ?? {}), unique: true },
    })
    if (!uniqueEnabled.response.ok) {
      throw new Error(`启用联系人唯一规则失败: ${JSON.stringify(uniqueEnabled.data)}`)
    }
  }

  const stage = await prisma.opportunityStage.create({
    data: {
      tenantId,
      name: `合并阶段-${suffix}`,
      probability: 20,
      sort: 1,
    },
  })
  const opportunity = await prisma.opportunity.create({
    data: {
      tenantId,
      name: `合并商机-${suffix}`,
      customerId: mergeSourceA.id,
      contactId: sourceDuplicateContact.data.id,
      stageId: stage.id,
      ownerId: ownerA.user.id,
      deptId: rootDept.id,
    },
  })
  const followUpPlan = await prisma.followUpPlan.create({
    data: {
      tenantId,
      targetType: 'customer',
      targetId: mergeSourceA.id,
      contactId: sourceDuplicateContact.data.id,
      content: `合并计划-${suffix}`,
      ownerId: ownerA.user.id,
      deptId: rootDept.id,
      createdById: adminId,
    },
  })
  const followUpRecord = await prisma.followUpRecord.create({
    data: {
      tenantId,
      targetType: 'customer',
      targetId: mergeSourceA.id,
      type: '电话',
      content: `合并记录-${suffix}`,
      ownerId: ownerA.user.id,
      ownerName: ownerA.user.name,
    },
  })
  const quote = await prisma.quote.create({
    data: {
      tenantId,
      code: `Q-${suffix}`,
      name: `合并报价-${suffix}`,
      customerId: mergeSourceA.id,
      ownerId: ownerA.user.id,
    },
  })
  const contract = await prisma.contract.create({
    data: {
      tenantId,
      code: `C-${suffix}`,
      name: `合并合同-${suffix}`,
      customerId: mergeSourceB.id,
      ownerId: ownerB.user.id,
    },
  })
  const invoiceTitle = await prisma.invoiceTitle.create({
    data: {
      tenantId,
      customerId: mergeSourceA.id,
      name: `合并抬头-${suffix}`,
      taxNo: `TAX-${suffix}`,
    },
  })

  await jsonRequest('POST', '/account/collaboration/add', adminHeaders, {
    customerId: mergeSourceA.id,
    userId: inheritedMember.user.id,
    collaborationType: 'READ_ONLY',
  })
  const mergeRelationGroup = await addCustomer(adminHeaders, `合并关系集团-${suffix}`)
  await jsonRequest('POST', `/account/relation/save/${mergeSourceA.id}`, adminHeaders, [
    { relationType: 'GROUP', customerId: mergeRelationGroup.id },
  ])

  const mergePayload = {
    mergeIds: [mergeTarget.id, mergeSourceA.id, mergeSourceB.id],
    toMergeId: mergeTarget.id,
    ownerId: ownerB.user.id,
  }
  const mergePreview = await jsonRequest('POST', '/account/merge/preview', adminHeaders, mergePayload)
  check(
    '合并 preview 按联系人 unique 规则自动识别去重',
    mergePreview.response.ok &&
      mergePreview.data?.counts?.customersToDelete === 2 &&
      mergePreview.data?.counts?.contactsWillSkip === 1 &&
      mergePreview.data?.contactConflicts?.length === 1,
  )
  check(
    '合并 preview 计入 FollowUpPlan',
    mergePreview.data?.counts?.followUpPlans === 1,
  )

  const mergeResult = await jsonRequest('POST', '/account/merge', adminHeaders, mergePayload)
  check('客户合并使用 mergeIds/toMergeId/ownerId 三字段成功执行', mergeResult.response.ok && mergeResult.data?.merged === 2)

  const [sourceAAfter, sourceBAfter, targetAfter] = await Promise.all([
    prisma.customer.findUnique({ where: { id: mergeSourceA.id } }),
    prisma.customer.findUnique({ where: { id: mergeSourceB.id } }),
    prisma.customer.findUnique({ where: { id: mergeTarget.id } }),
  ])
  check('合并后源客户删除且主客户保留', !sourceAAfter && !sourceBAfter && targetAfter?.id === mergeTarget.id)
  check('合并后主客户负责人切换为选中客户负责人', targetAfter?.owner === ownerB.user.id)

  const [targetContactAfter, sourceDuplicateAfter, sourceUniqueAfter] = await Promise.all([
    prisma.customerContact.findUnique({ where: { id: targetContact.data.id } }),
    prisma.customerContact.findUnique({ where: { id: sourceDuplicateContact.data.id } }),
    prisma.customerContact.findUnique({ where: { id: sourceUniqueContact.data.id } }),
  ])
  check(
    '唯一冲突联系人自动去重且普通源联系人迁入主客户',
    targetContactAfter?.customerId === mergeTarget.id &&
      !sourceDuplicateAfter &&
      sourceUniqueAfter?.customerId === mergeTarget.id,
  )
  check('主客户旧负责人名下联系人同步切换最终负责人', targetContactAfter?.owner === ownerB.user.id)

  const [opportunityAfter, planAfter, recordAfter, quoteAfter, contractAfter, invoiceTitleAfter] = await Promise.all([
    prisma.opportunity.findUnique({ where: { id: opportunity.id } }),
    prisma.followUpPlan.findUnique({ where: { id: followUpPlan.id } }),
    prisma.followUpRecord.findUnique({ where: { id: followUpRecord.id } }),
    prisma.quote.findUnique({ where: { id: quote.id } }),
    prisma.contract.findUnique({ where: { id: contract.id } }),
    prisma.invoiceTitle.findUnique({ where: { id: invoiceTitle.id } }),
  ])
  check(
    '重复联系人被删前商机 contactId 转挂主联系人',
    opportunityAfter?.customerId === mergeTarget.id && opportunityAfter?.contactId === targetContact.data.id,
  )
  check(
    'FollowUpPlan 同步迁主客户并转挂重复联系人引用',
    planAfter?.targetId === mergeTarget.id && planAfter?.contactId === targetContact.data.id,
  )
  check('跟进记录迁移到主客户', recordAfter?.targetId === mergeTarget.id)
  check(
    'MicroMatrix 直接 Customer FK 资源同步迁移',
    quoteAfter?.customerId === mergeTarget.id &&
      contractAfter?.customerId === mergeTarget.id &&
      invoiceTitleAfter?.customerId === mergeTarget.id,
  )

  const targetCollaborations = await prisma.customerCollaboration.findMany({
    where: { customerId: mergeTarget.id },
  })
  check(
    '源负责人和源协作人继承为主客户协作人并排除最终负责人',
    targetCollaborations.some(
      (item) => item.userId === ownerA.user.id && item.collaborationType === 'COLLABORATION',
    ) &&
      targetCollaborations.some(
        (item) => item.userId === inheritedMember.user.id && item.collaborationType === 'READ_ONLY',
      ) &&
      !targetCollaborations.some((item) => item.userId === ownerB.user.id),
  )
  const sourceRelationCount = await prisma.customerRelation.count({
    where: {
      OR: [
        { sourceCustomerId: { in: [mergeSourceA.id, mergeSourceB.id] } },
        { targetCustomerId: { in: [mergeSourceA.id, mergeSourceB.id] } },
      ],
    },
  })
  check('被合并客户的集团/子公司关系全部清理', sourceRelationCount === 0)

  const ownerHistory = await prisma.customerOwner.findFirst({
    where: { customerId: mergeTarget.id, owner: adminId },
  })
  check('主客户负责人变化写入 Owner History', !!ownerHistory)

  const rollbackTarget = await addCustomer(adminHeaders, `回滚主客户-${suffix}`)
  const rollbackSource = await addCustomer(adminHeaders, `回滚源客户-${suffix}`, ownerA.user.id)
  const invalidMerge = await jsonRequest('POST', '/account/merge', adminHeaders, {
    mergeIds: [rollbackTarget.id, rollbackSource.id],
    toMergeId: rollbackTarget.id,
    ownerId: inheritedMember.user.id,
  })
  const rollbackCustomers = await prisma.customer.count({
    where: { id: { in: [rollbackTarget.id, rollbackSource.id] }, organizationId: tenantId },
  })
  check('合并负责人规则失败时不产生部分删除', !invalidMerge.response.ok && rollbackCustomers === 2)

  const collaboratorOwnedCustomer = await addCustomer(
    adminHeaders,
    `协作人自有客户-${suffix}`,
    collaborator.user.id,
  )
  await jsonRequest('POST', '/account/collaboration/add', adminHeaders, {
    customerId: collaborationCustomer.id,
    userId: collaborator.user.id,
    collaborationType: 'COLLABORATION',
  })
  const collaboratorMerge = await jsonRequest('POST', '/account/merge', collaborator.headers, {
    mergeIds: [collaboratorOwnedCustomer.id, collaborationCustomer.id],
    toMergeId: collaboratorOwnedCustomer.id,
    ownerId: collaborator.user.id,
  })
  check('COLLABORATION 关系不能把无 DataScope 客户带入合并', !collaboratorMerge.response.ok)
} finally {
  if (tenantId) await cleanupTenant(tenantId).catch((error) => console.error('清理 Smoke 租户失败', error))
  await prisma.$disconnect()
  console.log(`\nW3.4.3 task 4.4 Smoke：${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}
