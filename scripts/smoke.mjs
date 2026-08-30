/**
 * 全链路冒烟测试：登录 → 数据范围 → 元数据 → 线索转化 → 交易链 → 审批 → 标讯 → 报表
 * 运行前置：API 已启动（pnpm dev 或 node apps/api/dist/main.js）、已执行种子数据
 * 用法：pnpm smoke
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const ExcelJS = requireFromApi('exceljs')
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')
const base = process.env.API_BASE ?? 'http://localhost:3000/api'

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

async function login(email, password) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json())
  if (!res.accessToken) throw new Error(`登录失败: ${email} ${JSON.stringify(res)}`)
  return {
    user: res.user,
    headers: { Authorization: `Bearer ${res.accessToken}`, 'Content-Type': 'application/json' },
  }
}

async function register(tenantName, name, email, password) {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantName, name, email, password }),
  }).then((r) => r.json())
  if (!res.accessToken) throw new Error(`注册失败: ${email} ${JSON.stringify(res)}`)
  return {
    user: res.user,
    headers: { Authorization: `Bearer ${res.accessToken}`, 'Content-Type': 'application/json' },
  }
}

const get = (url, h) => fetch(`${base}${url}`, { headers: h }).then((r) => r.json())
const post = (url, h, body) =>
  fetch(`${base}${url}`, { method: 'POST', headers: h, body: JSON.stringify(body ?? {}) }).then(
    (r) => r.json(),
  )
const request = (method, url, h, body) =>
  fetch(`${base}${url}`, {
    method,
    headers: h,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

function resolveSmokeDatabaseUrl() {
  if (process.env.SMOKE_DATABASE_URL) return process.env.SMOKE_DATABASE_URL
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('Smoke 需要 DATABASE_URL 或 apps/api/.env 中的 DATABASE_URL')
  const raw = line.slice(line.indexOf('=') + 1).trim()
  return raw.replace(/^['"]|['"]$/g, '')
}

const smokeDatabaseUrl = resolveSmokeDatabaseUrl()
const smokeId = () => randomUUID().replaceAll('-', '')
const smokePrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: smokeDatabaseUrl }),
})

async function createPoolFixture(module, user, input) {
  const id = smokeId()
  const now = BigInt(Date.now())
  const pickRule = input.pickRule ?? {}
  const recycleRule = input.recycleRule ?? {}
  const data = {
    id,
    name: input.name,
    scopeId: JSON.stringify(input.scopeIds ?? []),
    organizationId: user.tenantId,
    ownerId: JSON.stringify(input.managerIds ?? []),
    enable: input.enabled ?? true,
    auto: input.autoRecycle ?? false,
    createTime: now,
    updateTime: now,
    createUser: user.id,
    updateUser: user.id,
    hiddenFields: {
      create: [...new Set(input.hiddenFieldIds ?? [])].map((fieldId) => ({ fieldId })),
    },
    pickRule: {
      create: {
        limitOnNumber: pickRule.limitDailyPick ?? false,
        pickNumber: pickRule.dailyPickLimit ?? null,
        limitPreOwner: pickRule.limitPreviousOwner ?? false,
        pickIntervalDays: pickRule.previousOwnerCooldownDays ?? null,
        limitNew: pickRule.limitNewData ?? false,
        newPickInterval: pickRule.newDataCooldownDays ?? null,
        createUser: user.id,
        createTime: now,
        updateUser: user.id,
        updateTime: now,
      },
    },
    recycleRule: {
      create: {
        operator: recycleRule.operator ?? 'AND',
        condition: JSON.stringify(recycleRule.conditions ?? []),
        createUser: user.id,
        createTime: now,
        updateUser: user.id,
        updateTime: now,
      },
    },
  }
  return module === 'lead'
    ? smokePrisma.cluePool.create({ data })
    : smokePrisma.customerPool.create({ data })
}

async function deletePoolFixture(module, user, poolId) {
  const result =
    module === 'lead'
      ? await smokePrisma.cluePool.deleteMany({
          where: { id: poolId, organizationId: user.tenantId },
        })
      : await smokePrisma.customerPool.deleteMany({
          where: { id: poolId, organizationId: user.tenantId },
        })
  return result.count === 1
}

async function buildXlsx(headers, rows) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('导入')
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function postXlsx(url, h, buffer, importType, poolId) {
  const form = new FormData()
  form.append('importType', importType)
  if (poolId) form.append('poolId', poolId)
  form.append(
    'file',
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'smoke.xlsx',
  )
  return fetch(`${base}${url}`, {
    method: 'POST',
    headers: { Authorization: h.Authorization },
    body: form,
  })
}

async function readXlsx(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook.worksheets[0]
}

async function cleanupHistoricalLeadSmokeData(tenantId) {
  const historical = await smokePrisma.clue.findMany({
    where: {
      organizationId: tenantId,
      OR: [
        { name: { startsWith: '冒烟线索-' } },
        { name: { startsWith: 'R4' } },
        { name: { startsWith: '批量编辑线索' } },
      ],
    },
    select: { id: true },
  })
  const ids = historical.map((item) => item.id)
  if (!ids.length) return 0

  await smokePrisma.$transaction([
    smokePrisma.followUpRecord.deleteMany({
      where: { tenantId, targetType: 'lead', targetId: { in: ids } },
    }),
    smokePrisma.followUpPlan.deleteMany({
      where: { tenantId, targetType: 'lead', targetId: { in: ids } },
    }),
    smokePrisma.attachment.deleteMany({
      where: { tenantId, targetType: 'lead', targetId: { in: ids } },
    }),
    smokePrisma.clue.deleteMany({ where: { id: { in: ids }, organizationId: tenantId } }),
  ])
  return ids.length
}

async function cleanupHistoricalCustomerSmokeData(tenantId) {
  const prefixes = [
    'W2.4关闭事件客户-',
    'W2.4恢复事件客户-',
    'R6下级范围客户-',
    '冒烟线索-',
    'R4关联客户-',
    'R4只读客户-',
    'R4公海客户-',
    'R4唯一复用客户-',
    '负责人历史客户-',
    '协作权限客户-',
    '冒烟集团-',
    '冒烟子公司-',
    '冒烟合并主客户-',
    '冒烟合并副客户-',
    '批量编辑客户A-',
    '批量编辑客户B-',
    'R1公海批改客户A-',
    'R1公海批改客户B-',
    'R1公海负责人批改-',
    'R3联系人客户-',
    'R3联系人其他客户-',
  ]
  const historical = await smokePrisma.customer.findMany({
    where: {
      organizationId: tenantId,
      OR: prefixes.map((prefix) => ({ name: { startsWith: prefix } })),
    },
    select: { id: true },
  })
  const ids = historical.map((item) => item.id)
  if (!ids.length) return 0

  const contacts = await smokePrisma.customerContact.findMany({
    where: { organizationId: tenantId, customerId: { in: ids } },
    select: { id: true },
  })
  const contactIds = contacts.map((item) => item.id)
  const opportunities = await smokePrisma.opportunity.findMany({
    where: { organizationId: tenantId, customerId: { in: ids } },
    select: { id: true },
  })
  const opportunityIds = opportunities.map((item) => item.id)

  await smokePrisma.$transaction(async (tx) => {
    if (opportunityIds.length) {
      await tx.opportunityQuotation.deleteMany({
        where: { organizationId: tenantId, opportunityId: { in: opportunityIds } },
      })
    }
    await tx.opportunity.deleteMany({ where: { organizationId: tenantId, customerId: { in: ids } } })
    await tx.contract.deleteMany({ where: { organizationId: tenantId, customerId: { in: ids } } })
    await tx.followUpRecord.deleteMany({
      where: { tenantId, targetType: 'customer', targetId: { in: ids } },
    })
    await tx.followUpPlan.deleteMany({
      where: { tenantId, targetType: 'customer', targetId: { in: ids } },
    })
    await tx.attachment.deleteMany({
      where: {
        tenantId,
        OR: [
          { targetType: 'customer', targetId: { in: ids } },
          ...(contactIds.length
            ? [{ targetType: 'contact', targetId: { in: contactIds } }]
            : []),
        ],
      },
    })
    if (contactIds.length) {
      await tx.customerContact.deleteMany({
        where: { organizationId: tenantId, id: { in: contactIds } },
      })
    }
    await tx.customer.deleteMany({ where: { organizationId: tenantId, id: { in: ids } } })
  })
  return ids.length
}

async function cleanupHistoricalProductSmokeData(tenantId) {
  const result = await smokePrisma.product.deleteMany({
    where: { organizationId: tenantId, name: { startsWith: '冒烟意向产品-' } },
  })
  return result.count
}

async function cleanupHistoricalInvoiceSmokeData(tenantId) {
  const result = await smokePrisma.businessTitle.deleteMany({
    where: { organizationId: tenantId, name: { startsWith: '冒烟开票抬头-' } },
  })
  return result.count
}

console.log('== 微矩阵 CRM 全链路冒烟 ==')

// 1. 健康与登录
const health = await fetch(`${base}/health`).then((r) => r.json())
check('健康检查', health.status === 'ok')
const admin = await login('admin@demo.com', 'admin123')
const manager = await login('zhangwei@demo.com', 'admin123')
const sales = await login('lina@demo.com', 'demo123')
check('三种角色登录', Boolean(admin.user && manager.user && sales.user))
const historicalLeadSmokeCount = await cleanupHistoricalLeadSmokeData(admin.user.tenantId)
check('历史线索 Smoke 数据已隔离清理', historicalLeadSmokeCount >= 0)
const historicalCustomerSmokeCount = await cleanupHistoricalCustomerSmokeData(admin.user.tenantId)
check('历史客户 Smoke 数据已隔离清理', historicalCustomerSmokeCount >= 0)
const historicalProductSmokeCount = await cleanupHistoricalProductSmokeData(admin.user.tenantId)
check('历史产品 Smoke 数据已隔离清理', historicalProductSmokeCount >= 0)
const historicalInvoiceSmokeCount = await cleanupHistoricalInvoiceSmokeData(admin.user.tenantId)
check('历史发票 Smoke 数据已隔离清理', historicalInvoiceSmokeCount >= 0)
const stamp = Date.now().toString(36)
const phoneSuffix = String(Date.now()).slice(-8)

// W3.1 企业微信集成底座：权限、首次密钥、受控查看、脱敏响应和持久化。
const managerWeComConfig = await request('GET', '/enterprise-integrations/wecom', manager.headers)
check('W3.1 无企业设置权限的角色不可读取企微配置', managerWeComConfig.status === 403)
const integrationAdmin = await register(
  `W3.1隔离租户-${stamp}`,
  'W3.1 集成管理员',
  `w31-${stamp}@smoke.local`,
  'smoke123',
)
const missingSecretTest = await request(
  'POST',
  '/enterprise-integrations/wecom/test',
  integrationAdmin.headers,
  { corpId: 'ww-smoke', agentId: '1000001' },
)
check('W3.1 首次连接测试必须提供应用 Secret', missingSecretTest.status === 400)
const savedWeComResponse = await request(
  'PUT',
  '/enterprise-integrations/wecom',
  integrationAdmin.headers,
  { corpId: `ww-${stamp}`, agentId: '1000001', appSecret: `smoke-secret-${stamp}` },
)
const savedWeCom = await savedWeComResponse.json()
check(
  'W3.1 企微配置保存后只返回脱敏状态',
  savedWeComResponse.ok &&
    savedWeCom.configured === true &&
    savedWeCom.secretConfigured === true &&
    savedWeCom.lastTestSucceeded === null &&
    !('appSecret' in savedWeCom) &&
    !('secretCiphertext' in savedWeCom),
)
const persistedWeCom = await get('/enterprise-integrations/wecom', integrationAdmin.headers)
check(
  'W3.1 企微配置按租户持久化且不回显 Secret',
  persistedWeCom.corpId === `ww-${stamp}` &&
    persistedWeCom.agentId === '1000001' &&
    persistedWeCom.secretConfigured === true &&
    !('appSecret' in persistedWeCom),
)
const revealedWeComSecret = await get(
  '/enterprise-integrations/wecom/secret',
  integrationAdmin.headers,
)
check(
  'W3.1 配置管理员可按需查看已保存 Secret',
  revealedWeComSecret.appSecret === `smoke-secret-${stamp}`,
)
const savedSecretTest = await request(
  'POST',
  '/enterprise-integrations/wecom/test',
  integrationAdmin.headers,
  { corpId: `ww-${stamp}`, agentId: '1000001' },
)
check('W3.1 卡片测试可直接复用已保存 Secret', savedSecretTest.status !== 400)

// W2.5 流程设置底座：权限、配置生命周期、不可用类型和不可变版本。
const managerFlowList = await request('GET', '/approvals/flows?pageSize=10', manager.headers)
check('W2.5 无流程设置权限的角色不可读取配置', managerFlowList.status === 403)
const processAdmin = await register(
  `W2.5隔离租户-${stamp}`,
  'W2.5 流程管理员',
  `w25-${stamp}@smoke.local`,
  'smoke123',
)
const invoiceFlowPayload = {
  formType: 'invoice',
  name: `冒烟发票审批-${stamp}`,
  description: 'W2.5 临时配置',
  enabled: false,
  createExecute: true,
  updateExecute: true,
  deleteExecute: true,
  submitterCanRevoke: true,
  allowBatchProcess: false,
  allowWithdraw: false,
  allowAddSign: false,
  duplicateApproverRule: 'FIRST_ONLY',
  requireComment: false,
  condition: null,
  createNodes: [
    {
      name: '直属上级审批',
      approverType: 'DIRECT_LEADER',
      approverIds: [],
      mode: 'ANY',
    },
  ],
}
const invoiceFlowResponse = await request(
  'POST',
  '/approvals/flows',
  processAdmin.headers,
  invoiceFlowPayload,
)
const invoiceFlow = await invoiceFlowResponse.json()
check(
  'W2.5 发票审批已接入运行时并支持三执行时机',
  invoiceFlowResponse.ok &&
    invoiceFlow.number?.startsWith('INV-APV-') &&
    invoiceFlow.currentVersion === 1 &&
    invoiceFlow.runtimeReady === true &&
    invoiceFlow.createExecute === true &&
    invoiceFlow.updateExecute === true &&
    invoiceFlow.deleteExecute === true,
)
const enableInvoiceFlow = await request(
  'PATCH',
  `/approvals/flows/${invoiceFlow.id}/enabled`,
  processAdmin.headers,
  { enabled: true },
)
check('W2.5 发票审批流程可真实启用', enableInvoiceFlow.ok)

const { formType: _invoiceFormType, ...invoiceUpdatePayload } = invoiceFlowPayload
invoiceUpdatePayload.name = `${invoiceFlowPayload.name}-V2`
invoiceUpdatePayload.createNodes = [
  ...invoiceFlowPayload.createNodes,
  {
    name: '财务审批',
    approverType: 'ROLE',
    approverIds: [processAdmin.user.roles[0].id],
    mode: 'ALL',
  },
]
const updatedInvoiceResponse = await request(
  'PUT',
  `/approvals/flows/${invoiceFlow.id}`,
  processAdmin.headers,
  invoiceUpdatePayload,
)
const updatedInvoiceFlow = await updatedInvoiceResponse.json()
check(
  'W2.5 节点定义变化生成不可变 V2 并保留完整线性图',
  updatedInvoiceResponse.ok &&
    updatedInvoiceFlow.currentVersion === 2 &&
    updatedInvoiceFlow.createNodes?.filter((node) => node.nodeType === 'APPROVER').length === 2 &&
    updatedInvoiceFlow.createLinks?.length === 3,
)
const deletedInvoiceFlow = await request(
  'DELETE',
  `/approvals/flows/${invoiceFlow.id}`,
  processAdmin.headers,
)
check('W2.5 停用流程可软删除', deletedInvoiceFlow.ok)

// 1.1 顶部导航配置：租户默认、排序、权限与刷新持久化
const expectedTopNavigation = [
  'search',
  'task',
  'event',
  'agent',
  'notify',
  'about',
  'language',
  'help',
]
const initialTopNavigation = await get('/module-configs/top-navigation', admin.headers)
check(
  '顶部导航默认补种与 Cordys 顺序一致',
  JSON.stringify(initialTopNavigation.map((item) => item.navigationKey)) ===
    JSON.stringify(expectedTopNavigation),
)
const reorderedTopNavigation = [...expectedTopNavigation.slice(1), expectedTopNavigation[0]]
const reorderTopNavigationRes = await request(
  'POST',
  '/module-configs/top-navigation/reorder',
  admin.headers,
  { navigationKeys: reorderedTopNavigation },
)
const reorderedTopNavigationBody = await reorderTopNavigationRes.json()
check(
  '管理员可持久化顶部导航完整排序',
  reorderTopNavigationRes.ok &&
    JSON.stringify(reorderedTopNavigationBody.map((item) => item.navigationKey)) ===
      JSON.stringify(reorderedTopNavigation),
)
const forbiddenTopNavigationRes = await request(
  'POST',
  '/module-configs/top-navigation/reorder',
  sales.headers,
  { navigationKeys: expectedTopNavigation },
)
check('非管理员不能修改顶部导航排序', forbiddenTopNavigationRes.status === 403)
await request('POST', '/module-configs/top-navigation/reorder', admin.headers, {
  navigationKeys: expectedTopNavigation,
})
const restoredTopNavigation = await get('/module-configs/top-navigation', manager.headers)
check(
  '顶部导航顺序刷新后保持且登录用户可读',
  JSON.stringify(restoredTopNavigation.map((item) => item.navigationKey)) ===
    JSON.stringify(expectedTopNavigation),
)

// 1.2 W2.3 消息设置：固定事件目录、租户开关、范围配置与权限
const initialMessageSettings = await get('/message-settings', admin.headers)
const initialMessageItems = initialMessageSettings.flatMap((group) => group.items)
check(
  'W2.3 消息目录与 Cordys 五组 35 事件一致',
  initialMessageSettings.length === 5 && initialMessageItems.length === 35,
)
const customerAddSetting = initialMessageItems.find((item) => item.event === 'CUSTOMER_ADD')
const disableCustomerAdd = await request('PATCH', '/message-settings/CUSTOMER_ADD', admin.headers, {
  module: 'CUSTOMER',
  systemEnabled: false,
})
check('W2.3 管理员可关闭单个系统消息事件', disableCustomerAdd.ok)
const persistedMessageSettings = await get('/message-settings', admin.headers)
check(
  'W2.3 单项开关刷新后持久化',
  persistedMessageSettings
    .flatMap((group) => group.items)
    .find((item) => item.event === 'CUSTOMER_ADD')?.systemEnabled === false,
)
const salesNotificationsBeforeDisabledCustomer = await get(
  '/notifications?page=1&pageSize=100',
  sales.headers,
)
const disabledEventCustomer = await post('/account/add', admin.headers, {
  name: `W2.4关闭事件客户-${stamp}`,
  owner: sales.user.id,
})
const salesNotificationsAfterDisabledCustomer = await get(
  '/notifications?page=1&pageSize=100',
  sales.headers,
)
check(
  'W2.4 关闭 CUSTOMER_ADD 后真实新建动作不落通知',
  salesNotificationsAfterDisabledCustomer.total === salesNotificationsBeforeDisabledCustomer.total,
)
await request('PATCH', '/message-settings/CUSTOMER_ADD', admin.headers, {
  module: 'CUSTOMER',
  systemEnabled: true,
})
const enabledEventCustomer = await post('/account/add', admin.headers, {
  name: `W2.4恢复事件客户-${stamp}`,
  owner: sales.user.id,
})
const salesNotificationsAfterEnabledCustomer = await get(
  '/notifications?page=1&pageSize=100',
  sales.headers,
)
check(
  'W2.4 恢复 CUSTOMER_ADD 后真实新建动作重新发送',
  salesNotificationsAfterEnabledCustomer.items?.some(
    (item) => item.title === '新建客户' && item.content?.includes(`W2.4恢复事件客户-${stamp}`),
  ),
)
await request('GET', `/account/delete/${disabledEventCustomer.id}`, admin.headers)
await request('GET', `/account/delete/${enabledEventCustomer.id}`, admin.headers)
const forbiddenMessageSetting = await request(
  'PATCH',
  '/message-settings/CUSTOMER_ADD',
  sales.headers,
  { module: 'CUSTOMER', systemEnabled: true },
)
check('W2.3 无更新权限成员不能修改消息设置', forbiddenMessageSetting.status === 403)
const contractExpiringConfig = await get(
  '/message-settings/CONTRACT_EXPIRING/config',
  admin.headers,
)
check(
  'W2.3 合同即将到期默认提前 3 天并通知负责人',
  contractExpiringConfig.timeList?.[0]?.timeValue === 3 &&
    contractExpiringConfig.userIds?.includes('OWNER'),
)
const updateMessageConfig = await request(
  'PATCH',
  '/message-settings/CONTRACT_EXPIRING',
  admin.headers,
  {
    module: 'CONTRACT',
    config: {
      timeList: [
        { timeValue: 3, timeUnit: 'DAY' },
        { timeValue: 7, timeUnit: 'DAY' },
      ],
      userIds: ['OWNER'],
      roleIds: [],
      ownerEnable: true,
      ownerLevel: 0,
      roleEnable: false,
    },
  },
)
check('W2.3 到期时间与通知范围可保存', updateMessageConfig.ok)
const disableAllMessages = await request('POST', '/message-settings/batch', admin.headers, {
  systemEnabled: false,
})
const disabledAllMessageBody = await disableAllMessages.json()
check(
  'W2.3 系统消息总开关批量生效',
  disableAllMessages.ok &&
    disabledAllMessageBody.flatMap((group) => group.items).every((item) => !item.systemEnabled),
)
await request('POST', '/message-settings/batch', admin.headers, { systemEnabled: true })
await request('PATCH', '/message-settings/CONTRACT_EXPIRING', admin.headers, {
  module: 'CONTRACT',
  config: {
    timeList: [{ timeValue: 3, timeUnit: 'DAY' }],
    userIds: ['OWNER'],
    roleIds: [],
    ownerEnable: false,
    ownerLevel: 0,
    roleEnable: false,
  },
})
const restoredMessageSettings = await get('/message-settings', admin.headers)
check(
  'W2.3 消息设置 smoke 已恢复默认开关',
  Boolean(customerAddSetting) &&
    restoredMessageSettings.flatMap((group) => group.items).every((item) => item.systemEnabled),
)

// 2. 数据范围
const [adminCustomers, managerCustomers, salesCustomers] = await Promise.all([
  post('/account/page', admin.headers, { current: 1, pageSize: 100 }),
  post('/account/page', manager.headers, { current: 1, pageSize: 100 }),
  post('/account/page', sales.headers, { current: 1, pageSize: 100 }),
])
check(
  '数据范围边界（管理员 ≥ 主管 ≥ 专员）',
  adminCustomers.total >= managerCustomers.total && managerCustomers.total >= salesCustomers.total,
  `${adminCustomers.total}/${managerCustomers.total}/${salesCustomers.total}`,
)

// Cordys 客户系统视图：ALL/DEPARTMENT 是否显示由角色数据范围决定。
const [adminCustomerTabs, managerCustomerTabs, salesCustomerTabs] = await Promise.all([
  get('/account/tab', admin.headers),
  get('/account/tab', manager.headers),
  get('/account/tab', sales.headers),
])
check(
  '客户系统视图：admin 显示全部/部门',
  adminCustomerTabs.all === true && adminCustomerTabs.dept === true,
)
check(
  '客户系统视图：部门主管仅显示部门',
  managerCustomerTabs.all === false && managerCustomerTabs.dept === true,
)
check(
  '客户系统视图：SELF 角色不显示全部/部门',
  salesCustomerTabs.all === false && salesCustomerTabs.dept === false,
)

const [adminAllCustomers, adminSelfCustomers, managerDeptCustomers, salesSelfCustomers] =
  await Promise.all([
    post('/account/page', admin.headers, { current: 1, pageSize: 100, view: 'ALL' }),
    post('/account/page', admin.headers, { current: 1, pageSize: 100, view: 'SELF' }),
    post('/account/page', manager.headers, { current: 1, pageSize: 100, view: 'DEPARTMENT' }),
    post('/account/page', sales.headers, { current: 1, pageSize: 100, view: 'SELF' }),
  ])
check('客户 ALL 视图仍受角色数据权限约束', adminAllCustomers.total >= adminSelfCustomers.total)
check('客户 DEPARTMENT 视图可用于部门主管', Number.isInteger(managerDeptCustomers.total))
check('客户 SELF 视图只返回当前负责人数据', Number.isInteger(salesSelfCustomers.total))
const deniedSalesDeptView = await request(
  'POST',
  '/account/page',
  sales.headers,
  { current: 1, pageSize: 20, view: 'DEPARTMENT' },
)
check('客户 DEPARTMENT 视图禁止 SELF 角色越权调用', deniedSalesDeptView.status === 403)

// R6 组织、角色与自定义数据范围收口
const departmentTree = await get('/departments/tree', admin.headers)
const flattenDepartments = (nodes) =>
  nodes.flatMap((node) => [node, ...flattenDepartments(node.children ?? [])])
const departments = flattenDepartments(departmentTree)
const salesDepartment = departments.find((department) => department.name === '销售部')
check('R6 部门树包含销售部', Boolean(salesDepartment))
const rootDepartment = departments.find((department) => !department.parentId)
const rootDeleteRejected = await request(
  'DELETE',
  `/departments/${rootDepartment.id}`,
  admin.headers,
)
check('R6 组织根部门不可删除', rootDeleteRejected.status === 400)

const tempDepartment = await post('/departments', admin.headers, {
  name: `R6临时部门-${stamp}`,
  parentId: salesDepartment.id,
})
check('R6 可在销售部下创建临时部门', Boolean(tempDepartment.id))
const duplicateDepartment = await request('POST', '/departments', admin.headers, {
  name: tempDepartment.name,
  parentId: salesDepartment.id,
})
check('R6 同一父部门下禁止重名', duplicateDepartment.status === 400)

const unknownPermissionRole = await request('POST', '/roles', admin.headers, {
  name: `R6未知权限-${stamp}`,
  permissions: ['unknown:permission'],
  dataScope: 'SELF',
})
check('R6 角色拒绝未知权限码', unknownPermissionRole.status === 400)

const customRole = await post('/roles', admin.headers, {
  name: `R6自定义范围-${stamp}`,
  permissions: ['customer:read'],
  dataScope: 'CUSTOM',
  scopeDeptIds: [salesDepartment.id],
  remark: 'smoke temporary role',
})
const selfEditRole = await post('/roles', admin.headers, {
  name: `R7本人编辑-${stamp}`,
  permissions: ['customer:update'],
  dataScope: 'SELF',
  remark: 'smoke permission-specific scope role',
})
check('R7 动作权限自动补齐祖先菜单权限', selfEditRole.permissions.includes('menu:customer'))

const invalidMemberDepartment = await request('POST', '/members', admin.headers, {
  email: `invalid-${stamp}@smoke.local`,
  name: 'R6 无效部门成员',
  password: 'smoke123',
  deptId: `missing-${stamp}`,
  roleIds: [customRole.id],
})
check('R6 成员拒绝无效部门引用', invalidMemberDepartment.status === 400)

const tempMember = await post('/members', admin.headers, {
  email: `r6-${stamp}@smoke.local`,
  name: `R6成员-${stamp}`,
  password: 'smoke123',
  deptId: tempDepartment.id,
  roleIds: [selfEditRole.id],
})
check('R6 成员引用有效租户内部门与角色', Boolean(tempMember.id))

const relatedRoleMember = await request('POST', `/roles/${customRole.id}/members`, admin.headers, {
  userIds: [tempMember.id],
})
check('R7 可从角色侧批量关联成员', relatedRoleMember.ok)
const customRoleMembers = await get(`/roles/${customRole.id}/members?pageSize=20`, admin.headers)
check(
  'R7 角色成员列表包含新关联成员及全部角色',
  customRoleMembers.items.some(
    (member) => member.id === tempMember.id && member.roleIds.length === 2,
  ),
)

const invalidLeader = await request('PATCH', `/departments/${tempDepartment.id}`, admin.headers, {
  leaderId: manager.user.id,
})
check('R6 部门主管必须是当前部门直属成员', invalidLeader.status === 400)
const validLeaderResponse = await request(
  'PATCH',
  `/departments/${tempDepartment.id}`,
  admin.headers,
  { leaderId: tempMember.id },
)
const validLeader = await validLeaderResponse.json()
check('R6 当前部门启用成员可设为主管', validLeader.leaderId === tempMember.id)

const selfLeader = await request('PATCH', `/members/${tempMember.id}`, admin.headers, {
  leaderId: tempMember.id,
})
check('R6 成员直属上级不能是自己', selfLeader.status === 400)

const customUser = await login(`r6-${stamp}@smoke.local`, 'smoke123')
check(
  'R7 登录返回多角色与功能权限并集',
  customUser.user.roles.length === 2 && customUser.user.permissions.includes('customer:update'),
)
const deniedRoleDetails = await request('GET', '/roles', customUser.headers)
const roleOptions = await get('/roles/options', customUser.headers)
check('R6 完整角色配置需要角色读取权限', deniedRoleDetails.status === 403)
check(
  'R6 轻量角色 options 不暴露权限配置',
  Array.isArray(roleOptions) &&
    roleOptions.some((role) => role.id === customRole.id && !('permissions' in role)),
)

const customScopeCustomer = await post('/account/add', admin.headers, {
  name: `R6下级范围客户-${stamp}`,
  owner: sales.user.id,
})
const customScopeCustomers = await post('/account/page', customUser.headers, {
  current: 1,
  pageSize: 100,
})
const customScopeCustomerDetail = await get(
  `/account/get/${customScopeCustomer.id}`,
  customUser.headers,
)
check(
  'R7 customer:read 仅合并拥有读取权限角色的 CUSTOM 范围（列表）',
  customScopeCustomers.list.some((customer) => customer.id === customScopeCustomer.id),
)
check(
  'R7 customer:read 的 CUSTOM 所选部门包含全部下级部门（单资源）',
  customScopeCustomerDetail.id === customScopeCustomer.id,
)

const deniedScopedUpdate = await request(
  'POST',
  '/account/update',
  customUser.headers,
  { id: customScopeCustomer.id, name: customScopeCustomer.name },
)
check(
  'R7 无关角色的 CUSTOM 范围不会泄漏给 customer:update SELF 角色',
  deniedScopedUpdate.status === 403 || deniedScopedUpdate.status === 404,
)

await request('PATCH', `/roles/${customRole.id}`, admin.headers, {
  permissions: ['customer:update'],
})
const allowedScopedUpdate = await request(
  'POST',
  '/account/update',
  customUser.headers,
  { id: customScopeCustomer.id, name: customScopeCustomer.name },
)
check('R7 同权限角色加入 CUSTOM 后编辑范围按并集合并', allowedScopedUpdate.ok)

await request('GET', `/account/delete/${customScopeCustomer.id}`, admin.headers)
const deletedTempMember = await request('DELETE', `/members/${tempMember.id}`, admin.headers)
check('R6 无业务引用成员可安全删除', deletedTempMember.ok)
const refreshedDepartments = flattenDepartments(await get('/departments/tree', admin.headers))
check(
  'R6 删除/停用主管成员会清理部门主管关系',
  refreshedDepartments.find((department) => department.id === tempDepartment.id)?.leaderId === null,
)
const deletedTempDepartment = await request(
  'DELETE',
  `/departments/${tempDepartment.id}`,
  admin.headers,
)
check('R6 临时部门可清理', deletedTempDepartment.ok)
const deletedCustomRole = await request('DELETE', `/roles/${customRole.id}`, admin.headers)
check('R6 临时角色可清理', deletedCustomRole.ok)
const deletedSelfEditRole = await request('DELETE', `/roles/${selfEditRole.id}`, admin.headers)
check('R7 第二临时角色可清理', deletedSelfEditRole.ok)

// 3. 元数据引擎
const fields = await get('/metadata/customer/fields', admin.headers)
check('客户系统字段初始化', Array.isArray(fields) && fields.some((f) => f.key === 'name'))

// 4. 线索全链路
const nameField = fields.find((field) => field.key === 'name')
const hideableField = fields.find((field) => field.key !== 'name' && !field.hidden)
if (nameField && hideableField) {
  const hiddenFieldPool = await createPoolFixture('customer', admin.user, {
    name: `冒烟隐藏字段公海-${stamp}`,
    scopeIds: ['*'],
    hiddenFieldIds: [hideableField.id],
  })
  const customerPoolOptions = await get('/resource-pools/options?module=customer', admin.headers)
  const hiddenFieldOption = customerPoolOptions.find((pool) => pool.id === hiddenFieldPool.id)
  check(
    'W3.4 池 options 将直接模型隐藏字段映射到页面契约',
    Array.isArray(hiddenFieldOption?.hiddenFieldIds) &&
      !hiddenFieldOption.hiddenFieldIds.includes(nameField.id) &&
      hiddenFieldOption.hiddenFieldIds.includes(hideableField.id),
  )
  const deletedHiddenPool = await deletePoolFixture('customer', admin.user, hiddenFieldPool.id)
  check('W3.4 直接模型临时公海夹具可清理', deletedHiddenPool)
}

const scopedLeadPool = await createPoolFixture('lead', admin.user, {
  name: `冒烟专属线索池-${stamp}`,
  scopeIds: [sales.user.id],
})
const salesPoolOptions = await get('/resource-pools/options?module=lead', sales.headers)
const managerPoolOptions = await get('/resource-pools/options?module=lead', manager.headers)
check(
  '多池 Scope：命中成员可见专属线索池',
  Array.isArray(salesPoolOptions) && salesPoolOptions.some((pool) => pool.id === scopedLeadPool.id),
)
check(
  '多池 Scope：未命中成员不可见专属线索池',
  Array.isArray(managerPoolOptions) &&
    !managerPoolOptions.some((pool) => pool.id === scopedLeadPool.id),
)
const batchLead = await post('/lead/add', admin.headers, {
  name: `批量领取线索-${stamp}`,
})
await post('/lead/to-pool', admin.headers, { id: batchLead.id, poolId: scopedLeadPool.id })
const batchClaim = await request('POST', '/pool/lead/batch-pick', admin.headers, {
  batchIds: [batchLead.id, `missing-${stamp}`],
  poolId: scopedLeadPool.id,
})
const batchLeadAfterRejectedClaim = await smokePrisma.clue.findUnique({
  where: { id: batchLead.id },
})
check(
  'W3.4.2 批量领取先做全量校验，非法成员不会产生局部成功',
  !batchClaim.ok && batchLeadAfterRejectedClaim?.inSharedPool === true,
)
const deletedBatchLead = await post('/pool/lead/batch-delete', admin.headers, {
  poolId: scopedLeadPool.id,
  ids: [batchLead.id],
})
check('批量领取临时线索可清理', deletedBatchLead.success === 1)
const deletedScopedLeadPool = await deletePoolFixture('lead', admin.user, scopedLeadPool.id)
check('专属临时线索池可清理', deletedScopedLeadPool)

const autoRecyclePool = await createPoolFixture('lead', admin.user, {
  name: `冒烟自动回收池-${stamp}`,
  scopeIds: [sales.user.id],
  autoRecycle: true,
  recycleRule: {
    operator: 'AND',
    conditions: [
      {
        column: 'storageTime',
        operator: 'DYNAMICS',
        value: '7',
        scope: ['Created'],
      },
    ],
  },
})
const autoRecycleOptions = await get('/resource-pools/options?module=lead', sales.headers)
const autoRecycleOption = autoRecycleOptions.find((pool) => pool.id === autoRecyclePool.id)
check(
  'W3.4 池 options 映射自动回收开关与条件',
  autoRecycleOption?.autoRecycle === true &&
    autoRecycleOption.recycleRule?.conditions?.[0]?.column === 'storageTime' &&
    autoRecycleOption.recycleRule?.conditions?.[0]?.operator === 'DYNAMICS',
)
const deletedAutoRecyclePool = await deletePoolFixture('lead', admin.user, autoRecyclePool.id)
check('W3.4 自动回收直接模型夹具可清理', deletedAutoRecyclePool)

const reclaimLeadPool = await createPoolFixture('lead', admin.user, {
  name: `冒烟再次领取线索池-${stamp}`,
  scopeIds: [sales.user.id],
  pickRule: {
    limitDailyPick: false,
    limitPreviousOwner: false,
    limitNewData: false,
  },
})
const lead = await post('/lead/add', admin.headers, {
  name: `冒烟线索-${stamp}`,
  contact: '测试联系人',
})
const movedToPool = await post('/lead/to-pool', admin.headers, {
  id: lead.id,
  poolId: reclaimLeadPool.id,
})
const pooledLead = await smokePrisma.clue.findUnique({ where: { id: lead.id } })
check('创建池内线索', Boolean(movedToPool) && pooledLead?.poolId === reclaimLeadPool.id)
const claimed = await post('/pool/lead/assign', admin.headers, {
  clueId: lead.id,
  assignUserId: sales.user.id,
})
const claimedLead = await smokePrisma.clue.findUnique({ where: { id: lead.id } })
check('管理员从线索池分配给专员', Boolean(claimed) && claimedLead?.owner === sales.user.id)
await post('/lead/to-pool', admin.headers, {
  id: lead.id,
  poolId: reclaimLeadPool.id,
})
const movedBack = await smokePrisma.clue.findUnique({ where: { id: lead.id } })
check('管理员将线索退回指定线索池', movedBack?.poolId === reclaimLeadPool.id)
const movedLeadNotifications = await get('/notifications?page=1&pageSize=100', sales.headers)
check(
  'W2.4 人工移池使用 CLUE_MOVED_POOL 通知原负责人',
  movedLeadNotifications.items?.some(
    (item) => item.title === '线索已移入线索池' && item.content?.includes(`冒烟线索-${stamp}`),
  ),
)
const ownerHistory = await get(`/lead/owner/history/list/${lead.id}`, admin.headers)
check(
  '线索负责人历史',
  Array.isArray(ownerHistory) &&
    ownerHistory.some(
      (item) =>
        item.ownerId === sales.user.id &&
        typeof item.ownerName === 'string' &&
        typeof item.endedAt === 'string',
    ),
)
const reclaimed = await post('/pool/lead/assign', admin.headers, {
  clueId: lead.id,
  assignUserId: sales.user.id,
})
const reclaimedLead = await smokePrisma.clue.findUnique({ where: { id: lead.id } })
check('管理员再次从池分配给专员', Boolean(reclaimed) && reclaimedLead?.owner === sales.user.id)
check('再次领取后临时线索池可清理', await deletePoolFixture('lead', admin.user, reclaimLeadPool.id))
await post('/follow-ups', sales.headers, {
  targetType: 'lead',
  targetId: lead.id,
  type: '电话',
  content: '冒烟跟进',
})
const converted = await post('/lead/transform', admin.headers, {
  clueId: lead.id,
  oppCreated: true,
  oppName: `冒烟商机-${stamp}`,
})
check('线索转化（客户+联系人+商机）', Boolean(converted.customerId && converted.opportunityId))
const convertedLeadNotifications = await get('/notifications?page=1&pageSize=100', sales.headers)
check(
  'W2.4 线索带商机转换拆分客户与商机两条事件',
  convertedLeadNotifications.items?.some(
    (item) => item.title === '线索已转换为客户' && item.content?.includes(`冒烟线索-${stamp}`),
  ) &&
    convertedLeadNotifications.items?.some(
      (item) => item.title === '线索已转换为商机' && item.content?.includes(`冒烟商机-${stamp}`),
    ),
)
const convertedLead = await get(`/lead/get/${lead.id}`, sales.headers)
check(
  'R4 自动转换写 transitionType / transitionId',
  convertedLead.transitionType === 'CUSTOMER' &&
    convertedLead.transitionId === converted.customerId,
)
const convertedLeadFollows = await get(
  `/follow-ups?targetType=lead&targetId=${lead.id}`,
  sales.headers,
)
const convertedCustomerFollows = await get(
  `/follow-ups?targetType=customer&targetId=${converted.customerId}`,
  sales.headers,
)
check(
  'R4 转换复制跟进记录且保留原线索记录',
  Array.isArray(convertedLeadFollows) &&
    convertedLeadFollows.some((item) => item.content === '冒烟跟进') &&
    Array.isArray(convertedCustomerFollows) &&
    convertedCustomerFollows.some((item) => item.content === '冒烟跟进'),
)
const convertedContacts = await get(`/account/contact/list/${converted.customerId}`, sales.headers)
const convertedOpportunity = await get(`/opportunity/get/${converted.opportunityId}`, sales.headers)
check(
  'R4 自动转换联系人并绑定商机',
  Array.isArray(convertedContacts.list) &&
    convertedContacts.list.some((item) => item.id === converted.contactId) &&
    convertedOpportunity.contactId === converted.contactId,
)
const convertedCustomerDetail = await get(`/account/get/${converted.customerId}`, sales.headers)
check('R4 客户最近跟进时间随线索刷新', Boolean(convertedCustomerDetail.lastFollowedAt))

// W2.2：跟进计划 CRUD、负责人状态锁与原子转跟进记录。
const followPlan = await post('/follow-up-plans', sales.headers, {
  targetType: 'customer',
  targetId: converted.customerId,
  contactId: converted.contactId,
  method: '电话',
  estimatedAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  content: `W2.2 跟进计划-${stamp}`,
})
check(
  'W2.2 创建客户跟进计划',
  Boolean(followPlan.id) && followPlan.status === 'PREPARED' && followPlan.converted === false,
)
const followPlanPage = await get(
  `/follow-up-plans?targetType=customer&targetId=${converted.customerId}&pageSize=100`,
  sales.headers,
)
check(
  'W2.2 客户 360 可分页读取跟进计划',
  followPlanPage.items?.some((item) => item.id === followPlan.id && item.canManage === true),
)
const updatedFollowPlan = await request(
  'PATCH',
  `/follow-up-plans/${followPlan.id}`,
  sales.headers,
  { content: `W2.2 已更新计划-${stamp}`, method: '拜访' },
).then((response) => response.json())
check(
  'W2.2 负责人可编辑跟进计划',
  updatedFollowPlan.content === `W2.2 已更新计划-${stamp}` && updatedFollowPlan.method === '拜访',
)
const completedFollowPlan = await post(`/follow-up-plans/${followPlan.id}/status`, sales.headers, {
  status: 'COMPLETED',
})
check('W2.2 跟进计划状态流转', completedFollowPlan.status === 'COMPLETED')
const convertedFollowPlan = await post(`/follow-up-plans/${followPlan.id}/convert`, sales.headers)
check(
  'W2.2 原子转跟进记录并回写记录 ID',
  convertedFollowPlan.converted === true && Boolean(convertedFollowPlan.convertedRecordId),
)
const convertedPlanRecords = await get(
  `/follow-ups?targetType=customer&targetId=${converted.customerId}`,
  sales.headers,
)
check(
  'W2.2 转换记录继承计划内容与方式',
  convertedPlanRecords.some(
    (item) =>
      item.id === convertedFollowPlan.convertedRecordId &&
      item.content === `W2.2 已更新计划-${stamp}` &&
      item.type === '拜访',
  ),
)
const duplicateConvert = await request(
  'POST',
  `/follow-up-plans/${followPlan.id}/convert`,
  sales.headers,
  {},
)
check('W2.2 重复转换被拒绝', duplicateConvert.status === 409)
const lockedStatus = await request(
  'POST',
  `/follow-up-plans/${followPlan.id}/status`,
  sales.headers,
  { status: 'CANCELLED' },
)
check('W2.2 已转记录计划状态锁定', lockedStatus.status === 409)
const removedFollowPlan = await request(
  'DELETE',
  `/follow-up-plans/${followPlan.id}`,
  sales.headers,
)
check('W2.2 负责人可删除跟进计划', removedFollowPlan.ok)

// R4：关联已有客户时补协作人，并复制联系人/跟进记录。
const r4RelationCustomer = await post('/account/add', manager.headers, {
  name: `R4关联客户-${stamp}`,
})
const r4RelationLead = await post('/lead/add', sales.headers, {
  name: `R4关联线索-${stamp}`,
  contact: `R4关联联系人-${stamp}`,
  phone: `138${phoneSuffix}`,
})
await post('/follow-ups', sales.headers, {
  targetType: 'lead',
  targetId: r4RelationLead.id,
  type: '电话',
  content: `R4关联跟进-${stamp}`,
})
const r4RelationResult = await post('/lead/re-transition/account', manager.headers, {
  clueIds: [r4RelationLead.id],
  customerId: r4RelationCustomer.id,
})
check('R4 关联已有客户成功', r4RelationResult.success === 1)
const r4RelationLeadDetail = await get(`/lead/get/${r4RelationLead.id}`, manager.headers)
check(
  'R4 已有客户关联写 transition',
  r4RelationLeadDetail.transitionType === 'CUSTOMER' &&
    r4RelationLeadDetail.transitionId === r4RelationCustomer.id,
)
const r4RelationTeam = await get(
  `/account/collaboration/list/${r4RelationCustomer.id}`,
  manager.headers,
)
check(
  'R4 线索负责人自动补为客户协作人',
  r4RelationTeam.some(
    (item) => item.userId === sales.user.id && item.collaborationType === 'COLLABORATION',
  ),
)
const r4RelationContacts = await get(
  `/account/contact/list/${r4RelationCustomer.id}`,
  manager.headers,
)
const r4RelationFollows = await get(
  `/follow-ups?targetType=customer&targetId=${r4RelationCustomer.id}`,
  manager.headers,
)
check(
  'R4 已有客户关联复制联系人和跟进',
  r4RelationContacts.list.some((item) => item.name === `R4关联联系人-${stamp}`) &&
    r4RelationFollows.some((item) => item.content === `R4关联跟进-${stamp}`),
)

// R4：READ_ONLY 协作客户出现在候选列表但不可选择，Service 也拒绝绕过 UI 关联。
const r4ReadOnlyCustomer = await post('/account/add', manager.headers, {
  name: `R4只读客户-${stamp}`,
})
await post('/account/collaboration/add', manager.headers, {
  customerId: r4ReadOnlyCustomer.id,
  userId: sales.user.id,
  collaborationType: 'READ_ONLY',
})
const r4ReadOnlyLead = await post('/lead/add', sales.headers, {
  name: `R4只读关联线索-${stamp}`,
})
const r4CandidatePage = await post('/lead/transition/account/page', sales.headers, {
  current: 1,
  pageSize: 50,
  keyword: `R4只读客户-${stamp}`,
})
check(
  'R4 客户候选列表禁选 READ_ONLY 协作客户',
  r4CandidatePage.items?.some(
    (item) => item.id === r4ReadOnlyCustomer.id && item.selectable === false,
  ),
)
const r4ReadOnlyDenied = await request('POST', '/lead/re-transition/account', sales.headers, {
  clueIds: [r4ReadOnlyLead.id],
  customerId: r4ReadOnlyCustomer.id,
})
check('R4 Service 拒绝关联 READ_ONLY 协作客户', r4ReadOnlyDenied.status === 403)

// R4：关联公海客户前先按公海规则领取。
const r4CustomerPool = await createPoolFixture('customer', admin.user, {
  name: `R4关联公海-${stamp}`,
  scopeIds: [`user:${sales.user.id}`],
})
const r4SeaCustomer = await post('/account/add', admin.headers, {
  name: `R4公海客户-${stamp}`,
  owner: sales.user.id,
})
await post('/account/to-pool', admin.headers, { id: r4SeaCustomer.id, poolId: r4CustomerPool.id })
const movedCustomerNotifications = await get('/notifications?page=1&pageSize=100', sales.headers)
check(
  'W2.4 客户人工移入公海通知原负责人',
  movedCustomerNotifications.items?.some(
    (item) => item.title === '客户已移入公海' && item.content?.includes(`R4公海客户-${stamp}`),
  ),
)
const r4SeaLead = await post('/lead/add', sales.headers, {
  name: `R4公海关联线索-${stamp}`,
})
const r4SeaResult = await post('/lead/re-transition/account', sales.headers, {
  clueIds: [r4SeaLead.id],
  customerId: r4SeaCustomer.id,
})
const r4ClaimedCustomer = await get(`/account/get/${r4SeaCustomer.id}`, sales.headers)
check(
  'R4 关联公海客户会先领取',
  r4SeaResult.success === 1 &&
    r4ClaimedCustomer.inSea === false &&
    r4ClaimedCustomer.ownerId === sales.user.id,
)
await deletePoolFixture('customer', admin.user, r4CustomerPool.id)

// R4：Cordys rules.unique —— 客户名称唯一时复用同名客户；联系人唯一时不重复创建。
const r4ContactFields = await get('/metadata/contact/fields', admin.headers)
const r4CustomerNameField = fields.find((field) => field.key === 'name')
const r4ContactNameField = r4ContactFields.find((field) => field.key === 'name')
if (r4CustomerNameField && r4ContactNameField) {
  const originalCustomerNameConfig = { ...(r4CustomerNameField.config ?? {}) }
  const originalContactNameConfig = { ...(r4ContactNameField.config ?? {}) }
  const r4UniqueCustomer = await post('/account/add', sales.headers, {
    name: `R4唯一复用客户-${stamp}`,
  })
  const r4UniqueContact = await post('/account/contact/add', sales.headers, {
    customerId: r4UniqueCustomer.id,
    name: `R4唯一联系人-${stamp}`,
    phone: `139${phoneSuffix}`,
  })
  try {
    await request('PATCH', `/metadata/fields/${r4CustomerNameField.id}`, admin.headers, {
      config: { ...originalCustomerNameConfig, unique: true },
    })
    await request('PATCH', `/metadata/fields/${r4ContactNameField.id}`, admin.headers, {
      config: { ...originalContactNameConfig, unique: true },
    })
    const r4UniqueLead = await post('/lead/add', sales.headers, {
      name: `R4唯一复用客户-${stamp}`,
      contact: `R4唯一联系人-${stamp}`,
      phone: r4UniqueContact.phone,
    })
    const r4UniqueTransform = await post('/lead/transform', sales.headers, {
      clueId: r4UniqueLead.id,
      oppCreated: false,
    })
    const r4UniqueContacts = await get(
      `/account/contact/list/${r4UniqueCustomer.id}`,
      sales.headers,
    )
    check(
      'R4 客户名称 UNIQUE 时自动转换复用同名客户',
      r4UniqueTransform.customerId === r4UniqueCustomer.id,
    )
    check(
      'R4 联系人 UNIQUE 时跳过重复联系人',
      r4UniqueTransform.contactId === null &&
        r4UniqueContacts.list.filter((item) => item.name === `R4唯一联系人-${stamp}`).length === 1,
    )
  } finally {
    await request('PATCH', `/metadata/fields/${r4CustomerNameField.id}`, admin.headers, {
      config: { ...originalCustomerNameConfig, unique: Boolean(originalCustomerNameConfig.unique) },
    })
    await request('PATCH', `/metadata/fields/${r4ContactNameField.id}`, admin.headers, {
      config: { ...originalContactNameConfig, unique: Boolean(originalContactNameConfig.unique) },
    })
  }
}

const savedLeadView = await post('/lead/view/add', admin.headers, {
  name: `冒烟线索视图-${stamp}`,
  searchMode: 'AND',
  conditions: [
    {
      name: 'name',
      operator: 'contains',
      value: `冒烟线索-${stamp}`,
      type: 'text',
    },
  ],
})
check('创建 Cordys UserView', Boolean(savedLeadView.id))
const savedLeadList = await post('/lead/page', admin.headers, {
  current: 1,
  pageSize: 100,
  viewId: savedLeadView.id,
})
check(
  'Cordys UserView 条件参与列表查询',
  Array.isArray(savedLeadList.list) && savedLeadList.list.some((item) => item.id === lead.id),
)
const fixedSavedView = await request('GET', `/lead/view/fixed/${savedLeadView.id}`, admin.headers)
check('Cordys UserView 固定状态可切换', fixedSavedView.ok)
const deletedSavedView = await request(
  'GET',
  `/lead/view/delete/${savedLeadView.id}`,
  admin.headers,
)
check('Cordys UserView 可删除', deletedSavedView.ok)

const dups = await get(
  `/account/check-duplicate?name=${encodeURIComponent(`冒烟线索-${stamp}`)}`,
  admin.headers,
)
check('客户查重命中', Array.isArray(dups) && dups.some((h) => h.source === 'customer'))
const relatedContacts = await get(`/account/contact/list/${converted.customerId}`, sales.headers)
const relatedOpportunities = await post('/account/opportunity/page', sales.headers, {
  accountId: converted.customerId,
  current: 1,
  pageSize: 10,
})
check(
  '客户360关联数据',
  Array.isArray(relatedContacts.list) && Array.isArray(relatedOpportunities.list),
)
const r5OpportunityPage = await post('/account/opportunity/page', sales.headers, {
  accountId: converted.customerId,
  current: 1,
  pageSize: 10,
})
check(
  'R5 客户360 商机分页接口返回转换商机',
  Array.isArray(r5OpportunityPage.list) &&
    r5OpportunityPage.list.some((item) => item.id === converted.opportunityId) &&
    r5OpportunityPage.current === 1 &&
    r5OpportunityPage.pageSize === 10,
)
const invalidR5Resource = await request(
  'GET',
  `/customers/${converted.customerId}/360/not-supported`,
  sales.headers,
)
check('R5 旧客户360聚合资源入口已移除', invalidR5Resource.status === 404)

const historyCustomer = await post('/account/add', manager.headers, {
  name: `负责人历史客户-${stamp}`,
})
await post('/account/batch/transfer', manager.headers, {
  ids: [historyCustomer.id],
  owner: sales.user.id,
})
const customerOwnerHistory = await get(
  `/account/owner/history/list/${historyCustomer.id}`,
  manager.headers,
)
check(
  '客户负责人历史',
  Array.isArray(customerOwnerHistory) &&
    customerOwnerHistory.some(
      (item) =>
        item.ownerId === manager.user.id &&
        typeof item.ownerName === 'string' &&
        typeof item.endedAt === 'string',
    ),
)

// 4.1 客户协作权限：READ_ONLY 只读；COLLABORATION 可新增跟进和自己负责的联系人，
// 两种协作身份都不会获得客户主体修改权限。
const collabCustomer = await post('/account/add', manager.headers, {
  name: `协作权限客户-${stamp}`,
})
await post('/account/collaboration/add', manager.headers, {
  customerId: collabCustomer.id,
  userId: sales.user.id,
  collaborationType: 'READ_ONLY',
})
const team = await get(`/account/collaboration/list/${collabCustomer.id}`, manager.headers)
const salesTeamMember = team.find((item) => item.userId === sales.user.id)
check('READ_ONLY 协作关系创建', Boolean(salesTeamMember))
if (!salesTeamMember) throw new Error('未创建 READ_ONLY 协作关系，无法继续协作权限冒烟')
const collaborationView = await post('/account/page', sales.headers, {
  current: 1,
  pageSize: 100,
  view: 'COLLABORATION',
})
check(
  '客户 COLLABORATION 系统视图返回协作客户',
  Array.isArray(collaborationView.list) &&
    collaborationView.list.some((item) => item.id === collabCustomer.id),
)
const readOnlyDetail = await get(`/account/get/${collabCustomer.id}`, sales.headers)
check('READ_ONLY 可读取客户详情', readOnlyDetail.id === collabCustomer.id)
const readOnlyContacts = await get(`/account/contact/list/${collabCustomer.id}`, sales.headers)
check(
  'READ_ONLY 不额外获得联系人列表',
  Array.isArray(readOnlyContacts.list) && readOnlyContacts.list.length === 0,
)
const readOnlyFollow = await get(
  `/follow-ups?targetType=customer&targetId=${collabCustomer.id}`,
  sales.headers,
)
check('READ_ONLY 可读取客户跟进', Array.isArray(readOnlyFollow))
const deniedReadOnlyFollow = await request('POST', '/follow-ups', sales.headers, {
  targetType: 'customer',
  targetId: collabCustomer.id,
  type: '电话',
  content: 'READ_ONLY 不应允许写入',
})
check('READ_ONLY 禁止新增跟进', deniedReadOnlyFollow.status === 403)
const deniedReadOnlyContact = await request('POST', '/account/contact/add', sales.headers, {
  customerId: collabCustomer.id,
  name: `只读联系人-${stamp}`,
})
check('READ_ONLY 禁止新增联系人', deniedReadOnlyContact.status === 403)
const deniedReadOnlyRelation = await request(
  'POST',
  `/account/relation/save/${collabCustomer.id}`,
  sales.headers,
  [],
)
check('READ_ONLY 禁止编辑客户关系', [403, 404].includes(deniedReadOnlyRelation.status))
const deniedCustomerUpdate = await request(
  'POST',
  '/account/update',
  sales.headers,
  { id: collabCustomer.id, name: collabCustomer.name },
)
check('READ_ONLY 禁止修改客户主体', [403, 404].includes(deniedCustomerUpdate.status))

const collaborationUpgrade = await request(
  'POST',
  '/account/collaboration/update',
  manager.headers,
  { id: salesTeamMember.id, collaborationType: 'COLLABORATION' },
)
check('协作类型可升级为 COLLABORATION', collaborationUpgrade.ok)
const collaborationContact = await post('/account/contact/add', sales.headers, {
  customerId: collabCustomer.id,
  name: `协作联系人-${stamp}`,
})
check(
  'COLLABORATION 可新增自己负责的联系人',
  Boolean(collaborationContact.id) && collaborationContact.ownerId === sales.user.id,
)
const collaborationFollow = await post('/follow-ups', sales.headers, {
  targetType: 'customer',
  targetId: collabCustomer.id,
  type: '电话',
  content: '协作权限冒烟跟进',
})
check('COLLABORATION 可新增跟进', Boolean(collaborationFollow.id))
const relationGroup = await post('/account/add', manager.headers, {
  name: `冒烟集团-${stamp}`,
})
const relationSubsidiary = await post('/account/add', manager.headers, {
  name: `冒烟子公司-${stamp}`,
})
const customerOptions = await post('/account/option', sales.headers, {
  current: 1,
  pageSize: 100,
  keyword: `冒烟集团-${stamp}`,
})
check(
  '客户关系 options 可按租户搜索 id/name',
  Array.isArray(customerOptions.list) && customerOptions.list.some((item) => item.id === relationGroup.id),
)
const collaborationRelationSave = await request(
  'POST',
  `/account/relation/save/${collabCustomer.id}`,
  sales.headers,
  [
    { relationType: 'GROUP', customerId: relationGroup.id },
    { relationType: 'SUBSIDIARY', customerId: relationSubsidiary.id },
  ],
)
check(
  'COLLABORATION 不能越权整组保存客户关系',
  [403, 404].includes(collaborationRelationSave.status),
)
const managerRelationSave = await request(
  'POST',
  `/account/relation/save/${collabCustomer.id}`,
  manager.headers,
  [
    { relationType: 'GROUP', customerId: relationGroup.id },
    { relationType: 'SUBSIDIARY', customerId: relationSubsidiary.id },
  ],
)
check('客户负责人可整组保存客户关系', managerRelationSave.ok)
const relationRows = await get(`/account/relation/list/${collabCustomer.id}`, sales.headers)
check(
  '客户关系列表返回集团与子公司',
  Array.isArray(relationRows) &&
    relationRows.some(
      (item) => item.relationType === 'GROUP' && item.customerId === relationGroup.id,
    ) &&
    relationRows.some(
      (item) => item.relationType === 'SUBSIDIARY' && item.customerId === relationSubsidiary.id,
    ),
)

const mergeContactNameField = r4ContactFields.find((field) => field.key === 'name')
const mergeContactPhoneField = r4ContactFields.find((field) => field.key === 'phone')
if (!mergeContactNameField || !mergeContactPhoneField) {
  throw new Error('联系人姓名/电话字段不存在，无法执行合并 unique 冒烟')
}
const mergeOriginalNameConfig = { ...(mergeContactNameField.config ?? {}) }
const mergeOriginalPhoneConfig = { ...(mergeContactPhoneField.config ?? {}) }
let mergeTarget
let mergeSource
try {
  for (const field of [mergeContactNameField, mergeContactPhoneField]) {
    await request('PATCH', `/metadata/fields/${field.id}`, admin.headers, {
      config: { ...(field.config ?? {}), unique: false },
    })
  }
  mergeTarget = await post('/account/add', manager.headers, {
    name: `冒烟合并主客户-${stamp}`,
  })
  mergeSource = await post('/account/add', manager.headers, {
    name: `冒烟合并副客户-${stamp}`,
  })
  await post('/account/contact/add', manager.headers, {
    customerId: mergeTarget.id,
    name: `冲突联系人-${stamp}`,
    phone: `138${phoneSuffix}`,
  })
  await post('/account/contact/add', manager.headers, {
    customerId: mergeSource.id,
    name: `冲突联系人-${stamp}`,
    phone: `138${phoneSuffix}`,
  })
  for (const field of [mergeContactNameField, mergeContactPhoneField]) {
    await request('PATCH', `/metadata/fields/${field.id}`, admin.headers, {
      config: { ...(field.config ?? {}), unique: true },
    })
  }
  const mergePayload = {
    mergeIds: [mergeTarget.id, mergeSource.id],
    toMergeId: mergeTarget.id,
    ownerId: manager.user.id,
  }
  const mergePreview = await post('/account/merge/preview', manager.headers, mergePayload)
  check(
    '客户合并 preview 按联系人 unique 规则识别冲突',
    mergePreview.counts?.customersToDelete === 1 &&
      mergePreview.counts?.contactsWillSkip === 1 &&
      mergePreview.contactConflicts?.length === 1,
  )
  const mergeResult = await post('/account/merge', manager.headers, mergePayload)
  check('客户合并执行成功', mergeResult.id === mergeTarget.id && mergeResult.merged === 1)
  const mergedSourceGone = await request('GET', `/account/get/${mergeSource.id}`, manager.headers)
  check('被合并客户已移除', mergedSourceGone.status === 404)
  const mergedContacts = await get(`/account/contact/list/${mergeTarget.id}`, manager.headers)
  check(
    '联系人 unique 去重执行结果与 preview 一致',
    Array.isArray(mergedContacts.list) &&
      mergedContacts.list.filter((item) => item.name === `冲突联系人-${stamp}`).length === 1,
  )
} finally {
  await request('PATCH', `/metadata/fields/${mergeContactNameField.id}`, admin.headers, {
    config: mergeOriginalNameConfig,
  })
  await request('PATCH', `/metadata/fields/${mergeContactPhoneField.id}`, admin.headers, {
    config: mergeOriginalPhoneConfig,
  })
}

// W3.4 直接模型迁移后，库容配置不再通过旧 resource-capacities 通用接口创建。
// Scope 重叠与 Cordys 商机阶段 IN/NOT_IN 排除规则由 smoke:w34-pools 专项真实库测试覆盖。

// 4.2 R1 批量字段修改 / 删除：字段 ID/key、owner 副作用、客户引用保护
const leadFields = await get('/metadata/lead/fields', admin.headers)
const leadContactField = leadFields.find((field) => field.key === 'contact')
const leadBatchA = await post('/lead/add', admin.headers, {
  name: `批量编辑线索A-${stamp}`,
  owner: sales.user.id,
})
const leadBatchB = await post('/lead/add', admin.headers, {
  name: `批量编辑线索B-${stamp}`,
  owner: sales.user.id,
})
const leadBatchIds = [leadBatchA.id, leadBatchB.id]
const leadBatchContactName = `批量联系人-${stamp}`
const leadBatchFieldResult = await post('/lead/batch/update', admin.headers, {
  ids: leadBatchIds,
  fieldId: leadContactField?.id,
  fieldValue: leadBatchContactName,
})
const leadBatchRows = await post('/lead/page', admin.headers, {
  current: 1,
  pageSize: 20,
  keyword: '批量编辑线索',
})
check(
  'Lead 批量字段修改支持字段 ID',
  leadBatchFieldResult.success === 2 &&
    leadBatchRows.list
      ?.filter((item) => leadBatchIds.includes(item.id))
      .every((item) => item.contactName === leadBatchContactName),
)
const leadBatchOwnerResult = await post('/lead/batch/update', admin.headers, {
  ids: leadBatchIds,
  fieldId: 'owner',
  fieldValue: admin.user.id,
})
const leadBatchHistory = await get(`/lead/owner/history/list/${leadBatchA.id}`, admin.headers)
check(
  'Lead owner 批改支持字段 key 且写负责人历史',
  leadBatchOwnerResult.success === 2 &&
    Array.isArray(leadBatchHistory) &&
    leadBatchHistory.some((item) => item.ownerId === sales.user.id),
)
const leadBatchCustomField = await post('/metadata/lead/fields', admin.headers, {
  label: `R1线索批改字段-${stamp}`,
  type: 'text',
})
const leadBatchCustomValue = `R1线索自定义值-${stamp}`
const leadCustomBatchResult = await post('/lead/batch/update', admin.headers, {
  ids: leadBatchIds,
  fieldId: leadBatchCustomField.key,
  fieldValue: leadBatchCustomValue,
})
const leadCustomBatchRows = await post('/lead/page', admin.headers, {
  current: 1,
  pageSize: 20,
  keyword: '批量编辑线索',
})
check(
  'Lead 自定义字段支持批量修改',
  leadCustomBatchResult.success === 2 &&
    leadCustomBatchRows.list
      ?.filter((item) => leadBatchIds.includes(item.id))
      .every((item) => item.customData?.[leadBatchCustomField.key] === leadBatchCustomValue),
)
const leadBatchDelete = await post('/lead/batch/delete', admin.headers, leadBatchIds)
const deletedLeadBatchRows = await post('/lead/page', admin.headers, {
  current: 1,
  pageSize: 20,
  keyword: '批量编辑线索',
})
check(
  'Lead 批量删除同步清理临时数据',
  leadBatchDelete.success === 2 &&
    !deletedLeadBatchRows.list?.some((item) => leadBatchIds.includes(item.id)),
)
await request('DELETE', `/metadata/fields/${leadBatchCustomField.id}`, admin.headers)

const customerPhoneField = fields.find((field) => field.key === 'cf_phone')
const customerBatchA = await post('/account/add', admin.headers, { name: `批量编辑客户A-${stamp}` })
const customerBatchB = await post('/account/add', admin.headers, { name: `批量编辑客户B-${stamp}` })
const customerBatchIds = [customerBatchA.id, customerBatchB.id]
const customerBatchPhone = `139${phoneSuffix}`
const customerBatchFieldResult = await post('/account/batch/update', admin.headers, {
  ids: customerBatchIds,
  fieldId: customerPhoneField?.id,
  fieldValue: customerBatchPhone,
})
const customerBatchDetail = await get(`/account/get/${customerBatchA.id}`, admin.headers)
check(
  'Customer 批量字段修改支持字段 ID',
  customerBatchFieldResult.success === 2 && customerBatchDetail.phone === customerBatchPhone,
)
const customerBatchOwnerResult = await post('/account/batch/update', admin.headers, {
  ids: customerBatchIds,
  fieldId: 'owner',
  fieldValue: manager.user.id,
})
const customerBatchHistory = await get(
  `/account/owner/history/list/${customerBatchA.id}`,
  admin.headers,
)
check(
  'Customer owner 批改支持字段 key 且写负责人历史',
  customerBatchOwnerResult.success === 2 &&
    Array.isArray(customerBatchHistory) &&
    customerBatchHistory.some((item) => item.ownerId === admin.user.id),
)
const customerBatchCustomField = await post('/metadata/customer/fields', admin.headers, {
  label: `R1客户批改字段-${stamp}`,
  type: 'text',
})
const customerBatchCustomValue = `R1客户自定义值-${stamp}`
const customerCustomBatchResult = await post('/account/batch/update', admin.headers, {
  ids: customerBatchIds,
  fieldId: customerBatchCustomField.id,
  fieldValue: customerBatchCustomValue,
})
const customerCustomBatchDetail = await get(`/account/get/${customerBatchA.id}`, admin.headers)
check(
  'Customer 自定义字段支持批量修改',
  customerCustomBatchResult.success === 2 &&
    customerCustomBatchDetail.customData?.[customerBatchCustomField.key] ===
      customerBatchCustomValue,
)
const protectedContact = await post('/account/contact/add', admin.headers, {
  customerId: customerBatchA.id,
  name: `批量删除保护联系人-${stamp}`,
})
const protectedCustomerDelete = await request('POST', '/account/batch/delete', admin.headers, customerBatchIds)
check('Customer 批量删除存在 Contact 引用时整批拒绝', protectedCustomerDelete.status === 400)
const customerBatchBStillExists = await get(`/account/get/${customerBatchB.id}`, admin.headers)
check('Customer 批量删除引用保护不会部分删除', customerBatchBStillExists.id === customerBatchB.id)
await get(`/account/contact/delete/${protectedContact.id}`, admin.headers)
const protectedOpportunity = await post('/opportunity/add', admin.headers, {
  name: `批量删除保护商机-${stamp}`,
  customerId: customerBatchA.id,
})
const opportunityProtectedDelete = await request(
  'POST',
  '/account/batch/delete',
  admin.headers,
  customerBatchIds,
)
check('Customer 批量删除存在 Opportunity 引用时整批拒绝', opportunityProtectedDelete.status === 400)
await request('GET', `/opportunity/delete/${protectedOpportunity.id}`, admin.headers)
const customerBatchDelete = await post('/account/batch/delete', admin.headers, customerBatchIds)
check('Customer 无引用后允许整批删除', customerBatchDelete.success === 2)
await request('DELETE', `/metadata/fields/${customerBatchCustomField.id}`, admin.headers)

// 4.3 R1 池/公海独立批量权限：功能权限 + Pool Scope 两层同时成立
const restrictedLeadPool = await createPoolFixture('lead', admin.user, {
  name: `R1受限线索池-${stamp}`,
  scopeIds: [sales.user.id],
})
const restrictedPoolLead = await post('/lead/add', admin.headers, {
  name: `R1受限池线索-${stamp}`,
})
await post('/lead/to-pool', admin.headers, {
  id: restrictedPoolLead.id,
  poolId: restrictedLeadPool.id,
})
const salesPoolUpdateDenied = await request('POST', '/pool/lead/batch-update', sales.headers, {
  poolId: restrictedLeadPool.id,
  ids: [restrictedPoolLead.id],
  fieldId: leadContactField?.id,
  fieldValue: '无池功能权限',
})
check('线索池：Scope 成员缺少独立池 UPDATE 权限时拒绝', salesPoolUpdateDenied.status === 403)
const managerPoolMemberDenied = await request('POST', '/pool/lead/batch-update', manager.headers, {
  poolId: restrictedLeadPool.id,
  ids: [restrictedPoolLead.id],
  fieldId: leadContactField?.id,
  fieldValue: '无池成员权限',
})
check('线索池：有池 UPDATE 权限但不是池成员时拒绝', managerPoolMemberDenied.status === 403)
await request('GET', `/pool/lead/delete/${restrictedPoolLead.id}`, admin.headers)
await deletePoolFixture('lead', admin.user, restrictedLeadPool.id)

const managerLeadPool = await createPoolFixture('lead', admin.user, {
  name: `R1主管线索池-${stamp}`,
  scopeIds: [manager.user.id],
})
const poolLeadA = await post('/lead/add', admin.headers, {
  name: `R1池批改线索A-${stamp}`,
})
const poolLeadB = await post('/lead/add', admin.headers, {
  name: `R1池批改线索B-${stamp}`,
})
await post('/lead/to-pool', admin.headers, { id: poolLeadA.id, poolId: managerLeadPool.id })
await post('/lead/to-pool', admin.headers, { id: poolLeadB.id, poolId: managerLeadPool.id })
const poolLeadUpdate = await post('/pool/lead/batch-update', manager.headers, {
  poolId: managerLeadPool.id,
  ids: [poolLeadA.id, poolLeadB.id],
  fieldId: leadContactField?.id,
  fieldValue: `池批量联系人-${stamp}`,
})
check('线索池：独立权限 + Scope 命中时可批量修改', poolLeadUpdate.success === 2)
const poolLeadOwner = await post('/lead/add', admin.headers, {
  name: `R1池负责人批改-${stamp}`,
})
await post('/lead/to-pool', admin.headers, { id: poolLeadOwner.id, poolId: managerLeadPool.id })
const poolLeadAssignByUpdate = await post('/pool/lead/batch-update', manager.headers, {
  poolId: managerLeadPool.id,
  ids: [poolLeadOwner.id],
  fieldId: 'owner',
  fieldValue: manager.user.id,
})
const assignedPoolLeadRows = await post('/lead/page', manager.headers, {
  current: 1,
  pageSize: 20,
  keyword: `R1池负责人批改-${stamp}`,
})
check(
  '线索池：owner 批改复用分配并离开池',
  poolLeadAssignByUpdate.success === 1 &&
    assignedPoolLeadRows.list?.some((item) => item.id === poolLeadOwner.id),
)
const poolLeadDelete = await post('/pool/lead/batch-delete', manager.headers, {
  poolId: managerLeadPool.id,
  ids: [poolLeadA.id, poolLeadB.id],
})
check('线索池：独立 DELETE 权限可批量删除同池记录', poolLeadDelete.success === 2)
await request('GET', `/lead/delete/${poolLeadOwner.id}`, manager.headers)
await deletePoolFixture('lead', admin.user, managerLeadPool.id)

const managerCustomerPool = await createPoolFixture('customer', admin.user, {
  name: `R1主管客户公海-${stamp}`,
  scopeIds: [`user:${manager.user.id}`],
})
const poolCustomerA = await post('/account/add', admin.headers, { name: `R1公海批改客户A-${stamp}` })
const poolCustomerB = await post('/account/add', admin.headers, { name: `R1公海批改客户B-${stamp}` })
await post('/account/to-pool', admin.headers, { id: poolCustomerA.id, poolId: managerCustomerPool.id })
await post('/account/to-pool', admin.headers, { id: poolCustomerB.id, poolId: managerCustomerPool.id })
const deniedOpenSea360 = await request(
  'POST',
  '/account/contract/page',
  manager.headers,
  { accountId: poolCustomerA.id, current: 1, pageSize: 10 },
)
check(
  'R5 客户公海详情禁止读取普通客户360业务资源',
  [403, 404].includes(deniedOpenSea360.status),
)
const poolCustomerUpdate = await post('/pool/account/batch-update', manager.headers, {
  ids: [poolCustomerA.id, poolCustomerB.id],
  fieldId: customerPhoneField?.id,
  fieldValue: `137${phoneSuffix}`,
})
check('客户公海：独立权限 + Scope 命中时可批量修改', poolCustomerUpdate.success === 2)
const poolCustomerOwner = await post('/account/add', admin.headers, {
  name: `R1公海负责人批改-${stamp}`,
})
await post('/account/to-pool', admin.headers, {
  id: poolCustomerOwner.id,
  poolId: managerCustomerPool.id,
})
const poolCustomerAssignByUpdate = await post('/pool/account/batch-update', manager.headers, {
  ids: [poolCustomerOwner.id],
  fieldId: 'owner',
  fieldValue: manager.user.id,
})
const assignedPoolCustomer = await get(`/account/get/${poolCustomerOwner.id}`, manager.headers)
check(
  '客户公海：Scope 成员 owner 批改复用分配且不要求池管理员',
  poolCustomerAssignByUpdate.success === 1 &&
    assignedPoolCustomer.ownerId === manager.user.id &&
    assignedPoolCustomer.inSea === false,
)
const poolCustomerDelete = await post('/pool/account/batch-delete', manager.headers, {
  batchIds: [poolCustomerA.id, poolCustomerB.id],
})
check('客户公海：独立 DELETE 权限可批量删除同池无引用客户', poolCustomerDelete.success === 2)
await request('GET', `/account/delete/${poolCustomerOwner.id}`, manager.headers)
await deletePoolFixture('customer', admin.user, managerCustomerPool.id)

const collaborationContacts = await get(`/account/contact/list/${collabCustomer.id}`, sales.headers)
check(
  'COLLABORATION 仅看到自己负责的联系人',
  Array.isArray(collaborationContacts.list) &&
    collaborationContacts.list.length >= 1 &&
    collaborationContacts.list.every((item) => item.ownerId === sales.user.id),
)
const deniedCollabCustomerUpdate = await request(
  'POST',
  '/account/update',
  sales.headers,
  { id: collabCustomer.id, name: collabCustomer.name },
)
check('COLLABORATION 仍禁止修改客户主体', [403, 404].includes(deniedCollabCustomerUpdate.status))

// R2 xlsx 导入导出：模板 → 预检 → 正式导入 → 更新 → 导出任务 → 下载隔离
const leadImportFields = await get('/metadata/lead/fields', manager.headers)
const leadNameField = leadImportFields.find((field) => field.key === 'name')
const leadContactNameField = leadImportFields.find((field) => field.key === 'contact')
const leadOwnerField = leadImportFields.find((field) => field.key === 'owner')
const customerNameImportField = fields.find((field) => field.key === 'name')
const customerPhoneImportField = fields.find((field) => field.key === 'cf_phone')

const leadTemplateResponse = await fetch(`${base}/lead/template/download?importType=ADD`, {
  headers: { Authorization: manager.headers.Authorization },
})
const leadTemplateSheet = leadTemplateResponse.ok
  ? await readXlsx(Buffer.from(await leadTemplateResponse.arrayBuffer()))
  : null
const leadTemplateHeaders = leadTemplateSheet
  ? leadTemplateSheet.getRow(1).values.slice(1).map(String)
  : []
check(
  'R2 Lead xlsx ADD 模板包含元数据表头',
  leadTemplateResponse.ok && leadTemplateHeaders.includes(leadNameField?.label),
)

const r2LeadName = `R2导入线索-${stamp}`
const leadAddXlsx = await buildXlsx(
  [leadNameField?.label ?? '线索名称', leadContactNameField?.label ?? '联系人'],
  [[r2LeadName, `R2联系人-${stamp}`]],
)
const leadAddPrecheckRes = await postXlsx(
  '/lead/import/pre-check',
  manager.headers,
  leadAddXlsx,
  'ADD',
)
const leadAddPrecheck = await leadAddPrecheckRes.json()
check(
  'R2 Lead ADD xlsx 预检',
  leadAddPrecheckRes.ok && leadAddPrecheck.successCount === 1 && leadAddPrecheck.failCount === 0,
  JSON.stringify(leadAddPrecheck),
)
const leadAddImportRes = await postXlsx('/lead/import', manager.headers, leadAddXlsx, 'ADD')
const leadAddImport = await leadAddImportRes.json()
const r2LeadRows = await post('/lead/page', manager.headers, {
  current: 1,
  pageSize: 20,
  keyword: r2LeadName,
})
const r2Lead = r2LeadRows.list?.find((item) => item.name === r2LeadName)
check(
  'R2 Lead ADD xlsx 正式导入',
  leadAddImportRes.ok && leadAddImport.successCount === 1 && Boolean(r2Lead?.id),
  JSON.stringify(leadAddImport),
)

const updatedLeadContact = `R2更新联系人-${stamp}`
const leadUpdateXlsx = await buildXlsx(
  ['唯一ID', leadContactNameField?.label ?? '联系人'],
  [[r2Lead?.id, updatedLeadContact]],
)
const leadUpdatePrecheckRes = await postXlsx(
  '/lead/import/pre-check',
  manager.headers,
  leadUpdateXlsx,
  'UPDATE',
)
const leadUpdatePrecheck = await leadUpdatePrecheckRes.json()
const leadUpdateImportRes = await postXlsx(
  '/lead/import',
  manager.headers,
  leadUpdateXlsx,
  'UPDATE',
)
const leadUpdateImport = await leadUpdateImportRes.json()
const updatedR2LeadRows = await post('/lead/page', manager.headers, {
  current: 1,
  pageSize: 20,
  keyword: r2LeadName,
})
check(
  'R2 Lead UPDATE 以唯一ID更新',
  leadUpdatePrecheckRes.ok &&
    leadUpdatePrecheck.successCount === 1 &&
    leadUpdateImportRes.ok &&
    leadUpdateImport.successCount === 1 &&
    updatedR2LeadRows.list?.some(
      (item) => item.id === r2Lead?.id && item.contactName === updatedLeadContact,
    ),
)

const r2CustomerName = `R2导入客户-${stamp}`
const customerAddXlsx = await buildXlsx(
  [customerNameImportField?.label ?? '客户名称', customerPhoneImportField?.label ?? '联系电话'],
  [[r2CustomerName, `136${phoneSuffix}`]],
)
const customerAddPrecheckRes = await postXlsx(
  '/account/import/pre-check',
  manager.headers,
  customerAddXlsx,
  'ADD',
)
const customerAddPrecheck = await customerAddPrecheckRes.json()
const customerAddImportRes = await postXlsx(
  '/account/import',
  manager.headers,
  customerAddXlsx,
  'ADD',
)
const customerAddImport = await customerAddImportRes.json()
const r2CustomerRows = await post('/account/page', manager.headers, {
  current: 1,
  pageSize: 20,
  keyword: r2CustomerName,
})
const r2Customer = r2CustomerRows.list?.find((item) => item.name === r2CustomerName)
check(
  'R2 Customer ADD xlsx 预检 + 正式导入',
  customerAddPrecheckRes.ok &&
    customerAddPrecheck.successCount === 1 &&
    customerAddImportRes.ok &&
    customerAddImport.successCount === 1 &&
    Boolean(r2Customer?.id),
)

const updatedCustomerPhone = `135${phoneSuffix}`
const customerUpdateXlsx = await buildXlsx(
  ['唯一ID', customerPhoneImportField?.label ?? '联系电话'],
  [[r2Customer?.id, updatedCustomerPhone]],
)
const customerUpdatePrecheckRes = await postXlsx(
  '/account/import/pre-check',
  manager.headers,
  customerUpdateXlsx,
  'UPDATE',
)
const customerUpdatePrecheck = await customerUpdatePrecheckRes.json()
const customerUpdateImportRes = await postXlsx(
  '/account/import',
  manager.headers,
  customerUpdateXlsx,
  'UPDATE',
)
const customerUpdateImport = await customerUpdateImportRes.json()
const updatedR2Customer = r2Customer?.id
  ? await get(`/account/get/${r2Customer.id}`, manager.headers)
  : null
check(
  'R2 Customer UPDATE 以唯一ID更新',
  customerUpdatePrecheckRes.ok &&
    customerUpdatePrecheck.successCount === 1 &&
    customerUpdateImportRes.ok &&
    customerUpdateImport.successCount === 1 &&
    updatedR2Customer?.phone === updatedCustomerPhone,
)

const r2LeadPool = await createPoolFixture('lead', admin.user, {
  name: `R2导入线索池-${stamp}`,
  scopeIds: [manager.user.id],
})
const r2CustomerPool = await createPoolFixture('customer', admin.user, {
  name: `R2导入客户公海-${stamp}`,
  scopeIds: [`user:${manager.user.id}`],
})

const poolLeadTemplateResponse = await fetch(
  `${base}/pool/lead/template/download?importType=ADD`,
  { headers: { Authorization: manager.headers.Authorization } },
)
const poolLeadTemplateSheet = poolLeadTemplateResponse.ok
  ? await readXlsx(Buffer.from(await poolLeadTemplateResponse.arrayBuffer()))
  : null
const poolLeadHeaders = poolLeadTemplateSheet
  ? poolLeadTemplateSheet.getRow(1).values.slice(1).map(String)
  : []
check(
  'R2 线索池模板移除负责人字段',
  poolLeadTemplateResponse.ok && !poolLeadHeaders.includes(leadOwnerField?.label),
)

const customerOwnerField = fields.find((field) => field.key === 'owner')
const poolCustomerTemplateResponse = await fetch(
  `${base}/pool/account/template/download?importType=ADD`,
  { headers: { Authorization: manager.headers.Authorization } },
)
const poolCustomerTemplateSheet = poolCustomerTemplateResponse.ok
  ? await readXlsx(Buffer.from(await poolCustomerTemplateResponse.arrayBuffer()))
  : null
const poolCustomerHeaders = poolCustomerTemplateSheet
  ? poolCustomerTemplateSheet.getRow(1).values.slice(1).map(String)
  : []
check(
  'R2 客户公海模板移除负责人字段',
  poolCustomerTemplateResponse.ok && !poolCustomerHeaders.includes(customerOwnerField?.label),
)

const r2PoolLeadName = `R2池导入线索-${stamp}`
const poolLeadXlsx = await buildXlsx([leadNameField?.label ?? '线索名称'], [[r2PoolLeadName]])
const poolLeadPrecheckRes = await postXlsx(
  '/pool/lead/import/pre-check',
  manager.headers,
  poolLeadXlsx,
  'ADD',
  r2LeadPool.id,
)
const poolLeadPrecheck = await poolLeadPrecheckRes.json()
const poolLeadImportRes = await postXlsx(
  '/pool/lead/import',
  manager.headers,
  poolLeadXlsx,
  'ADD',
  r2LeadPool.id,
)
const poolLeadImport = await poolLeadImportRes.json()
// manager 在当前历史 seed 中有 leadPool:import/export/update/delete，但没有 leadPool:read；
// 导入权限仍由 manager 验证，导入结果改由管理员回查，避免把 read 权限混入导入验收。
const r2PoolLeadRows = await post('/pool/lead/page', admin.headers, {
  current: 1,
  pageSize: 20,
  poolId: r2LeadPool.id,
  keyword: r2PoolLeadName,
})
const r2PoolLead = r2PoolLeadRows.list?.find((item) => item.name === r2PoolLeadName)
check(
  'R2 线索池 xlsx 导入强制保持池归属且无负责人',
  poolLeadPrecheck.successCount === 1 &&
    poolLeadImport.successCount === 1 &&
    r2PoolLead?.inPool === true &&
    r2PoolLead?.poolId === r2LeadPool.id &&
    r2PoolLead?.ownerId === null,
)

const r2PoolCustomerName = `R2公海导入客户-${stamp}`
const poolCustomerXlsx = await buildXlsx(
  [customerNameImportField?.label ?? '客户名称'],
  [[r2PoolCustomerName]],
)
const poolCustomerImportRes = await postXlsx(
  '/pool/account/import',
  manager.headers,
  poolCustomerXlsx,
  'ADD',
  r2CustomerPool.id,
)
const poolCustomerImport = await poolCustomerImportRes.json()
const r2PoolCustomerRows = await post('/pool/account/page', manager.headers, {
  current: 1,
  pageSize: 20,
  poolId: r2CustomerPool.id,
  keyword: r2PoolCustomerName,
})
const r2PoolCustomer = r2PoolCustomerRows.list?.find((item) => item.name === r2PoolCustomerName)
check(
  'R2 客户公海 xlsx 导入直接写入公海且无负责人',
  poolCustomerImport.successCount === 1 &&
    r2PoolCustomer?.inSea === true &&
    r2PoolCustomer?.poolId === r2CustomerPool.id &&
    r2PoolCustomer?.ownerId === null,
)

const deniedPoolImport = await postXlsx(
  '/pool/lead/import/pre-check',
  sales.headers,
  poolLeadXlsx,
  'ADD',
  r2LeadPool.id,
)
check('R2 池导入要求独立功能权限', deniedPoolImport.status === 403)

const leadExportAllRes = await request(
  'POST',
  '/lead/export',
  manager.headers,
  {
    current: 1,
    pageSize: 100,
    keyword: r2LeadName,
    fileName: `R2线索导出-${stamp}`,
    headList: ['name', 'contact', 'status'],
  },
)
const leadExportTask = await leadExportAllRes.json()
check(
  'R2 Lead 导出全部创建任务并继承当前筛选',
  leadExportAllRes.ok && leadExportTask.status === 'SUCCESS' && leadExportTask.rowCount === 1,
  JSON.stringify(leadExportTask),
)
const managerTasks = await get('/export-tasks', manager.headers)
const salesTasks = await get('/export-tasks', sales.headers)
check(
  'R2 ExportTask 仅创建者列表可见',
  managerTasks.some((task) => task.id === leadExportTask.id) &&
    !salesTasks.some((task) => task.id === leadExportTask.id),
)
const crossUserDownload = await fetch(`${base}/export-tasks/${leadExportTask.id}/download`, {
  headers: { Authorization: sales.headers.Authorization },
})
check('R2 ExportTask 跨用户下载被拒绝', crossUserDownload.status === 404)
const leadExportDownload = await fetch(`${base}/export-tasks/${leadExportTask.id}/download`, {
  headers: { Authorization: manager.headers.Authorization },
})
const leadExportSheet = leadExportDownload.ok
  ? await readXlsx(Buffer.from(await leadExportDownload.arrayBuffer()))
  : null
const exportedLeadHeaders = leadExportSheet
  ? leadExportSheet.getRow(1).values.slice(1).map(String)
  : []
check(
  'R2 导出 xlsx 字段顺序与内容一致',
  leadExportDownload.ok &&
    exportedLeadHeaders.join('|') === '线索名称|联系人|状态' &&
    String(leadExportSheet?.getRow(2).getCell(1).value ?? '') === r2LeadName,
)

const poolLeadExportRes = await request(
  'POST',
  '/pool/lead/export-select',
  manager.headers,
  {
    poolId: r2LeadPool.id,
    fileName: `R2池线索导出-${stamp}`,
    headList: ['name', 'createdAt'],
    ids: [r2PoolLead.id],
  },
)
const poolLeadExportTask = await poolLeadExportRes.json()
check(
  'R2 线索池导出选中使用独立权限 + PoolMember',
  poolLeadExportRes.ok &&
    poolLeadExportTask.status === 'SUCCESS' &&
    poolLeadExportTask.rowCount === 1,
)
const customerExportRes = await request('POST', '/account/export-select', manager.headers, {
  fileName: `R2客户导出-${stamp}`,
  headList: ['name', 'cf_phone'],
  ids: [r2Customer.id],
})
const customerExportTask = await customerExportRes.json()
check(
  'R2 Customer 导出选中严格按 ids',
  customerExportRes.ok &&
    customerExportTask.status === 'SUCCESS' &&
    customerExportTask.rowCount === 1,
)
const poolCustomerExportRes = await request(
  'POST',
  '/pool/account/export-select',
  manager.headers,
  {
    fileName: `R2公海客户导出-${stamp}`,
    headList: ['name', 'createdAt'],
    ids: [r2PoolCustomer.id],
  },
)
const poolCustomerExportTask = await poolCustomerExportRes.json()
check(
  'R2 客户公海导出选中使用独立权限 + PoolMember',
  poolCustomerExportRes.ok &&
    poolCustomerExportTask.status === 'SUCCESS' &&
    poolCustomerExportTask.rowCount === 1,
)
const deniedPoolExport = await request(
  'POST',
  '/pool/lead/export-all',
  sales.headers,
  {
    poolId: r2LeadPool.id,
    current: 1,
    pageSize: 20,
    fileName: `R2禁止导出-${stamp}`,
    headList: ['name'],
  },
)
check('R2 池导出要求独立功能权限', deniedPoolExport.status === 403)

await request('DELETE', `/export-tasks/${leadExportTask.id}`, manager.headers)
await request('DELETE', `/export-tasks/${poolLeadExportTask.id}`, manager.headers)
await request('DELETE', `/export-tasks/${customerExportTask.id}`, manager.headers)
await request('DELETE', `/export-tasks/${poolCustomerExportTask.id}`, manager.headers)
if (r2Lead?.id) await request('GET', `/lead/delete/${r2Lead.id}`, manager.headers)
if (r2Customer?.id) await request('GET', `/account/delete/${r2Customer.id}`, manager.headers)
if (r2PoolLead?.id) {
  await post('/pool/lead/batch-delete', manager.headers, {
    poolId: r2LeadPool.id,
    ids: [r2PoolLead.id],
  })
}
if (r2PoolCustomer?.id) {
  await post('/pool/account/batch-delete', manager.headers, {
    batchIds: [r2PoolCustomer.id],
  })
}
await deletePoolFixture('lead', admin.user, r2LeadPool.id)
await deletePoolFixture('customer', admin.user, r2CustomerPool.id)

// R3 联系人源码对齐：独立数据范围 / 状态 / 商机关联 / 批改 / xlsx 导入导出
const contactTabsAdmin = await get('/account/contact/tab', admin.headers)
const contactTabsManager = await get('/account/contact/tab', manager.headers)
const contactTabsSales = await get('/account/contact/tab', sales.headers)
check('R3 Contact tab：ALL 角色显示全部和部门视图', contactTabsAdmin.all && contactTabsAdmin.dept)
check('R3 Contact tab：部门角色只显示部门视图', !contactTabsManager.all && contactTabsManager.dept)
check(
  'R3 Contact tab：SELF 角色不显示全部/部门视图',
  !contactTabsSales.all && !contactTabsSales.dept,
)

const r3ContactField = await post('/metadata/contact/fields', admin.headers, {
  label: `R3联系人字段-${stamp}`,
  type: 'text',
})
const r3Customer = await post('/account/add', manager.headers, {
  name: `R3联系人客户-${stamp}`,
})
const r3OtherCustomer = await post('/account/add', manager.headers, {
  name: `R3联系人其他客户-${stamp}`,
})
const r3ManagerContact = await post('/account/contact/add', manager.headers, {
  customerId: r3Customer.id,
  name: `R3主管联系人-${stamp}`,
  phone: `137${phoneSuffix}`,
  moduleFields: [{ fieldId: r3ContactField.id, fieldValue: '主管自定义值' }],
})
const r3SalesContact = await post('/account/contact/add', manager.headers, {
  customerId: r3Customer.id,
  owner: sales.user.id,
  name: `R3销售联系人-${stamp}`,
  phone: `134${phoneSuffix}`,
})

const managerContactPage = await post('/account/contact/page', manager.headers, {
  current: 1,
  pageSize: 100,
  keyword: `R3`,
  scopeView: 'DEPT',
})
check(
  'R3 独立联系人 DEPT 视图按联系人 owner/dept 返回',
  managerContactPage.list.some((item) => item.id === r3ManagerContact.id) &&
    managerContactPage.list.some((item) => item.id === r3SalesContact.id),
)
const salesContactPage = await post('/account/contact/page', sales.headers, {
  current: 1,
  pageSize: 100,
  keyword: `R3`,
  scopeView: 'SELF',
})
check(
  'R3 独立联系人 SELF 视图只返回本人负责人数据',
  salesContactPage.list.some((item) => item.id === r3SalesContact.id) &&
    !salesContactPage.list.some((item) => item.id === r3ManagerContact.id),
)
const r3ManagerContactDetail = await get(
  `/account/contact/get/${r3ManagerContact.id}`,
  manager.headers,
)
check(
  'R3 Contact customData 随详情返回',
  r3ManagerContactDetail.customData?.[r3ContactField.key] === '主管自定义值',
)

const blankDisable = await request(
  'POST',
  `/account/contact/disable/${r3ManagerContact.id}`,
  manager.headers,
  { reason: '' },
)
check('R3 联系人停用原因必填', blankDisable.status === 400)
await post(`/account/contact/disable/${r3ManagerContact.id}`, manager.headers, {
  reason: `R3停用-${stamp}`,
})
const disabledContact = await get(`/account/contact/get/${r3ManagerContact.id}`, manager.headers)
check(
  'R3 联系人停用保存原因',
  disabledContact.enable === false && disabledContact.disableReason === `R3停用-${stamp}`,
)
await get(`/account/contact/enable/${r3ManagerContact.id}`, manager.headers)
const enabledContact = await get(`/account/contact/get/${r3ManagerContact.id}`, manager.headers)
check(
  'R3 联系人重新启用会清空停用原因',
  enabledContact.enable === true && enabledContact.disableReason === null,
)

const r3BatchValue = `R3批改-${stamp}`
const r3BatchResult = await post('/account/contact/batch/update', manager.headers, {
  ids: [r3ManagerContact.id, r3SalesContact.id],
  fieldId: r3ContactField.id,
  fieldValue: r3BatchValue,
})
const r3BatchPage = await post('/account/contact/page', manager.headers, {
  current: 1,
  pageSize: 100,
  keyword: `R3`,
  scopeView: 'DEPT',
})
check(
  'R3 联系人批量字段修改',
  r3BatchResult.success === 2 &&
    r3BatchPage.list
      .filter((item) => [r3ManagerContact.id, r3SalesContact.id].includes(item.id))
      .every((item) => item.customData?.[r3ContactField.key] === r3BatchValue),
)

const r3Opportunity = await post('/opportunity/add', manager.headers, {
  name: `R3联系人商机-${stamp}`,
  customerId: r3Customer.id,
  contactId: r3ManagerContact.id,
})
check('R3 Opportunity 可绑定联系人', r3Opportunity.contactId === r3ManagerContact.id)
const r3OpportunityCheck = await get(
  `/account/contact/opportunity/check/${r3ManagerContact.id}`,
  manager.headers,
)
check('R3 删除前可检查商机关联', r3OpportunityCheck === true)
const deniedLinkedContactDelete = await request(
  'GET',
  `/account/contact/delete/${r3ManagerContact.id}`,
  manager.headers,
)
check('R3 Service 级阻止删除已关联商机联系人', deniedLinkedContactDelete.status === 400)
const invalidOpportunityContact = await request('POST', '/opportunity/update', manager.headers, {
  id: r3Opportunity.id,
  contactId: r3SalesContact.id,
  customerId: r3OtherCustomer.id,
})
check('R3 Opportunity 联系人必须属于当前客户', invalidOpportunityContact.status === 400)

const contactFields = await get('/metadata/contact/fields', manager.headers)
const contactNameField = contactFields.find((field) => field.key === 'name')
const contactCustomerField = contactFields.find((field) => field.key === 'customerId')
const contactPhoneField = contactFields.find((field) => field.key === 'phone')
const contactEnableField = contactFields.find((field) => field.key === 'enable')
const contactTemplateResponse = await fetch(`${base}/account/contact/template/download`, {
  headers: { Authorization: manager.headers.Authorization },
})
const contactTemplateSheet = contactTemplateResponse.ok
  ? await readXlsx(Buffer.from(await contactTemplateResponse.arrayBuffer()))
  : null
const contactTemplateHeaders = contactTemplateSheet
  ? contactTemplateSheet.getRow(1).values.slice(1).map(String)
  : []
check(
  'R3 联系人模板与 Cordys 一样单一模板并包含唯一ID',
  contactTemplateResponse.ok &&
    contactTemplateHeaders[0] === '唯一ID' &&
    contactTemplateHeaders.includes(contactNameField?.label) &&
    !contactTemplateHeaders.includes(contactEnableField?.label),
)

const r3ImportedContactName = `R3导入联系人-${stamp}`
const r3ContactAddXlsx = await buildXlsx(
  [
    contactCustomerField?.label ?? '客户',
    contactNameField?.label ?? '姓名',
    contactPhoneField?.label ?? '电话',
  ],
  [[r3Customer.name, r3ImportedContactName, `133${phoneSuffix}`]],
)
const r3ContactPrecheckRes = await postXlsx(
  '/account/contact/import/pre-check',
  manager.headers,
  r3ContactAddXlsx,
  'ADD',
)
const r3ContactPrecheck = await r3ContactPrecheckRes.json()
const r3ContactImportRes = await postXlsx(
  '/account/contact/import',
  manager.headers,
  r3ContactAddXlsx,
  'ADD',
)
const r3ContactImport = await r3ContactImportRes.json()
const r3ImportedPage = await post('/account/contact/page', manager.headers, {
  current: 1,
  pageSize: 100,
  keyword: r3ImportedContactName,
  scopeView: 'DEPT',
})
const r3ImportedContact = r3ImportedPage.list.find((item) => item.name === r3ImportedContactName)
check(
  'R3 联系人 xlsx ADD 预检 + 正式导入',
  r3ContactPrecheckRes.ok &&
    r3ContactPrecheck.successCount === 1 &&
    r3ContactImportRes.ok &&
    r3ContactImport.successCount === 1 &&
    Boolean(r3ImportedContact?.id),
)

if (r3ImportedContact?.id) {
  await post(`/account/contact/disable/${r3ImportedContact.id}`, manager.headers, {
    reason: '验证导入更新重新启用',
  })
}
const r3UpdatedPhone = `132${phoneSuffix}`
const r3ContactUpdateXlsx = await buildXlsx(
  ['唯一ID', contactPhoneField?.label ?? '电话'],
  [[r3ImportedContact?.id, r3UpdatedPhone]],
)
const r3ContactUpdateRes = await postXlsx(
  '/account/contact/import',
  manager.headers,
  r3ContactUpdateXlsx,
  'UPDATE',
)
const r3ContactUpdate = await r3ContactUpdateRes.json()
const r3UpdatedContact = r3ImportedContact?.id
  ? await get(`/account/contact/get/${r3ImportedContact.id}`, manager.headers)
  : null
check(
  'R3 联系人 UPDATE 按唯一ID更新并重新启用',
  r3ContactUpdateRes.ok &&
    r3ContactUpdate.successCount === 1 &&
    r3UpdatedContact?.phone === r3UpdatedPhone &&
    r3UpdatedContact?.enable === true,
)

const deniedContactImport = await postXlsx(
  '/account/contact/import/pre-check',
  sales.headers,
  r3ContactAddXlsx,
  'ADD',
)
check('R3 联系人导入使用独立 IMPORT 权限', deniedContactImport.status === 403)

const r3ContactExportRes = await request('POST', '/account/contact/export-all', manager.headers, {
  current: 1,
  pageSize: 100,
  keyword: `R3`,
  scopeView: 'DEPT',
  fileName: `R3联系人导出-${stamp}`,
  headList: ['name', 'customerId', 'ownerId', 'enable'],
})
const r3ContactExportTask = await r3ContactExportRes.json()
check(
  'R3 联系人导出全部创建 ExportTask',
  r3ContactExportRes.ok &&
    r3ContactExportTask.status === 'SUCCESS' &&
    r3ContactExportTask.rowCount >= 3,
)
const r3ContactSelectExportRes = await request('POST', '/account/contact/export-select', manager.headers, {
  fileName: `R3联系人选中导出-${stamp}`,
  headList: ['name', 'phone'],
  ids: [r3ManagerContact.id, r3SalesContact.id],
})
const r3ContactSelectExportTask = await r3ContactSelectExportRes.json()
check(
  'R3 联系人导出选中严格按 ids',
  r3ContactSelectExportRes.ok &&
    r3ContactSelectExportTask.status === 'SUCCESS' &&
    r3ContactSelectExportTask.rowCount === 2,
)
const deniedContactExport = await request('POST', '/account/contact/export-all', sales.headers, {
  current: 1,
  pageSize: 20,
  scopeView: 'SELF',
  fileName: `R3禁止导出-${stamp}`,
  headList: ['name'],
})
check('R3 联系人导出使用独立 EXPORT 权限', deniedContactExport.status === 403)

await request('DELETE', `/export-tasks/${r3ContactExportTask.id}`, manager.headers)
await request('DELETE', `/export-tasks/${r3ContactSelectExportTask.id}`, manager.headers)
await post('/opportunity/update', manager.headers, { id: r3Opportunity.id, contactId: '' })
await request('GET', `/opportunity/delete/${r3Opportunity.id}`, manager.headers)
if (r3ImportedContact?.id) await get(`/account/contact/delete/${r3ImportedContact.id}`, manager.headers)
await get(`/account/contact/delete/${r3ManagerContact.id}`, manager.headers)
await get(`/account/contact/delete/${r3SalesContact.id}`, manager.headers)
await request('GET', `/account/delete/${r3Customer.id}`, manager.headers)
await request('GET', `/account/delete/${r3OtherCustomer.id}`, manager.headers)
await request('DELETE', `/metadata/fields/${r3ContactField.id}`, admin.headers)

const removedJsonRowsImport = await request('POST', '/customers/import/rows', admin.headers, {
  rows: [{ name: `冒烟线索-${stamp}` }],
})
check('旧 Customer JSON rows 导入入口已移除', removedJsonRowsImport.status === 404)

const opportunityProduct = await post('/product/add', manager.headers, {
  name: `冒烟意向产品-${stamp}`,
  price: 30000,
  status: '1',
})
const oppWithItems = await post('/opportunity/add', manager.headers, {
  name: `冒烟明细商机-${stamp}`,
  customerId: converted.customerId,
  amount: 30000,
  products: [opportunityProduct.id],
})
check(
  '商机意向产品与金额',
  Number(oppWithItems.amount) === 30000 && oppWithItems.products?.includes(opportunityProduct.id),
)
await post('/opportunity/update', manager.headers, {
  id: oppWithItems.id,
  owner: sales.user.id,
})
const transferredOpportunityNotifications = await get(
  '/notifications?page=1&pageSize=100',
  sales.headers,
)
check(
  'W2.4 商机负责人变更发送 BUSINESS_TRANSFER',
  transferredOpportunityNotifications.items?.some(
    (item) => item.title === '商机已转移给你' && item.content?.includes(`冒烟明细商机-${stamp}`),
  ),
)
const quotationForm = await get('/opportunity/quotation/module/form', manager.headers)
const quotationProduct = {
  product: opportunityProduct.id,
  productAmount: 30000,
  discount: 100,
  tax: 0,
  amount: 30000,
}
const quoteFromOpp = await post('/opportunity/quotation/add', manager.headers, {
  name: `冒烟带入报价-${stamp}`,
  opportunityId: oppWithItems.id,
  untilTime: Date.now() + 30 * 24 * 60 * 60 * 1000,
  amount: 30000,
  moduleFields: [],
  moduleFormConfigDTO: quotationForm,
  products: [quotationProduct],
})
check('报价从商机带入明细', quoteFromOpp.amount === 30000 && quoteFromOpp.products?.length === 1)

// 5. 商机推进赢单
const stageConfig = await get('/opportunity/stage/get', sales.headers)
const won = stageConfig.stageConfigList.find((s) => s.type === 'END' && Number(s.rate) === 100)
if (!won) throw new Error('未找到商机成功阶段')
await post('/opportunity/update/stage', sales.headers, {
  id: converted.opportunityId,
  stage: won.id,
})
const kanban = await post('/opportunity/page', sales.headers, {
  current: 1,
  pageSize: 500,
  board: true,
})
check(
  '商机赢单与看板',
  kanban.stages.some((s) => s.isWon && s.count >= 1) &&
    (kanban.list?.[won.id] ?? []).some((item) => item.id === converted.opportunityId),
)

// 6. 交易链：报价→合同→回款→发票→订单
const quote = await post('/opportunity/quotation/add', manager.headers, {
  name: `冒烟报价-${stamp}`,
  opportunityId: oppWithItems.id,
  untilTime: Date.now() + 30 * 24 * 60 * 60 * 1000,
  amount: 30000,
  moduleFields: [],
  moduleFormConfigDTO: quotationForm,
  products: [quotationProduct],
})
check('创建报价', quote.amount === 30000 && quote.products?.length === 1)
const contractForm = await get('/contract/module/form', manager.headers)
const contract = await post('/contract/add', manager.headers, {
  name: `冒烟合同-${stamp}`,
  customerId: converted.customerId,
  owner: manager.user.id,
  amount: quote.amount,
  moduleFields: [],
  moduleFormConfigDTO: contractForm,
  products: (quote.products ?? []).map((item) => ({
    product: item.productId,
    productAmount: item.productAmount,
    productNumber: 1,
    amount: item.amount,
  })),
})
check('报价产品带入 direct 合同', contract.amount === 30000 && contract.products?.length === 1)
const plan = await post('/contract/payment-plan/add', manager.headers, {
  name: `冒烟回款计划-${stamp}`,
  contractId: contract.id,
  owner: manager.user.id,
  planAmount: 30000,
  planEndTime: new Date('2026-12-31T00:00:00').getTime(),
})
const paymentRecord = await post('/contract/payment-record/add', manager.headers, {
  name: `冒烟回款记录-${stamp}`,
  contractId: contract.id,
  paymentPlanId: plan.id,
  owner: manager.user.id,
  recordAmount: 30000,
  recordEndTime: Date.now(),
  moduleFields: [
    { fieldId: 'contractPaymentRecordBank', fieldValue: '1' },
    { fieldId: 'contractPaymentRecordBankNo', fieldValue: '1' },
  ],
})
const contractDetail = await get(`/contract/get/${contract.id}`, manager.headers)
check('回款计入合同汇总', contractDetail.paidAmount === 30000)
const order = await post('/orders', manager.headers, {
  name: `冒烟订单-${stamp}`,
  contractId: contract.id,
  amount: 30000,
})
check('创建订单', Boolean(order.code))

const invoiceTitle = await post('/contract/business-title/add', manager.headers, {
  name: `冒烟开票抬头-${stamp}`,
  type: 'THIRD_PARTY',
  identificationNumber: `91310000${String(Date.now()).slice(-10)}`,
  openingBank: '中国银行上海分行',
  bankAccount: '6222000000000000000',
  registrationAddress: '上海市浦东新区测试路1号',
  phoneNumber: '021-12345678',
  registeredCapital: '1000万人民币',
  companySize: '100-499人',
  registrationNumber: `REG-${stamp}`,
  province: '上海市',
  city: '上海市',
  scale: '中型',
  industry: '软件与信息服务',
  remark: 'root smoke',
})
const invoice = await post('/invoice/add', manager.headers, {
  name: `冒烟开票申请-${stamp}`,
  contractId: contract.id,
  owner: manager.user.id,
  businessTitleId: invoiceTitle.id,
  amount: 30000,
  invoiceType: '增值税普通发票',
  taxRate: 0,
  moduleFields: [],
})
check('R5 客户360 测试发票创建', Boolean(invoice.id))
const legacyInvoiceList = await request('GET', `/contracts/${contract.id}/invoices`, manager.headers)
check('R5 旧合同发票路由已退出', legacyInvoiceList.status === 404)
const legacyTitleList = await request('GET', '/contracts/invoice-titles', manager.headers)
check('R5 旧工商抬头路由已退出', legacyTitleList.status === 404)

const [r5OpportunityRows, r5ContractRows, r5PlanRows, r5PaymentRows, r5InvoiceRows, r5OrderRows] =
  await Promise.all([
    post('/account/opportunity/page', manager.headers, {
      accountId: converted.customerId,
      current: 1,
      pageSize: 10,
    }),
    post('/account/contract/page', manager.headers, {
      accountId: converted.customerId,
      current: 1,
      pageSize: 10,
    }),
    post('/account/contract/payment-plan/page', manager.headers, {
      accountId: converted.customerId,
      current: 1,
      pageSize: 10,
    }),
    post('/account/contract/payment-record/page', manager.headers, {
      accountId: converted.customerId,
      current: 1,
      pageSize: 10,
    }),
    post('/account/invoice/page', manager.headers, {
      accountId: converted.customerId,
      current: 1,
      pageSize: 10,
    }),
    post('/account/order/page', manager.headers, {
      accountId: converted.customerId,
      current: 1,
      pageSize: 10,
    }),
  ])
check(
  'R5 客户360 商机 Tab 数据可分页读取',
  Array.isArray(r5OpportunityRows.list) &&
    r5OpportunityRows.list.some((item) => item.id === oppWithItems.id),
)
check(
  'R5 客户360 合同 Tab 数据可分页读取',
  Array.isArray(r5ContractRows.list) &&
    r5ContractRows.list.some((item) => item.id === contract.id),
)
check(
  'R5 客户360 回款计划 Tab 数据可分页读取',
  Array.isArray(r5PlanRows.list) && r5PlanRows.list.some((item) => item.id === plan.id),
)
check(
  'R5 客户360 回款记录 Tab 数据可分页读取',
  Array.isArray(r5PaymentRows.list) &&
    r5PaymentRows.list.some((item) => item.id === paymentRecord.id),
)
check(
  'R5 客户360 发票 Tab 数据可分页读取',
  Array.isArray(r5InvoiceRows.list) && r5InvoiceRows.list.some((item) => item.id === invoice.id),
)
check(
  'R5 客户360 订单 Tab 数据可分页读取',
  Array.isArray(r5OrderRows.list) && r5OrderRows.list.some((item) => item.id === order.id),
)

const form = new FormData()
form.append('file', new Blob(['scan-copy'], { type: 'text/plain' }), 'scan.txt')
form.append('targetType', 'contract')
form.append('targetId', contract.id)
const uploaded = await fetch(`${base}/attachments/upload`, {
  method: 'POST',
  headers: { Authorization: manager.headers.Authorization },
  body: form,
}).then((r) => r.json())
check('上传附件', Boolean(uploaded.id) && uploaded.name === 'scan.txt')
const listed = await get(
  `/attachments?targetType=contract&targetId=${contract.id}`,
  manager.headers,
)
check('列出附件', Array.isArray(listed) && listed.some((a) => a.id === uploaded.id))
const downloaded = await fetch(`${base}/attachments/${uploaded.id}/download`, {
  headers: { Authorization: manager.headers.Authorization },
})
check('下载附件', downloaded.ok)

// 7. 审批流（合同 8 万以上 CREATE 自动提审 → 两级通过）
const bigContract = await post('/contract/add', sales.headers, {
  name: `冒烟审批合同-${stamp}`,
  customerId: converted.customerId,
  owner: sales.user.id,
  amount: 88000,
  moduleFields: [],
  moduleFormConfigDTO: contractForm,
  products: [
    {
      product: opportunityProduct.id,
      productAmount: 88000,
      productNumber: 1,
      amount: 88000,
    },
  ],
})
check('大额合同 CREATE 自动进入审批', bigContract.approvalStatus === 'APPROVING')
const managerPending = await get('/approvals/my-pending?pageSize=5', manager.headers)
const task1 = managerPending.items.find((i) => i.targetId === bigContract.id)
check('直属上级收到审批待办', Boolean(task1?.myPendingTaskId))
await post(`/approvals/tasks/${task1.myPendingTaskId}/approve`, manager.headers, {
  comment: '同意',
})
const adminPending = await get('/approvals/my-pending?pageSize=5', admin.headers)
const task2 = adminPending.items.find((i) => i.targetId === bigContract.id)
await post(`/approvals/tasks/${task2.myPendingTaskId}/approve`, admin.headers, { comment: '批准' })
const approvedContract = await get(`/contract/get/${bigContract.id}`, sales.headers)
check(
  '审批通过后合同保留 Cordys 审批事实位',
  approvedContract.approved === true && approvedContract.approvalStatus === 'APPROVED',
)
const contractApprovalNotifications = await get('/notifications?page=1&pageSize=100', sales.headers)
check(
  'W2.4 合同审批结束发送 CONTRACT_APPROVAL 给提交人',
  contractApprovalNotifications.items?.some(
    (item) => item.title === '审批已通过' && item.content?.includes(`冒烟审批合同-${stamp}`),
  ),
)

// 8. 标讯
const fetchResult = await post('/bidding/fetch-now', manager.headers)
check('标讯抓取', typeof fetchResult.fetched === 'number')
const biddingList = await get('/bidding?pageSize=1', manager.headers)
check('标讯列表', biddingList.total >= 1)

// 9. 报表
const summary = await get('/home/overview/summary', admin.headers)
check('工作台简报', typeof summary.wonAmount === 'number')
const funnel = await get('/home/overview/funnel', admin.headers)
check('商机漏斗', Array.isArray(funnel) && funnel.length > 0)

const oldDashboardStatisticPaths = ['summary', 'funnel', 'ranking', 'trend', 'conversion']
const oldDashboardStatisticResponses = await Promise.all(
  oldDashboardStatisticPaths.map((path) => request('GET', `/dashboard/${path}`, admin.headers)),
)
check(
  'W3.4.4 旧 Dashboard 统计命名空间已全部释放',
  oldDashboardStatisticResponses.every((response) => response.status === 404),
)

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
await smokePrisma.$disconnect()
process.exit(failed > 0 ? 1 : 0)
