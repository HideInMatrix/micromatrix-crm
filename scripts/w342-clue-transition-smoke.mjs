/**
 * W3.4.2 / task 3.3 三条线索转换链路 Smoke。
 * 前置：API 已启动，migration 已应用，API production build 已生成 Prisma Client。
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
let tenantId = ''
const suffix = Date.now().toString(36)
const id = () => randomUUID().replaceAll('-', '')

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
  if (!line) throw new Error('W3.4.2 转换 Smoke 需要 DATABASE_URL')
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
    // 部分 500 响应不保证 JSON body。
  }
  return { response, data }
}

async function cleanupTenant(targetTenantId) {
  if (!targetTenantId) return
  await prisma.messageDelivery.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.notification.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpPlan.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.followUpRecord.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.opportunity.deleteMany({ where: { tenantId: targetTenantId } })
  await prisma.opportunityStage.deleteMany({ where: { tenantId: targetTenantId } })
  const customerIds = (
    await prisma.customer.findMany({
      where: { organizationId: targetTenantId },
      select: { id: true },
    })
  ).map((item) => item.id)
  if (customerIds.length) {
    await prisma.customerCollaboration.deleteMany({ where: { customerId: { in: customerIds } } })
  }
  await prisma.customerContact.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.customer.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.customerCapacity.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.customerPool.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.clue.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.clueCapacity.deleteMany({ where: { organizationId: targetTenantId } })
  await prisma.cluePool.deleteMany({ where: { organizationId: targetTenantId } })

  const forms = await prisma.sysModuleForm.findMany({
    where: { organizationId: targetTenantId },
    select: { id: true },
  })
  const formIds = forms.map((form) => form.id)
  if (formIds.length) {
    const fieldIds = (
      await prisma.sysModuleField.findMany({
        where: { formId: { in: formIds } },
        select: { id: true },
      })
    ).map((field) => field.id)
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
  const stale = await prisma.tenant.findMany({
    where: { name: { startsWith: 'W342 Transition ' } },
    select: { id: true },
  })
  for (const tenant of stale) await cleanupTenant(tenant.id)
  if (stale.length) console.log(`  · 已清理 ${stale.length} 个历史转换 Smoke 租户`)
}

async function addLead(headers, input) {
  const result = await jsonRequest('POST', '/lead/add', headers, input)
  if (!result.response.ok || !result.data?.id) {
    throw new Error(`创建线索失败: ${result.response.status} ${JSON.stringify(result.data)}`)
  }
  return result.data
}

async function addFollowArtifacts({ leadId, ownerId, ownerName, marker, converted = true }) {
  const record = await prisma.followUpRecord.create({
    data: {
      tenantId,
      targetType: 'lead',
      targetId: leadId,
      type: '电话',
      content: `记录-${marker}`,
      ownerId,
      ownerName,
    },
  })
  const plan = await prisma.followUpPlan.create({
    data: {
      tenantId,
      targetType: 'lead',
      targetId: leadId,
      content: `计划-${marker}`,
      method: '电话',
      status: converted ? 'COMPLETED' : 'PREPARED',
      converted,
      convertedRecordId: converted ? record.id : null,
      ownerId,
      createdById: ownerId,
      customData: { marker, nested: { preserved: true } },
    },
  })
  return { record, plan }
}

try {
  console.log('\nW3.4.2 三条线索转换链路 Smoke')
  await cleanupStaleTenants()

  const registered = await jsonRequest('POST', '/auth/register', undefined, {
    tenantName: `W342 Transition ${suffix}`,
    name: 'W342 Admin',
    email: `w342-transition-${suffix}@smoke.local`,
    password: 'Smoke123!',
  })
  check('注册临时管理员成功', registered.response.ok && !!registered.data?.accessToken)
  if (!registered.response.ok || !registered.data?.accessToken) {
    throw new Error(`注册失败: ${registered.response.status} ${JSON.stringify(registered.data)}`)
  }
  tenantId = registered.data.user.tenantId
  const adminId = registered.data.user.id
  const headers = { Authorization: `Bearer ${registered.data.accessToken}` }
  const rootDept = await prisma.department.findFirstOrThrow({ where: { tenantId, parentId: null } })
  const salesId = id()
  await prisma.user.create({
    data: {
      id: salesId,
      tenantId,
      email: `w342-sales-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash('Sales123!', 10),
      name: 'W342 Sales',
      deptId: rootDept.id,
      status: 'ACTIVE',
    },
  })
  await prisma.opportunityStage.create({
    data: { id: id(), tenantId, name: `初始阶段 ${suffix}`, probability: 10, sort: 1 },
  })
  const customerFields = await jsonRequest('GET', '/metadata/customer/fields', headers)
  const customerNameField = customerFields.data?.find((field) => field.key === 'name')
  const contactFields = await jsonRequest('GET', '/metadata/contact/fields', headers)
  const contactNameField = contactFields.data?.find((field) => field.key === 'name')
  const contactPhoneField = contactFields.data?.find((field) => field.key === 'phone')
  for (const field of [customerNameField, contactNameField, contactPhoneField]) {
    if (!field?.id) throw new Error('未找到转换 Smoke 所需系统字段')
    const updated = await jsonRequest('PATCH', `/metadata/fields/${field.id}`, headers, {
      config: { ...(field.config ?? {}), unique: true },
    })
    if (!updated.response.ok) {
      throw new Error(`开启唯一规则失败: ${updated.response.status} ${JSON.stringify(updated.data)}`)
    }
  }
  check('Smoke 临时租户已显式开启客户名与联系人唯一规则', true)

  // 1. 自动转换：Customer + Contact + Opportunity + FollowUpRecord/Plan。
  const autoLead = await addLead(headers, {
    name: `自动转换 ${suffix}`,
    owner: salesId,
    contact: '自动联系人',
    phone: '13800001001',
  })
  const autoFollowTime = BigInt(Date.now() - 60_000)
  await prisma.clue.update({
    where: { id: autoLead.id },
    data: { follower: salesId, followTime: autoFollowTime },
  })
  const autoSource = await addFollowArtifacts({
    leadId: autoLead.id,
    ownerId: salesId,
    ownerName: 'W342 Sales',
    marker: 'transform',
  })
  const transformed = await jsonRequest('POST', '/lead/transform', headers, {
    clueId: autoLead.id,
    oppCreated: true,
    oppName: `转换商机 ${suffix}`,
  })
  check(
    '/lead/transform 同事务创建客户、联系人和商机',
    transformed.response.ok &&
      !!transformed.data?.customerId &&
      !!transformed.data?.contactId &&
      !!transformed.data?.opportunityId,
    JSON.stringify(transformed.data),
  )
  const autoClue = await prisma.clue.findUniqueOrThrow({ where: { id: autoLead.id } })
  const autoCustomer = await prisma.customer.findUniqueOrThrow({
    where: { id: transformed.data.customerId },
  })
  const autoOpportunity = await prisma.opportunity.findUniqueOrThrow({
    where: { id: transformed.data.opportunityId },
  })
  check(
    '自动转换使用 transitionType + transitionId 记录事实',
    autoClue.transitionType === 'CUSTOMER' && autoClue.transitionId === transformed.data.customerId,
  )
  check(
    '自动转换刷新客户 follower/followTime 与商机最近跟进',
    autoCustomer.follower === salesId &&
      autoCustomer.followTime === autoFollowTime &&
      autoOpportunity.lastFollowedAt?.getTime() === Number(autoFollowTime),
  )
  const copiedRecord = await prisma.followUpRecord.findFirst({
    where: {
      tenantId,
      targetType: 'customer',
      targetId: transformed.data.customerId,
      content: '记录-transform',
    },
  })
  const copiedPlan = await prisma.followUpPlan.findFirst({
    where: {
      tenantId,
      targetType: 'customer',
      targetId: transformed.data.customerId,
      content: '计划-transform',
    },
  })
  check('自动转换复制 FollowUpRecord 与 FollowUpPlan', !!copiedRecord && !!copiedPlan)
  check(
    'FollowUpPlan 保留 customData 并映射 convertedRecordId/contactId',
    copiedPlan?.converted === true &&
      copiedPlan?.convertedRecordId === copiedRecord?.id &&
      copiedPlan?.convertedRecordId !== autoSource.record.id &&
      copiedPlan?.contactId === transformed.data.contactId &&
      copiedPlan?.customData?.marker === 'transform' &&
      !Object.prototype.hasOwnProperty.call(copiedPlan?.customData ?? {}, 'opportunityId'),
    JSON.stringify(copiedPlan?.customData),
  )
  check(
    '转换后原线索 FollowUpRecord/Plan 仍保留',
    !!(await prisma.followUpRecord.findUnique({ where: { id: autoSource.record.id } })) &&
      !!(await prisma.followUpPlan.findUnique({ where: { id: autoSource.plan.id } })),
  )
  check(
    '客户/商机转换通知在事务提交后发送给线索负责人',
    (await prisma.notification.count({
      where: { tenantId, userId: salesId, title: { contains: '线索已转换' } },
    })) >= 2,
  )

  // 1.1 同名客户 selector：多个候选时优先非公海且负责人一致。
  const selectorName = `同名客户 ${suffix}`
  const selectorOld = await prisma.customer.create({
    data: {
      id: id(),
      name: selectorName,
      owner: adminId,
      collectionTime: BigInt(Date.now() - 120_000),
      organizationId: tenantId,
      createTime: BigInt(Date.now() - 120_000),
      updateTime: BigInt(Date.now() - 120_000),
      createUser: adminId,
      updateUser: adminId,
    },
  })
  const selectorPreferred = await prisma.customer.create({
    data: {
      id: id(),
      name: selectorName,
      owner: salesId,
      collectionTime: BigInt(Date.now() - 60_000),
      organizationId: tenantId,
      createTime: BigInt(Date.now() - 60_000),
      updateTime: BigInt(Date.now() - 60_000),
      createUser: adminId,
      updateUser: adminId,
    },
  })
  const selectorLead = await addLead(headers, { name: selectorName, owner: salesId })
  const selectorResult = await jsonRequest('POST', '/lead/transform', headers, {
    clueId: selectorLead.id,
    oppCreated: false,
  })
  check(
    '同名客户 selector 优先负责人一致的非公海客户',
    selectorResult.response.ok &&
      selectorResult.data?.customerId === selectorPreferred.id &&
      selectorResult.data?.customerId !== selectorOld.id &&
      (await prisma.customer.count({ where: { organizationId: tenantId, name: selectorName } })) === 2,
    JSON.stringify(selectorResult.data),
  )

  // 2. 新建客户并关联：Cordys 独立路径，不复制 Follow、不创建协作。
  const transitionLead = await addLead(headers, {
    name: `新建客户关联 ${suffix}`,
    contact: '独立路径联系人',
    phone: '13800001002',
  })
  await addFollowArtifacts({
    leadId: transitionLead.id,
    ownerId: adminId,
    ownerName: 'W342 Admin',
    marker: 'transition',
    converted: false,
  })
  const transitioned = await jsonRequest('POST', '/lead/transition/account', headers, {
    clueId: transitionLead.id,
    name: `独立路径客户 ${suffix}`,
    ownerId: salesId,
  })
  check(
    '/lead/transition/account 新建客户并同步联系人',
    transitioned.response.ok && !!transitioned.data?.customerId && !!transitioned.data?.contactId,
    JSON.stringify(transitioned.data),
  )
  const transitionContact = await prisma.customerContact.findUniqueOrThrow({
    where: { id: transitioned.data.contactId },
  })
  check('独立路径联系人负责人跟随新客户负责人', transitionContact.owner === salesId)
  check(
    '独立路径不复制 FollowUpRecord/Plan',
    (await prisma.followUpRecord.count({
      where: { tenantId, targetType: 'customer', targetId: transitioned.data.customerId },
    })) === 0 &&
      (await prisma.followUpPlan.count({
        where: { tenantId, targetType: 'customer', targetId: transitioned.data.customerId },
      })) === 0,
  )
  check(
    '独立路径不创建客户协作关系',
    (await prisma.customerCollaboration.count({
      where: { customerId: transitioned.data.customerId, userId: adminId },
    })) === 0,
  )

  // 3. 中途 Contact 写入失败时，Customer 与 transition 必须整体回滚。
  const rollbackLead = await addLead(headers, {
    name: `回滚线索 ${suffix}`,
    contact: '回滚联系人',
    phone: '13800001004',
  })
  await prisma.clue.update({
    where: { id: rollbackLead.id },
    data: { phone: '1'.repeat(40) },
  })
  const rollbackCustomerName = `不应残留客户 ${suffix}`
  const rollback = await jsonRequest('POST', '/lead/transition/account', headers, {
    clueId: rollbackLead.id,
    name: rollbackCustomerName,
    ownerId: salesId,
  })
  const rollbackClue = await prisma.clue.findUniqueOrThrow({ where: { id: rollbackLead.id } })
  check('联系人写入失败时转换接口失败', !rollback.response.ok)
  check(
    '转换事务回滚，不留下孤儿客户且不写 transition',
    !(await prisma.customer.findFirst({
      where: { organizationId: tenantId, name: rollbackCustomerName },
    })) &&
      rollbackClue.transitionId === null &&
      rollbackClue.transitionType !== 'CUSTOMER',
  )

  // 4. 关联已有客户：协作 + Follow 复制；无效负责人按 Cordys 跳过。
  const existingCustomer = await prisma.customer.create({
    data: {
      id: id(),
      name: `已有客户 ${suffix}`,
      owner: salesId,
      collectionTime: BigInt(Date.now()),
      organizationId: tenantId,
      createTime: BigInt(Date.now()),
      updateTime: BigInt(Date.now()),
      createUser: adminId,
      updateUser: adminId,
    },
  })
  const existingLead = await addLead(headers, {
    name: `关联已有客户 ${suffix}`,
    contact: '已有客户联系人',
    phone: '13800001003',
  })
  await addFollowArtifacts({
    leadId: existingLead.id,
    ownerId: adminId,
    ownerName: 'W342 Admin',
    marker: 'retransition',
    converted: false,
  })
  const invalidOwnerLead = await prisma.clue.create({
    data: {
      id: id(),
      name: `无效负责人线索 ${suffix}`,
      owner: 'missing-owner',
      stage: 'NEW',
      organizationId: tenantId,
      createTime: BigInt(Date.now()),
      updateTime: BigInt(Date.now()),
      createUser: adminId,
      updateUser: adminId,
      inSharedPool: false,
    },
  })
  const retransitioned = await jsonRequest('POST', '/lead/re-transition/account', headers, {
    clueIds: [existingLead.id, invalidOwnerLead.id],
    customerId: existingCustomer.id,
  })
  check(
    '/lead/re-transition/account 关联有效线索并跳过无效负责人',
    retransitioned.response.ok &&
      retransitioned.data?.success === 1 &&
      retransitioned.data?.skippedIds?.includes(invalidOwnerLead.id),
    JSON.stringify(retransitioned.data),
  )
  check(
    '关联已有客户时建立负责人协作关系',
    (await prisma.customerCollaboration.count({
      where: { customerId: existingCustomer.id, userId: adminId, collaborationType: 'COLLABORATION' },
    })) === 1,
  )
  check(
    '关联已有客户复制 Record/Plan 且保留原线索计划',
    (await prisma.followUpRecord.count({
      where: { tenantId, targetType: 'customer', targetId: existingCustomer.id },
    })) === 1 &&
      (await prisma.followUpPlan.count({
        where: { tenantId, targetType: 'customer', targetId: existingCustomer.id },
      })) === 1 &&
      (await prisma.followUpPlan.count({
        where: { tenantId, targetType: 'lead', targetId: existingLead.id },
      })) === 1,
  )
  const repeatedRetransition = await jsonRequest('POST', '/lead/re-transition/account', headers, {
    clueIds: [existingLead.id],
    customerId: existingCustomer.id,
  })
  check(
    '重复关联不会重复创建协作或联系人',
    repeatedRetransition.response.ok &&
      (await prisma.customerCollaboration.count({
        where: { customerId: existingCustomer.id, userId: adminId },
      })) === 1 &&
      (await prisma.customerContact.count({
        where: { customerId: existingCustomer.id, phone: '13800001003' },
      })) === 1,
  )

  // 5. 已有客户在公海：先领取，再在同一事务中关联。
  const pool = await prisma.customerPool.create({
    data: {
      id: id(),
      name: `转换公海 ${suffix}`,
      scopeId: JSON.stringify([adminId]),
      ownerId: JSON.stringify([adminId]),
      organizationId: tenantId,
      enable: true,
      auto: false,
      createTime: BigInt(Date.now()),
      updateTime: BigInt(Date.now()),
      createUser: adminId,
      updateUser: adminId,
    },
  })
  const poolCustomer = await prisma.customer.create({
    data: {
      id: id(),
      name: `公海客户 ${suffix}`,
      owner: null,
      collectionTime: null,
      poolId: pool.id,
      inSharedPool: true,
      organizationId: tenantId,
      createTime: BigInt(Date.now() - 120_000),
      updateTime: BigInt(Date.now() - 120_000),
      createUser: adminId,
      updateUser: adminId,
    },
  })
  const poolLead = await addLead(headers, { name: `公海关联线索 ${suffix}` })
  const poolTransition = await jsonRequest('POST', '/lead/re-transition/account', headers, {
    clueIds: [poolLead.id],
    customerId: poolCustomer.id,
  })
  const claimedCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: poolCustomer.id } })
  const linkedPoolLead = await prisma.clue.findUniqueOrThrow({ where: { id: poolLead.id } })
  check(
    '公海客户先领取后关联线索',
    poolTransition.response.ok &&
      claimedCustomer.inSharedPool === false &&
      claimedCustomer.poolId === null &&
      claimedCustomer.owner === adminId &&
      linkedPoolLead.transitionId === poolCustomer.id,
    JSON.stringify(poolTransition.data),
  )

  console.log(`\nW3.4.2 三条转换 Smoke：${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
} finally {
  await cleanupTenant(tenantId).catch((error) => {
    console.error(`  ! 清理临时租户失败: ${error instanceof Error ? error.message : String(error)}`)
  })
  await prisma.$disconnect()
}
