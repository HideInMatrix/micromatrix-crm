/**
 * W3.4.2 / task 3.4 多线索池 API、规则与自动回收 Smoke。
 * 前置：API 已使用当前 production build 启动，migration 已应用。
 */
import { readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const bcrypt = requireFromApi('bcryptjs')
const ExcelJS = requireFromApi('exceljs')
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
  if (!line) throw new Error('W3.4.2 线索池 Smoke 需要 DATABASE_URL')
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
    // 文件或空响应不强制 JSON。
  }
  return { response, data }
}

async function multipartRequest(path, headers, fileBuffer, fields) {
  const form = new FormData()
  form.append(
    'file',
    new Blob([fileBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'pool-template.xlsx',
  )
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value))
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: form,
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    // ignore
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
    where: { name: { startsWith: 'W342 Pool ' } },
    select: { id: true },
  })
  for (const row of rows) await cleanupTenant(row.id)
  if (rows.length) console.log(`  · 已清理 ${rows.length} 个历史线索池 Smoke 租户`)
}

function poolPayload({ name, scopeIds, ownerIds, hiddenFieldIds = [], pickRule, auto = false, recycleRule }) {
  return {
    name,
    scopeIds,
    ownerIds,
    enable: true,
    auto,
    hiddenFieldIds,
    pickRule: pickRule ?? {
      limitOnNumber: false,
      pickNumber: null,
      limitPreOwner: false,
      pickIntervalDays: null,
      limitNew: false,
      newPickInterval: null,
    },
    recycleRule: recycleRule ?? { operator: 'AND', conditions: [] },
  }
}

async function getPoolByName(headers, name) {
  const result = await jsonRequest('POST', '/lead-pool/page', headers, {
    current: 1,
    pageSize: 200,
    keyword: name,
  })
  return result.data?.list?.find((item) => item.name === name)
}

async function addLead(headers, name, owner, sourceFieldId, source = '官网表单') {
  const result = await jsonRequest('POST', '/lead/add', headers, {
    name,
    owner,
    moduleFields: sourceFieldId ? [{ fieldId: sourceFieldId, fieldValue: source }] : [],
  })
  if (!result.response.ok || !result.data?.id) {
    throw new Error(`创建线索失败: ${result.response.status} ${JSON.stringify(result.data)}`)
  }
  return result.data
}

async function moveLeadToPool(headers, leadId, poolId) {
  const result = await jsonRequest('POST', '/lead/to-pool', headers, { id: leadId, poolId })
  if (!result.response.ok) {
    throw new Error(`移入线索池失败: ${result.response.status} ${JSON.stringify(result.data)}`)
  }
}

async function updatePool(headers, pool) {
  const result = await jsonRequest('POST', '/lead-pool/update', headers, pool)
  if (!result.response.ok) {
    throw new Error(`更新线索池失败: ${result.response.status} ${JSON.stringify(result.data)}`)
  }
}

try {
  console.log('\nW3.4.2 多线索池 API / 规则 Smoke')
  await cleanupStaleTenants()

  const adminPassword = 'Smoke123!'
  const registered = await jsonRequest('POST', '/auth/register', undefined, {
    tenantName: `W342 Pool ${suffix}`,
    name: 'W342 Pool Admin',
    email: `w342-pool-${suffix}@smoke.local`,
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

  const poolRole = await prisma.role.create({
    data: {
      tenantId,
      name: `线索池成员 ${suffix}`,
      permissions: [
        'menu:lead',
        'lead:update',
        'leadPool:read',
        'leadPool:pick',
        'leadPool:assign',
        'leadPool:update',
        'leadPool:delete',
        'leadPool:import',
        'leadPool:export',
      ],
      dataScope: 'SELF',
    },
  })
  const targetRole = await prisma.role.create({
    data: {
      tenantId,
      name: `容量目标 ${suffix}`,
      permissions: ['menu:lead'],
      dataScope: 'SELF',
    },
  })
  const memberPassword = 'Member123!'
  const memberA = await prisma.user.create({
    data: {
      tenantId,
      email: `w342-pool-a-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(memberPassword, 10),
      name: 'Pool Member A',
      deptId: rootDept.id,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: poolRole.id } },
    },
  })
  const memberB = await prisma.user.create({
    data: {
      tenantId,
      email: `w342-pool-b-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(memberPassword, 10),
      name: 'Pool Member B',
      deptId: rootDept.id,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: poolRole.id } },
    },
  })
  const capacityUser = await prisma.user.create({
    data: {
      tenantId,
      email: `w342-pool-cap-${suffix}@smoke.local`,
      passwordHash: await bcrypt.hash(memberPassword, 10),
      name: 'Pool Capacity Target',
      deptId: rootDept.id,
      status: 'ACTIVE',
      userRoles: { create: { tenantId, roleId: targetRole.id } },
    },
  })
  const memberASession = await login(memberA.email, memberPassword)
  const memberBSession = await login(memberB.email, memberPassword)

  const form = await jsonRequest('GET', '/lead/module/form', adminHeaders)
  const phoneField = form.data?.fields?.find((field) => field.key === 'phone')
  const sourceField = form.data?.fields?.find((field) => field.key === 'cf_source')
  check('线索表单字段已初始化', form.response.ok && !!phoneField?.id && !!sourceField?.id)

  const poolAName = `Pool A ${suffix}`
  const poolBName = `Pool B ${suffix}`
  const poolCName = `Pool C ${suffix}`
  for (const payload of [
    poolPayload({
      name: poolAName,
      scopeIds: [memberA.id],
      ownerIds: [adminId],
      hiddenFieldIds: [phoneField.id],
    }),
    poolPayload({ name: poolBName, scopeIds: [memberB.id], ownerIds: [adminId] }),
    poolPayload({ name: poolCName, scopeIds: [memberA.id], ownerIds: [memberA.id] }),
  ]) {
    const created = await jsonRequest('POST', '/lead-pool/add', adminHeaders, payload)
    if (!created.response.ok) throw new Error(`创建线索池失败: ${JSON.stringify(created.data)}`)
  }
  const poolA = await getPoolByName(adminHeaders, poolAName)
  const poolB = await getPoolByName(adminHeaders, poolBName)
  const poolC = await getPoolByName(adminHeaders, poolCName)
  check('/lead-pool/add + /page 创建并读取三个直接模型线索池', !!poolA && !!poolB && !!poolC)

  const memberAOptions = await jsonRequest('GET', '/pool/lead/options', memberASession.headers)
  const visibleA = memberAOptions.data?.map((item) => item.id) ?? []
  const optionA = memberAOptions.data?.find((item) => item.id === poolA.id)
  const optionC = memberAOptions.data?.find((item) => item.id === poolC.id)
  check(
    '/pool/lead/options 执行 Pool Scope 隔离与 editable',
    memberAOptions.response.ok &&
      visibleA.includes(poolA.id) &&
      visibleA.includes(poolC.id) &&
      !visibleA.includes(poolB.id) &&
      optionA?.editable === false &&
      optionC?.editable === true,
  )
  const phoneConfig = optionA?.fieldConfigs?.find((item) => item.fieldId === phoneField.id)
  const nameConfig = optionA?.fieldConfigs?.find((item) => item.fieldName === '线索名称')
  check(
    'Pool Hidden Field 生成 fieldConfigs，线索名称不可编辑',
    phoneConfig?.enable === false && nameConfig?.editable === false,
  )

  const memberBOptions = await jsonRequest('GET', '/pool/lead/options', memberBSession.headers)
  check(
    '另一成员只能看到自己的 Pool Scope',
    memberBOptions.response.ok &&
      memberBOptions.data?.some((item) => item.id === poolB.id) &&
      !memberBOptions.data?.some((item) => item.id === poolA.id),
  )
  const settingsDenied = await jsonRequest('POST', '/lead-pool/page', memberASession.headers, {
    current: 1,
    pageSize: 20,
  })
  check('普通池成员不能读取 MODULE_SETTING 线索池设置页', settingsDenied.response.status === 403)

  const quickSuccess = await jsonRequest('POST', '/lead-pool/quick-update', memberASession.headers, {
    id: poolC.id,
    ...poolPayload({ name: `${poolCName} Quick`, scopeIds: [memberA.id], ownerIds: [memberA.id] }),
  })
  const quickDenied = await jsonRequest('POST', '/lead-pool/quick-update', memberBSession.headers, {
    id: poolC.id,
    ...poolPayload({ name: `${poolCName} Forbidden`, scopeIds: [memberA.id], ownerIds: [memberA.id] }),
  })
  check(
    '/lead-pool/quick-update 仅 Pool owner 范围可用',
    quickSuccess.response.ok && quickDenied.response.status === 403,
  )

  const ordinary = await addLead(adminHeaders, `普通线索 ${suffix}`, adminId, sourceField.id)
  const poolLeadA1 = await addLead(adminHeaders, `池 A-1 ${suffix}`, adminId, sourceField.id, '官网表单')
  const poolLeadA2 = await addLead(adminHeaders, `池 A-2 ${suffix}`, adminId, sourceField.id, '官网表单')
  const poolLeadB1 = await addLead(adminHeaders, `池 B-1 ${suffix}`, adminId, sourceField.id, '电话咨询')
  await moveLeadToPool(adminHeaders, poolLeadA1.id, poolA.id)
  await moveLeadToPool(adminHeaders, poolLeadA2.id, poolA.id)
  await moveLeadToPool(adminHeaders, poolLeadB1.id, poolB.id)

  const pageA = await jsonRequest('POST', '/pool/lead/page', memberASession.headers, {
    current: 1,
    pageSize: 20,
    poolId: poolA.id,
  })
  const pageBDenied = await jsonRequest('POST', '/pool/lead/page', memberASession.headers, {
    current: 1,
    pageSize: 20,
    poolId: poolB.id,
  })
  check(
    '/pool/lead/page 强制指定 Pool Scope',
    pageA.response.ok && pageA.data?.total === 2 && pageBDenied.response.status === 403,
  )

  const poolDetail = await jsonRequest(
    'GET',
    `/pool/lead/get/${poolLeadA1.id}`,
    memberASession.headers,
  )
  check('/pool/lead/get/:id 返回授权池详情', poolDetail.response.ok && poolDetail.data?.id === poolLeadA1.id)

  const batchUpdated = await jsonRequest('POST', '/pool/lead/batch-update', memberASession.headers, {
    poolId: poolA.id,
    ids: [poolLeadA1.id, poolLeadA2.id],
    fieldId: sourceField.id,
    fieldValue: '朋友介绍',
  })
  check(
    'Pool batch-update 在同一授权池内成功修改动态字段',
    batchUpdated.response.ok && batchUpdated.data?.success === 2,
  )

  const ordinaryBefore = await prisma.clue.findUniqueOrThrow({ where: { id: ordinary.id } })
  const poolOnlyAssign = await jsonRequest('POST', '/pool/lead/assign', adminHeaders, {
    clueId: ordinary.id,
    assignUserId: memberA.id,
  })
  const ordinaryAfter = await prisma.clue.findUniqueOrThrow({ where: { id: ordinary.id } })
  check(
    'Pool assign 拒绝普通线索，不会退化成普通 transfer',
    poolOnlyAssign.response.status === 404 && ordinaryAfter.owner === ordinaryBefore.owner,
  )

  const crossBatch = await jsonRequest('POST', '/pool/lead/batch-delete', adminHeaders, {
    poolId: poolA.id,
    ids: [poolLeadA1.id, poolLeadB1.id],
  })
  const crossSurvivors = await prisma.clue.count({
    where: { id: { in: [poolLeadA1.id, poolLeadB1.id] } },
  })
  check('跨池批量操作整体拒绝且资源未变化', crossBatch.response.status === 400 && crossSurvivors === 2)

  const chart = await jsonRequest('POST', '/pool/lead/chart', memberASession.headers, {
    poolId: poolA.id,
    chartConfig: {
      categoryAxis: { fieldId: sourceField.id },
      valueAxis: { aggregateMethod: 'COUNT' },
    },
  })
  const chartCount = Array.isArray(chart.data)
    ? chart.data.reduce((sum, item) => sum + Number(item.valueAxis ?? 0), 0)
    : 0
  check('Pool chart 只聚合当前 pool 数据而非普通线索', chart.response.ok && chartCount === 2)

  const exportAll = await jsonRequest('POST', '/pool/lead/export-all', adminHeaders, {
    poolId: poolA.id,
    current: 1,
    pageSize: 20,
    fileName: `pool-all-${suffix}`,
    headList: ['name'],
  })
  const exportSelected = await jsonRequest('POST', '/pool/lead/export-select', adminHeaders, {
    poolId: poolA.id,
    ids: [poolLeadA1.id],
    fileName: `pool-selected-${suffix}`,
    headList: ['name'],
  })
  check(
    'Pool export-all/export-select 均生成真实导出任务',
    exportAll.response.ok && !!exportAll.data?.id && exportSelected.response.ok && !!exportSelected.data?.id,
  )

  const exportCross = await jsonRequest('POST', '/pool/lead/export-select', adminHeaders, {
    poolId: poolA.id,
    ids: [poolLeadA1.id, poolLeadB1.id],
    fileName: `pool-export-${suffix}`,
    headList: ['name'],
  })
  check('Pool export-select 拒绝跨池选中资源', exportCross.response.status === 400)

  const templateResponse = await fetch(`${base}/pool/lead/template/download?importType=ADD`, {
    headers: adminHeaders,
  })
  const templateBuffer = Buffer.from(await templateResponse.arrayBuffer())
  check(
    '池导入模板无需 poolId 且返回真实 xlsx',
    templateResponse.ok && templateBuffer.subarray(0, 2).toString() === 'PK',
  )
  const importWorkbook = new ExcelJS.Workbook()
  await importWorkbook.xlsx.load(templateBuffer)
  const importSheet = importWorkbook.worksheets[0]
  if (!importSheet) throw new Error('池导入模板缺少工作表')
  const headerColumns = new Map()
  importSheet.getRow(1).eachCell((cell, column) => headerColumns.set(String(cell.value), column))
  const nameColumn = headerColumns.get('线索名称')
  if (!nameColumn) throw new Error('池导入模板缺少线索名称列')
  importSheet.getCell(2, nameColumn).value = `池导入线索 ${suffix}`
  const importBuffer = Buffer.from(await importWorkbook.xlsx.writeBuffer())
  const precheck = await multipartRequest('/pool/lead/import/pre-check', adminHeaders, importBuffer, {
    poolId: poolA.id,
    importType: 'ADD',
  })
  const imported = await multipartRequest('/pool/lead/import', adminHeaders, importBuffer, {
    poolId: poolA.id,
    importType: 'ADD',
  })
  check(
    'Pool import pre-check/import 使用 body poolId 完整走通',
    precheck.response.ok &&
      precheck.data?.successCount === 1 &&
      imported.response.ok &&
      imported.data?.successCount === 1,
    `${precheck.response.status}/${imported.response.status}`,
  )

  const batchDeleteLead = await addLead(adminHeaders, `池批量删除 ${suffix}`, adminId, sourceField.id)
  await moveLeadToPool(adminHeaders, batchDeleteLead.id, poolA.id)
  const batchDeleted = await jsonRequest('POST', '/pool/lead/batch-delete', memberASession.headers, {
    poolId: poolA.id,
    ids: [batchDeleteLead.id],
  })
  const deletedExists = await prisma.clue.count({ where: { id: batchDeleteLead.id } })
  check('Pool batch-delete 在同一授权池内成功删除', batchDeleted.response.ok && deletedExists === 0)

  const batchPick1 = await addLead(adminHeaders, `池批量领取1 ${suffix}`, adminId, sourceField.id)
  const batchPick2 = await addLead(adminHeaders, `池批量领取2 ${suffix}`, adminId, sourceField.id)
  await moveLeadToPool(adminHeaders, batchPick1.id, poolA.id)
  await moveLeadToPool(adminHeaders, batchPick2.id, poolA.id)
  const batchPicked = await jsonRequest('POST', '/pool/lead/batch-pick', memberASession.headers, {
    poolId: poolA.id,
    batchIds: [batchPick1.id, batchPick2.id],
  })
  check(
    'Pool batch-pick 全量同池校验后成功领取',
    batchPicked.response.ok && batchPicked.data?.success === 2,
  )

  const batchAssign1 = await addLead(adminHeaders, `池批量分配1 ${suffix}`, adminId, sourceField.id)
  const batchAssign2 = await addLead(adminHeaders, `池批量分配2 ${suffix}`, adminId, sourceField.id)
  await moveLeadToPool(adminHeaders, batchAssign1.id, poolB.id)
  await moveLeadToPool(adminHeaders, batchAssign2.id, poolB.id)
  const batchAssigned = await jsonRequest('POST', '/pool/lead/batch-assign', adminHeaders, {
    poolId: poolB.id,
    batchIds: [batchAssign1.id, batchAssign2.id],
    assignUserId: memberB.id,
  })
  check(
    'Pool batch-assign 全量同池校验后成功分配',
    batchAssigned.response.ok && batchAssigned.data?.success === 2,
  )

  await updatePool(adminHeaders, {
    id: poolA.id,
    ...poolPayload({
      name: poolAName,
      scopeIds: [memberA.id],
      ownerIds: [adminId],
      hiddenFieldIds: [phoneField.id],
      pickRule: {
        limitOnNumber: true,
        pickNumber: 3,
        limitPreOwner: false,
        pickIntervalDays: null,
        limitNew: false,
        newPickInterval: null,
      },
    }),
  })
  const dailyFirst = await jsonRequest('POST', '/pool/lead/pick', memberASession.headers, {
    clueId: poolLeadA1.id,
    poolId: poolA.id,
  })
  const dailySecond = await jsonRequest('POST', '/pool/lead/pick', memberASession.headers, {
    clueId: poolLeadA2.id,
    poolId: poolA.id,
  })
  check('每日领取上限在 PICK 中执行', dailyFirst.response.ok && dailySecond.response.status === 400)

  await updatePool(adminHeaders, {
    id: poolB.id,
    ...poolPayload({
      name: poolBName,
      scopeIds: [memberB.id],
      ownerIds: [adminId],
      pickRule: {
        limitOnNumber: false,
        pickNumber: null,
        limitPreOwner: false,
        pickIntervalDays: null,
        limitNew: true,
        newPickInterval: 3,
      },
    }),
  })
  const protectedLead = await addLead(adminHeaders, `新数据保护 ${suffix}`, adminId, sourceField.id)
  await moveLeadToPool(adminHeaders, protectedLead.id, poolB.id)
  const newDataDenied = await jsonRequest('POST', '/pool/lead/pick', memberBSession.headers, {
    clueId: protectedLead.id,
    poolId: poolB.id,
  })
  const adminPick = await jsonRequest('POST', '/pool/lead/pick', adminHeaders, {
    clueId: protectedLead.id,
    poolId: poolB.id,
  })
  check('新数据保护限制普通成员，但 Pool 管理员可跳过', newDataDenied.response.status === 400 && adminPick.response.ok)

  const previousOwnerLead = await addLead(adminHeaders, `前负责人冷却 ${suffix}`, adminId, sourceField.id)
  await moveLeadToPool(adminHeaders, previousOwnerLead.id, poolB.id)
  await updatePool(adminHeaders, {
    id: poolB.id,
    ...poolPayload({
      name: poolBName,
      scopeIds: [memberB.id],
      ownerIds: [adminId],
      pickRule: {
        limitOnNumber: false,
        pickNumber: null,
        limitPreOwner: true,
        pickIntervalDays: 7,
        limitNew: false,
        newPickInterval: null,
      },
    }),
  })
  const adminCooldownDenied = await jsonRequest('POST', '/pool/lead/pick', adminHeaders, {
    clueId: previousOwnerLead.id,
    poolId: poolB.id,
  })
  check('线索池管理员仍受前负责人冷却限制', adminCooldownDenied.response.status === 400)

  await updatePool(adminHeaders, {
    id: poolB.id,
    ...poolPayload({
      name: poolBName,
      scopeIds: [memberB.id],
      ownerIds: [adminId],
      pickRule: {
        limitOnNumber: true,
        pickNumber: 1,
        limitPreOwner: true,
        pickIntervalDays: 30,
        limitNew: true,
        newPickInterval: 30,
      },
    }),
  })
  const assignIgnoresRuleLead = await addLead(adminHeaders, `分配忽略领取规则 ${suffix}`, adminId, sourceField.id)
  await moveLeadToPool(adminHeaders, assignIgnoresRuleLead.id, poolB.id)
  const assigned = await jsonRequest('POST', '/pool/lead/assign', adminHeaders, {
    clueId: assignIgnoresRuleLead.id,
    assignUserId: memberB.id,
  })
  const assignedRow = await prisma.clue.findUniqueOrThrow({ where: { id: assignIgnoresRuleLead.id } })
  check('ASSIGN 不执行 PickRule 但成功写 FOLLOWING/Owner', assigned.response.ok && assignedRow.owner === memberB.id && assignedRow.stage === 'FOLLOWING')

  const capAdd = await jsonRequest('POST', '/lead-capacity/add', adminHeaders, {
    scopeIds: [capacityUser.id],
    capacity: 1,
  })
  const capacities = await jsonRequest('GET', '/lead-capacity/get', adminHeaders)
  const capacity = capacities.data?.find((item) => item.scopeIds?.includes(capacityUser.id))
  const duplicateCapacity = await jsonRequest('POST', '/lead-capacity/add', adminHeaders, {
    scopeIds: [capacityUser.id],
    capacity: 2,
  })
  check('/lead-capacity add/get + 重复 Scope 拒绝', capAdd.response.ok && !!capacity && duplicateCapacity.response.status === 400)

  const capacityLead1 = await addLead(adminHeaders, `库容分配1 ${suffix}`, adminId, sourceField.id)
  const capacityLead2 = await addLead(adminHeaders, `库容分配2 ${suffix}`, adminId, sourceField.id)
  await moveLeadToPool(adminHeaders, capacityLead1.id, poolB.id)
  await moveLeadToPool(adminHeaders, capacityLead2.id, poolB.id)
  const capacityAssign1 = await jsonRequest('POST', '/pool/lead/assign', adminHeaders, {
    clueId: capacityLead1.id,
    assignUserId: capacityUser.id,
  })
  const capacityAssign2 = await jsonRequest('POST', '/pool/lead/assign', adminHeaders, {
    clueId: capacityLead2.id,
    assignUserId: capacityUser.id,
  })
  check('ASSIGN 执行线索库容，超出容量拒绝', capacityAssign1.response.ok && capacityAssign2.response.status === 400)

  const capacityUpdate = await jsonRequest('POST', '/lead-capacity/update', adminHeaders, {
    id: capacity.id,
    scopeIds: [capacityUser.id],
    capacity: 2,
  })
  const capacityDelete = await jsonRequest('GET', `/lead-capacity/delete/${capacity.id}`, adminHeaders)
  check('/lead-capacity update/delete 完整可用', capacityUpdate.response.ok && capacityDelete.response.ok)

  const noPick = await jsonRequest('GET', `/lead-pool/no-pick/${poolB.id}`, adminHeaders)
  const deleteNonEmpty = await jsonRequest('GET', `/lead-pool/delete/${poolB.id}`, adminHeaders)
  check('/lead-pool/no-pick + 非空池删除保护', noPick.data === true && deleteNonEmpty.response.status === 400)

  const switched = await jsonRequest('GET', `/lead-pool/switch/${poolC.id}`, adminHeaders)
  const optionsAfterDisable = await jsonRequest('GET', '/pool/lead/options', adminHeaders)
  const switchedBack = await jsonRequest('GET', `/lead-pool/switch/${poolC.id}`, adminHeaders)
  const deletedEmptyPool = await jsonRequest('GET', `/lead-pool/delete/${poolC.id}`, adminHeaders)
  check(
    '/lead-pool switch + 空池 delete 完整可用',
    switched.response.ok &&
      !optionsAfterDisable.data?.some((item) => item.id === poolC.id) &&
      switchedBack.response.ok &&
      deletedEmptyPool.response.ok,
  )

  const recyclePoolName = `Recycle Pool ${suffix}`
  const recyclePoolCreated = await jsonRequest('POST', '/lead-pool/add', adminHeaders, {
    ...poolPayload({
      name: recyclePoolName,
      scopeIds: [memberA.id],
      ownerIds: [adminId],
      auto: true,
      recycleRule: {
        operator: 'AND',
        conditions: [
          {
            column: 'storageTime',
            operator: 'DYNAMICS',
            value: 'CUSTOM,1,BEFORE_DAY',
            scope: ['Created'],
          },
        ],
      },
    }),
  })
  if (!recyclePoolCreated.response.ok) throw new Error(`自动回收池创建失败 ${JSON.stringify(recyclePoolCreated.data)}`)
  const recyclePool = await getPoolByName(adminHeaders, recyclePoolName)
  const recycleLead = await addLead(adminHeaders, `NEW 也应自动回收 ${suffix}`, memberA.id, sourceField.id)
  const convertedLead = await addLead(adminHeaders, `已转换不回收 ${suffix}`, memberA.id, sourceField.id)
  const oldTime = BigInt(Date.now() - 10 * 24 * 60 * 60 * 1000)
  await prisma.clue.update({
    where: { id: recycleLead.id },
    data: { stage: 'NEW', createTime: oldTime, collectionTime: oldTime },
  })
  await prisma.clue.update({
    where: { id: convertedLead.id },
    data: {
      stage: 'INTERESTED',
      createTime: oldTime,
      collectionTime: oldTime,
      transitionId: `customer-${suffix}`,
      transitionType: 'CUSTOMER',
    },
  })

  const { PoolRecycleService } = requireFromApi('./dist/modules/pool-rules/pool-recycle.service.js')
  const { CluePoolRepository } = requireFromApi('./dist/modules/pool-rules/clue-pool.repository.js')
  const { CustomerPoolRepository } = requireFromApi('./dist/modules/pool-rules/customer-pool.repository.js')
  const { PoolRuleCalculator } = requireFromApi(
    './dist/modules/pool-rules/pool-rule-calculator.service.js',
  )
  const { ResourceRecycleConditionEvaluator } = requireFromApi(
    './dist/modules/pool-rules/resource-recycle-condition-evaluator.service.js',
  )
  const calculator = new PoolRuleCalculator()
  const recycleService = new PoolRecycleService(
    prisma,
    { send: async () => 0 },
    new CluePoolRepository(prisma, calculator),
    new CustomerPoolRepository(prisma, calculator),
    new ResourceRecycleConditionEvaluator(),
  )
  const recycleFirst = await recycleService.recycleTenant(tenantId)
  const recycleSecond = await recycleService.recycleTenant(tenantId)
  const recycled = await prisma.clue.findUniqueOrThrow({ where: { id: recycleLead.id } })
  const converted = await prisma.clue.findUniqueOrThrow({ where: { id: convertedLead.id } })
  check(
    '自动回收不伪限 FOLLOWING，NEW 未转换线索可回收',
    recycleFirst.recycledLeads >= 1 &&
      recycled.inSharedPool === true &&
      recycled.poolId === recyclePool.id &&
      recycled.reasonId === 'system',
  )
  check(
    '已转换线索不自动回收，重复执行保持幂等',
    converted.inSharedPool === false && recycleSecond.recycledLeads === 0,
  )

  console.log(`\nW3.4.2 多线索池 Smoke：${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
} finally {
  await cleanupTenant(tenantId).catch((error) =>
    console.error(`清理临时租户失败: ${error instanceof Error ? error.message : String(error)}`),
  )
  await prisma.$disconnect()
}
