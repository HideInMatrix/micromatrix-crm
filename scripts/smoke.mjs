/**
 * 全链路冒烟测试：登录 → 数据范围 → 元数据 → 线索转化 → 交易链 → 审批 → 标讯 → 报表
 * 运行前置：API 已启动（pnpm dev 或 node apps/api/dist/main.js）、已执行种子数据
 * 用法：pnpm smoke
 */
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const ExcelJS = requireFromApi('exceljs')
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

console.log('== 微矩阵 CRM 全链路冒烟 ==')

// 1. 健康与登录
const health = await fetch(`${base}/health`).then((r) => r.json())
check('健康检查', health.status === 'ok')
const admin = await login('admin@demo.com', 'admin123')
const manager = await login('zhangwei@demo.com', 'demo123')
const sales = await login('lina@demo.com', 'demo123')
check('三种角色登录', Boolean(admin.user && manager.user && sales.user))

// 2. 数据范围
const [adminCustomers, managerCustomers, salesCustomers] = await Promise.all([
  get('/customers?pageSize=100', admin.headers),
  get('/customers?pageSize=100', manager.headers),
  get('/customers?pageSize=100', sales.headers),
])
check(
  '数据范围边界（管理员 ≥ 主管 ≥ 专员）',
  adminCustomers.total >= managerCustomers.total && managerCustomers.total >= salesCustomers.total,
  `${adminCustomers.total}/${managerCustomers.total}/${salesCustomers.total}`,
)

// 3. 元数据引擎
const fields = await get('/metadata/customer/fields', admin.headers)
check('客户系统字段初始化', Array.isArray(fields) && fields.some((f) => f.key === 'name'))

// 4. 线索全链路
const stamp = Date.now().toString(36)
const nameField = fields.find((field) => field.key === 'name')
const hideableField = fields.find((field) => field.key !== 'name' && !field.hidden)
if (nameField && hideableField) {
  const hiddenFieldPool = await post('/resource-pools', admin.headers, {
    module: 'customer',
    name: `冒烟隐藏字段公海-${stamp}`,
    scopeIds: ['*'],
    hiddenFieldIds: [nameField.id, hideableField.id, 'invalid-field-id'],
  })
  check(
    '池隐藏字段净化：名称不可隐藏且未知字段忽略',
    Array.isArray(hiddenFieldPool.hiddenFieldIds) &&
      !hiddenFieldPool.hiddenFieldIds.includes(nameField.id) &&
      !hiddenFieldPool.hiddenFieldIds.includes('invalid-field-id') &&
      hiddenFieldPool.hiddenFieldIds.includes(hideableField.id),
  )
  const deletedHiddenPool = await request(
    'DELETE',
    `/resource-pools/${hiddenFieldPool.id}`,
    admin.headers,
  )
  check('临时隐藏字段公海可清理', deletedHiddenPool.ok)
}

const scopedLeadPool = await post('/resource-pools', admin.headers, {
  module: 'lead',
  name: `冒烟专属线索池-${stamp}`,
  scopeIds: [`user:${sales.user.id}`],
})
const salesPoolOptions = await get('/resource-pools/options?module=lead', sales.headers)
const managerPoolOptions = await get('/resource-pools/options?module=lead', manager.headers)
check(
  '多池 Scope：命中成员可见专属线索池',
  Array.isArray(salesPoolOptions) && salesPoolOptions.some((pool) => pool.id === scopedLeadPool.id),
)
check(
  '多池 Scope：未命中成员不可见专属线索池',
  Array.isArray(managerPoolOptions) && !managerPoolOptions.some((pool) => pool.id === scopedLeadPool.id),
)
const batchLead = await post('/leads', admin.headers, {
  name: `批量领取线索-${stamp}`,
  toPool: true,
  poolId: scopedLeadPool.id,
})
const batchClaim = await post('/leads/batch/claim', sales.headers, {
  ids: [batchLead.id, `missing-${stamp}`],
  poolId: scopedLeadPool.id,
})
check(
  '批量领取局部失败不回滚成功项',
  batchClaim.success === 1 && batchClaim.fail === 1 && batchClaim.failedIds?.length === 1,
)
const deletedBatchLead = await request('DELETE', `/leads/${batchLead.id}`, manager.headers)
check('批量领取临时线索可清理', deletedBatchLead.ok)
const deletedScopedLeadPool = await request(
  'DELETE',
  `/resource-pools/${scopedLeadPool.id}`,
  admin.headers,
)
check('专属临时线索池可清理', deletedScopedLeadPool.ok)

const recycleLead = await post('/leads', admin.headers, {
  name: `自动回收线索-${stamp}`,
  ownerId: sales.user.id,
})
const recycleAt = Date.parse(recycleLead.createdAt)
const autoRecyclePool = await post('/resource-pools', admin.headers, {
  module: 'lead',
  name: `冒烟自动回收池-${stamp}`,
  scopeIds: [`user:${sales.user.id}`],
  autoRecycle: true,
  recycleRule: {
    operator: 'AND',
    conditions: [
      {
        column: 'storageTime',
        operator: 'FIXED',
        value: `${recycleAt},${recycleAt}`,
        scope: ['Created'],
      },
    ],
  },
})
const recycleRun = await post('/pool-rules/run-now', admin.headers)
check('新 ResourcePool 条件回收 run-now 执行', typeof recycleRun.recycledLeads === 'number')
const recycledPoolRows = await get(
  `/leads?scope=pool&poolId=${autoRecyclePool.id}&pageSize=100`,
  sales.headers,
)
check(
  'FIXED 自动回收条件只命中临时线索并进入目标池',
  Array.isArray(recycledPoolRows.items) && recycledPoolRows.items.some((item) => item.id === recycleLead.id),
)
const recycledHistory = await get(`/leads/${recycleLead.id}/owner-history`, sales.headers)
check(
  '自动回收写入负责人历史',
  Array.isArray(recycledHistory) &&
    recycledHistory.some((item) => item.ownerId === sales.user.id && item.poolId === autoRecyclePool.id),
)
const deletedRecycleLead = await request('DELETE', `/leads/${recycleLead.id}`, admin.headers)
check('自动回收临时线索可清理', deletedRecycleLead.ok)
const deletedAutoRecyclePool = await request(
  'DELETE',
  `/resource-pools/${autoRecyclePool.id}`,
  admin.headers,
)
check('自动回收临时池可清理', deletedAutoRecyclePool.ok)

const lead = await post('/leads', admin.headers, {
  name: `冒烟线索-${stamp}`,
  contactName: '测试联系人',
  toPool: true,
})
check('创建池内线索', lead.inPool === true)
const claimed = await post(`/leads/${lead.id}/claim`, sales.headers)
check('专员领取线索', Boolean(claimed.name))
const movedBack = await post(`/leads/${lead.id}/to-pool`, manager.headers, {})
check('主管将线索退回匹配线索池', Boolean(movedBack.poolId))
const ownerHistory = await get(`/leads/${lead.id}/owner-history`, manager.headers)
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
const reclaimed = await post(`/leads/${lead.id}/claim`, sales.headers)
check('专员再次领取线索', Boolean(reclaimed.name))
await post('/follow-ups', sales.headers, {
  targetType: 'lead',
  targetId: lead.id,
  type: '电话',
  content: '冒烟跟进',
})
const converted = await post(`/leads/${lead.id}/convert`, sales.headers, {
  createContact: true,
  opportunity: { name: `冒烟商机-${stamp}`, amount: 66000 },
})
check('线索转化（客户+联系人+商机）', Boolean(converted.customerId && converted.opportunityId))

const savedLeadView = await post('/saved-views/lead', admin.headers, {
  name: `冒烟线索视图-${stamp}`,
  searchMode: 'AND',
  conditions: [
    {
      field: 'name',
      operator: 'contains',
      value: `冒烟线索-${stamp}`,
      fieldType: 'text',
    },
  ],
})
check('创建 SavedView', Boolean(savedLeadView.id))
const savedLeadList = await get(`/leads?pageSize=100&viewId=${savedLeadView.id}`, admin.headers)
check(
  'SavedView 条件参与列表查询',
  Array.isArray(savedLeadList.items) && savedLeadList.items.some((item) => item.id === lead.id),
)
const fixedSavedView = await request(
  'POST',
  `/saved-views/detail/${savedLeadView.id}/fixed`,
  admin.headers,
)
check('SavedView 固定状态可切换', fixedSavedView.ok)
const deletedSavedView = await request(
  'DELETE',
  `/saved-views/detail/${savedLeadView.id}`,
  admin.headers,
)
check('SavedView 可删除', deletedSavedView.ok)

const dups = await get(
  `/customers/check-duplicate?name=${encodeURIComponent(`冒烟线索-${stamp}`)}`,
  admin.headers,
)
check('客户查重命中', Array.isArray(dups) && dups.some((h) => h.source === 'customer'))
const related = await get(`/customers/${converted.customerId}/related`, sales.headers)
check(
  '客户360关联数据',
  related.stats && Array.isArray(related.contacts) && Array.isArray(related.opportunities),
)

const historyCustomer = await post('/customers', manager.headers, {
  name: `负责人历史客户-${stamp}`,
})
await post(`/customers/${historyCustomer.id}/assign`, manager.headers, { ownerId: sales.user.id })
const customerOwnerHistory = await get(
  `/customers/${historyCustomer.id}/owner-history`,
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
const collabCustomer = await post('/customers', manager.headers, {
  name: `协作权限客户-${stamp}`,
})
await post(`/customers/${collabCustomer.id}/team`, manager.headers, {
  userId: sales.user.id,
  collaborationType: 'READ_ONLY',
})
const team = await get(`/customers/${collabCustomer.id}/team`, manager.headers)
const salesTeamMember = team.find((item) => item.userId === sales.user.id)
check('READ_ONLY 协作关系创建', Boolean(salesTeamMember))
if (!salesTeamMember) throw new Error('未创建 READ_ONLY 协作关系，无法继续协作权限冒烟')
const readOnlyDetail = await get(`/customers/${collabCustomer.id}`, sales.headers)
check('READ_ONLY 可读取客户详情', readOnlyDetail.id === collabCustomer.id)
const readOnlyContacts = await get(`/contacts/list/${collabCustomer.id}`, sales.headers)
check('READ_ONLY 不额外获得联系人列表', Array.isArray(readOnlyContacts) && readOnlyContacts.length === 0)
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
const deniedReadOnlyContact = await request('POST', '/contacts/add', sales.headers, {
  customerId: collabCustomer.id,
  name: `只读联系人-${stamp}`,
})
check('READ_ONLY 禁止新增联系人', deniedReadOnlyContact.status === 403)
const deniedReadOnlyRelation = await request(
  'PUT',
  `/customers/${collabCustomer.id}/relations`,
  sales.headers,
  { relations: [] },
)
check('READ_ONLY 禁止编辑客户关系', deniedReadOnlyRelation.status === 403)
const deniedCustomerUpdate = await request(
  'PATCH',
  `/customers/${collabCustomer.id}`,
  sales.headers,
  { remark: 'READ_ONLY 不应修改客户主体' },
)
check('READ_ONLY 禁止修改客户主体', [403, 404].includes(deniedCustomerUpdate.status))

const collaborationUpgrade = await request(
  'PATCH',
  `/customers/${collabCustomer.id}/team/${salesTeamMember.id}`,
  manager.headers,
  { collaborationType: 'COLLABORATION' },
)
check('协作类型可升级为 COLLABORATION', collaborationUpgrade.ok)
const collaborationContact = await post('/contacts/add', sales.headers, {
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
const relationGroup = await post('/customers', manager.headers, {
  name: `冒烟集团-${stamp}`,
})
const relationSubsidiary = await post('/customers', manager.headers, {
  name: `冒烟子公司-${stamp}`,
})
const customerOptions = await get(
  `/customers/options?keyword=${encodeURIComponent(`冒烟集团-${stamp}`)}`,
  sales.headers,
)
check(
  '客户关系 options 可按租户搜索 id/name',
  Array.isArray(customerOptions) && customerOptions.some((item) => item.id === relationGroup.id),
)
const collaborationRelationSave = await request(
  'PUT',
  `/customers/${collabCustomer.id}/relations`,
  sales.headers,
  {
    relations: [
      { relationType: 'GROUP', customerId: relationGroup.id },
      { relationType: 'SUBSIDIARY', customerId: relationSubsidiary.id },
    ],
  },
)
check('COLLABORATION 可整组保存客户关系', collaborationRelationSave.ok)
const relationRows = await get(`/customers/${collabCustomer.id}/relations`, sales.headers)
check(
  '客户关系列表返回集团与子公司',
  Array.isArray(relationRows) &&
    relationRows.some((item) => item.relationType === 'GROUP' && item.customerId === relationGroup.id) &&
    relationRows.some(
      (item) => item.relationType === 'SUBSIDIARY' && item.customerId === relationSubsidiary.id,
    ),
)

const mergeTarget = await post('/customers', manager.headers, {
  name: `冒烟合并主客户-${stamp}`,
})
const mergeSource = await post('/customers', manager.headers, {
  name: `冒烟合并副客户-${stamp}`,
})
await post('/contacts/add', manager.headers, {
  customerId: mergeTarget.id,
  name: `冲突联系人-${stamp}`,
  phone: `138${stamp.slice(-8).padStart(8, '0')}`,
})
await post('/contacts/add', manager.headers, {
  customerId: mergeSource.id,
  name: `冲突联系人-${stamp}`,
  phone: `138${stamp.slice(-8).padStart(8, '0')}`,
})
const mergePayload = {
  mergeIds: [mergeTarget.id, mergeSource.id],
  toMergeId: mergeTarget.id,
  ownerId: manager.user.id,
  contactConflictStrategy: 'SKIP_DUPLICATES',
}
const mergePreview = await post('/customers/merge/preview', manager.headers, mergePayload)
check(
  '客户合并 preview 识别联系人冲突',
  mergePreview.counts?.customersToDelete === 1 &&
    mergePreview.counts?.contactsWillSkip === 1 &&
    mergePreview.contactConflicts?.length === 1,
)
const mergeResult = await post('/customers/merge', manager.headers, mergePayload)
check('客户合并执行成功', mergeResult.id === mergeTarget.id && mergeResult.merged === 1)
const mergedSourceGone = await request('GET', `/customers/${mergeSource.id}`, manager.headers)
check('被合并客户已移除', mergedSourceGone.status === 404)
const mergedContacts = await get(`/contacts/list/${mergeTarget.id}`, manager.headers)
check(
  'SKIP_DUPLICATES 执行结果与 preview 一致',
  Array.isArray(mergedContacts) &&
    mergedContacts.filter((item) => item.name === `冲突联系人-${stamp}`).length === 1,
)

const filteredCapacity = await post('/resource-capacities', admin.headers, {
  module: 'customer',
  scopeIds: [`user:${sales.user.id}`],
  capacity: 1,
  filters: [{ key: 'name', op: 'notEmpty' }],
})
if (sales.user.deptId) {
  const overlappingCapacity = await request('POST', '/resource-capacities', admin.headers, {
    module: 'customer',
    scopeIds: [`dept:${sales.user.deptId}`],
    capacity: 99,
  })
  check('客户库容范围按实际成员交集防重复', overlappingCapacity.status === 400)
}
const capacityCustomerA = await post('/customers', sales.headers, {
  name: `库容过滤客户A-${stamp}`,
})
const capacityCustomerB = await post('/customers', sales.headers, {
  name: `库容过滤客户B-${stamp}`,
})
check(
  '客户库容过滤：命中过滤条件的数据不计入容量',
  Boolean(capacityCustomerA.id && capacityCustomerB.id),
)
const deletedCapacityA = await request('DELETE', `/customers/${capacityCustomerA.id}`, manager.headers)
const deletedCapacityB = await request('DELETE', `/customers/${capacityCustomerB.id}`, manager.headers)
check('库容过滤临时客户可清理', deletedCapacityA.ok && deletedCapacityB.ok)
const deletedFilteredCapacity = await request(
  'DELETE',
  `/resource-capacities/${filteredCapacity.id}`,
  admin.headers,
)
check('临时客户库容配置可清理', deletedFilteredCapacity.ok)

// 4.2 R1 批量字段修改 / 删除：字段 ID/key、owner 副作用、客户引用保护
const leadFields = await get('/metadata/lead/fields', admin.headers)
const leadContactField = leadFields.find((field) => field.key === 'contactName')
const leadBatchA = await post('/leads', admin.headers, {
  name: `批量编辑线索A-${stamp}`,
  ownerId: sales.user.id,
})
const leadBatchB = await post('/leads', admin.headers, {
  name: `批量编辑线索B-${stamp}`,
  ownerId: sales.user.id,
})
const leadBatchIds = [leadBatchA.id, leadBatchB.id]
const leadBatchContactName = `批量联系人-${stamp}`
const leadBatchFieldResult = await post('/leads/batch/update', admin.headers, {
  ids: leadBatchIds,
  fieldId: leadContactField?.id,
  fieldValue: leadBatchContactName,
})
const leadBatchRows = await get(`/leads?pageSize=20&keyword=${encodeURIComponent('批量编辑线索')}`, admin.headers)
check(
  'Lead 批量字段修改支持字段 ID',
  leadBatchFieldResult.success === 2 &&
    leadBatchRows.items?.filter((item) => leadBatchIds.includes(item.id)).every((item) => item.contactName === leadBatchContactName),
)
const leadBatchOwnerResult = await post('/leads/batch/update', admin.headers, {
  ids: leadBatchIds,
  fieldId: 'ownerId',
  fieldValue: admin.user.id,
})
const leadBatchHistory = await get(`/leads/${leadBatchA.id}/owner-history`, admin.headers)
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
const leadCustomBatchResult = await post('/leads/batch/update', admin.headers, {
  ids: leadBatchIds,
  fieldId: leadBatchCustomField.key,
  fieldValue: leadBatchCustomValue,
})
const leadCustomBatchRows = await get(
  `/leads?pageSize=20&keyword=${encodeURIComponent('批量编辑线索')}`,
  admin.headers,
)
check(
  'Lead 自定义字段支持批量修改',
  leadCustomBatchResult.success === 2 &&
    leadCustomBatchRows.items
      ?.filter((item) => leadBatchIds.includes(item.id))
      .every((item) => item.customData?.[leadBatchCustomField.key] === leadBatchCustomValue),
)
const leadBatchDelete = await post('/leads/batch/delete', admin.headers, { ids: leadBatchIds })
const deletedLeadBatchRows = await get(
  `/leads?pageSize=20&keyword=${encodeURIComponent('批量编辑线索')}`,
  admin.headers,
)
check(
  'Lead 批量删除同步清理临时数据',
  leadBatchDelete.success === 2 &&
    !deletedLeadBatchRows.items?.some((item) => leadBatchIds.includes(item.id)),
)
await request('DELETE', `/metadata/fields/${leadBatchCustomField.id}`, admin.headers)

const customerPhoneField = fields.find((field) => field.key === 'phone')
const customerBatchA = await post('/customers', admin.headers, { name: `批量编辑客户A-${stamp}` })
const customerBatchB = await post('/customers', admin.headers, { name: `批量编辑客户B-${stamp}` })
const customerBatchIds = [customerBatchA.id, customerBatchB.id]
const customerBatchPhone = `139${stamp.slice(-8).padStart(8, '0')}`
const customerBatchFieldResult = await post('/customers/batch/update', admin.headers, {
  ids: customerBatchIds,
  fieldId: customerPhoneField?.id,
  fieldValue: customerBatchPhone,
})
const customerBatchDetail = await get(`/customers/${customerBatchA.id}`, admin.headers)
check(
  'Customer 批量字段修改支持字段 ID',
  customerBatchFieldResult.success === 2 && customerBatchDetail.phone === customerBatchPhone,
)
const customerBatchOwnerResult = await post('/customers/batch/update', admin.headers, {
  ids: customerBatchIds,
  fieldId: 'ownerId',
  fieldValue: manager.user.id,
})
const customerBatchHistory = await get(`/customers/${customerBatchA.id}/owner-history`, admin.headers)
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
const customerCustomBatchResult = await post('/customers/batch/update', admin.headers, {
  ids: customerBatchIds,
  fieldId: customerBatchCustomField.id,
  fieldValue: customerBatchCustomValue,
})
const customerCustomBatchDetail = await get(`/customers/${customerBatchA.id}`, admin.headers)
check(
  'Customer 自定义字段支持批量修改',
  customerCustomBatchResult.success === 2 &&
    customerCustomBatchDetail.customData?.[customerBatchCustomField.key] === customerBatchCustomValue,
)
const protectedContact = await post('/contacts/add', admin.headers, {
  customerId: customerBatchA.id,
  name: `批量删除保护联系人-${stamp}`,
})
const protectedCustomerDelete = await request('POST', '/customers/batch/delete', admin.headers, {
  ids: customerBatchIds,
})
check('Customer 批量删除存在 Contact 引用时整批拒绝', protectedCustomerDelete.status === 400)
const customerBatchBStillExists = await get(`/customers/${customerBatchB.id}`, admin.headers)
check('Customer 批量删除引用保护不会部分删除', customerBatchBStillExists.id === customerBatchB.id)
await get(`/contacts/delete/${protectedContact.id}`, admin.headers)
const protectedOpportunity = await post('/opportunities', admin.headers, {
  name: `批量删除保护商机-${stamp}`,
  customerId: customerBatchA.id,
})
const opportunityProtectedDelete = await request('POST', '/customers/batch/delete', admin.headers, {
  ids: customerBatchIds,
})
check('Customer 批量删除存在 Opportunity 引用时整批拒绝', opportunityProtectedDelete.status === 400)
await request('DELETE', `/opportunities/${protectedOpportunity.id}`, admin.headers)
const customerBatchDelete = await post('/customers/batch/delete', admin.headers, { ids: customerBatchIds })
check('Customer 无引用后允许整批删除', customerBatchDelete.success === 2)
await request('DELETE', `/metadata/fields/${customerBatchCustomField.id}`, admin.headers)

// 4.3 R1 池/公海独立批量权限：功能权限 + Pool Scope 两层同时成立
const restrictedLeadPool = await post('/resource-pools', admin.headers, {
  module: 'lead',
  name: `R1受限线索池-${stamp}`,
  scopeIds: [`user:${sales.user.id}`],
})
const restrictedPoolLead = await post('/leads', admin.headers, {
  name: `R1受限池线索-${stamp}`,
  toPool: true,
  poolId: restrictedLeadPool.id,
})
const salesPoolUpdateDenied = await request('POST', '/leads/pool/batch/update', sales.headers, {
  poolId: restrictedLeadPool.id,
  ids: [restrictedPoolLead.id],
  fieldId: leadContactField?.id,
  fieldValue: '无池功能权限',
})
check('线索池：Scope 成员缺少独立池 UPDATE 权限时拒绝', salesPoolUpdateDenied.status === 403)
const managerPoolMemberDenied = await request('POST', '/leads/pool/batch/update', manager.headers, {
  poolId: restrictedLeadPool.id,
  ids: [restrictedPoolLead.id],
  fieldId: leadContactField?.id,
  fieldValue: '无池成员权限',
})
check('线索池：有池 UPDATE 权限但不是池成员时拒绝', managerPoolMemberDenied.status === 403)
await request('DELETE', `/leads/${restrictedPoolLead.id}`, admin.headers)
await request('DELETE', `/resource-pools/${restrictedLeadPool.id}`, admin.headers)

const managerLeadPool = await post('/resource-pools', admin.headers, {
  module: 'lead',
  name: `R1主管线索池-${stamp}`,
  scopeIds: [`user:${manager.user.id}`],
})
const poolLeadA = await post('/leads', admin.headers, {
  name: `R1池批改线索A-${stamp}`,
  toPool: true,
  poolId: managerLeadPool.id,
})
const poolLeadB = await post('/leads', admin.headers, {
  name: `R1池批改线索B-${stamp}`,
  toPool: true,
  poolId: managerLeadPool.id,
})
const poolLeadUpdate = await post('/leads/pool/batch/update', manager.headers, {
  poolId: managerLeadPool.id,
  ids: [poolLeadA.id, poolLeadB.id],
  fieldId: leadContactField?.id,
  fieldValue: `池批量联系人-${stamp}`,
})
check('线索池：独立权限 + Scope 命中时可批量修改', poolLeadUpdate.success === 2)
const poolLeadOwner = await post('/leads', admin.headers, {
  name: `R1池负责人批改-${stamp}`,
  toPool: true,
  poolId: managerLeadPool.id,
})
const poolLeadAssignByUpdate = await post('/leads/pool/batch/update', manager.headers, {
  poolId: managerLeadPool.id,
  ids: [poolLeadOwner.id],
  fieldId: 'ownerId',
  fieldValue: manager.user.id,
})
const assignedPoolLeadRows = await get(
  `/leads?pageSize=20&keyword=${encodeURIComponent(`R1池负责人批改-${stamp}`)}`,
  manager.headers,
)
check(
  '线索池：owner 批改复用分配并离开池',
  poolLeadAssignByUpdate.success === 1 && assignedPoolLeadRows.items?.some((item) => item.id === poolLeadOwner.id),
)
const poolLeadDelete = await post('/leads/pool/batch/delete', manager.headers, {
  poolId: managerLeadPool.id,
  ids: [poolLeadA.id, poolLeadB.id],
})
check('线索池：独立 DELETE 权限可批量删除同池记录', poolLeadDelete.success === 2)
await request('DELETE', `/leads/${poolLeadOwner.id}`, manager.headers)
await request('DELETE', `/resource-pools/${managerLeadPool.id}`, admin.headers)

const managerCustomerPool = await post('/resource-pools', admin.headers, {
  module: 'customer',
  name: `R1主管客户公海-${stamp}`,
  scopeIds: [`user:${manager.user.id}`],
})
const poolCustomerA = await post('/customers', admin.headers, { name: `R1公海批改客户A-${stamp}` })
const poolCustomerB = await post('/customers', admin.headers, { name: `R1公海批改客户B-${stamp}` })
await post(`/customers/${poolCustomerA.id}/to-sea`, admin.headers, { poolId: managerCustomerPool.id })
await post(`/customers/${poolCustomerB.id}/to-sea`, admin.headers, { poolId: managerCustomerPool.id })
const poolCustomerUpdate = await post('/customers/pool/batch/update', manager.headers, {
  poolId: managerCustomerPool.id,
  ids: [poolCustomerA.id, poolCustomerB.id],
  fieldId: customerPhoneField?.id,
  fieldValue: `137${stamp.slice(-8).padStart(8, '0')}`,
})
check('客户公海：独立权限 + Scope 命中时可批量修改', poolCustomerUpdate.success === 2)
const poolCustomerOwner = await post('/customers', admin.headers, { name: `R1公海负责人批改-${stamp}` })
await post(`/customers/${poolCustomerOwner.id}/to-sea`, admin.headers, { poolId: managerCustomerPool.id })
const poolCustomerAssignByUpdate = await post('/customers/pool/batch/update', manager.headers, {
  poolId: managerCustomerPool.id,
  ids: [poolCustomerOwner.id],
  fieldId: 'ownerId',
  fieldValue: manager.user.id,
})
const assignedPoolCustomer = await get(`/customers/${poolCustomerOwner.id}`, manager.headers)
check(
  '客户公海：Scope 成员 owner 批改复用分配且不要求池管理员',
  poolCustomerAssignByUpdate.success === 1 &&
    assignedPoolCustomer.ownerId === manager.user.id &&
    assignedPoolCustomer.inSea === false,
)
const poolCustomerDelete = await post('/customers/pool/batch/delete', manager.headers, {
  poolId: managerCustomerPool.id,
  ids: [poolCustomerA.id, poolCustomerB.id],
})
check('客户公海：独立 DELETE 权限可批量删除同池无引用客户', poolCustomerDelete.success === 2)
await request('DELETE', `/customers/${poolCustomerOwner.id}`, manager.headers)
await request('DELETE', `/resource-pools/${managerCustomerPool.id}`, admin.headers)

const collaborationContacts = await get(`/contacts/list/${collabCustomer.id}`, sales.headers)
check(
  'COLLABORATION 仅看到自己负责的联系人',
  Array.isArray(collaborationContacts) &&
    collaborationContacts.length >= 1 &&
    collaborationContacts.every((item) => item.ownerId === sales.user.id),
)
const deniedCollabCustomerUpdate = await request(
  'PATCH',
  `/customers/${collabCustomer.id}`,
  sales.headers,
  { remark: 'COLLABORATION 仍不应修改客户主体' },
)
check('COLLABORATION 仍禁止修改客户主体', [403, 404].includes(deniedCollabCustomerUpdate.status))

// R2 xlsx 导入导出：模板 → 预检 → 正式导入 → 更新 → 导出任务 → 下载隔离
const leadImportFields = await get('/metadata/lead/fields', manager.headers)
const leadNameField = leadImportFields.find((field) => field.key === 'name')
const leadContactNameField = leadImportFields.find((field) => field.key === 'contactName')
const leadOwnerField = leadImportFields.find((field) => field.key === 'ownerId')
const customerNameImportField = fields.find((field) => field.key === 'name')
const customerPhoneImportField = fields.find((field) => field.key === 'phone')

const leadTemplateResponse = await fetch(`${base}/leads/import/template?importType=ADD`, {
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
  '/leads/import/pre-check',
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
const leadAddImportRes = await postXlsx('/leads/import', manager.headers, leadAddXlsx, 'ADD')
const leadAddImport = await leadAddImportRes.json()
const r2LeadRows = await get(`/leads?pageSize=20&keyword=${encodeURIComponent(r2LeadName)}`, manager.headers)
const r2Lead = r2LeadRows.items?.find((item) => item.name === r2LeadName)
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
  '/leads/import/pre-check',
  manager.headers,
  leadUpdateXlsx,
  'UPDATE',
)
const leadUpdatePrecheck = await leadUpdatePrecheckRes.json()
const leadUpdateImportRes = await postXlsx('/leads/import', manager.headers, leadUpdateXlsx, 'UPDATE')
const leadUpdateImport = await leadUpdateImportRes.json()
const updatedR2LeadRows = await get(
  `/leads?pageSize=20&keyword=${encodeURIComponent(r2LeadName)}`,
  manager.headers,
)
check(
  'R2 Lead UPDATE 以唯一ID更新',
  leadUpdatePrecheckRes.ok &&
    leadUpdatePrecheck.successCount === 1 &&
    leadUpdateImportRes.ok &&
    leadUpdateImport.successCount === 1 &&
    updatedR2LeadRows.items?.some((item) => item.id === r2Lead?.id && item.contactName === updatedLeadContact),
)

const r2CustomerName = `R2导入客户-${stamp}`
const customerAddXlsx = await buildXlsx(
  [customerNameImportField?.label ?? '客户名称', customerPhoneImportField?.label ?? '联系电话'],
  [[r2CustomerName, `136${stamp.slice(-8).padStart(8, '0')}`]],
)
const customerAddPrecheckRes = await postXlsx(
  '/customers/import/pre-check',
  manager.headers,
  customerAddXlsx,
  'ADD',
)
const customerAddPrecheck = await customerAddPrecheckRes.json()
const customerAddImportRes = await postXlsx('/customers/import', manager.headers, customerAddXlsx, 'ADD')
const customerAddImport = await customerAddImportRes.json()
const r2CustomerRows = await get(
  `/customers?pageSize=20&keyword=${encodeURIComponent(r2CustomerName)}`,
  manager.headers,
)
const r2Customer = r2CustomerRows.items?.find((item) => item.name === r2CustomerName)
check(
  'R2 Customer ADD xlsx 预检 + 正式导入',
  customerAddPrecheckRes.ok &&
    customerAddPrecheck.successCount === 1 &&
    customerAddImportRes.ok &&
    customerAddImport.successCount === 1 &&
    Boolean(r2Customer?.id),
)

const updatedCustomerPhone = `135${stamp.slice(-8).padStart(8, '0')}`
const customerUpdateXlsx = await buildXlsx(
  ['唯一ID', customerPhoneImportField?.label ?? '联系电话'],
  [[r2Customer?.id, updatedCustomerPhone]],
)
const customerUpdatePrecheckRes = await postXlsx(
  '/customers/import/pre-check',
  manager.headers,
  customerUpdateXlsx,
  'UPDATE',
)
const customerUpdatePrecheck = await customerUpdatePrecheckRes.json()
const customerUpdateImportRes = await postXlsx(
  '/customers/import',
  manager.headers,
  customerUpdateXlsx,
  'UPDATE',
)
const customerUpdateImport = await customerUpdateImportRes.json()
const updatedR2Customer = r2Customer?.id ? await get(`/customers/${r2Customer.id}`, manager.headers) : null
check(
  'R2 Customer UPDATE 以唯一ID更新',
  customerUpdatePrecheckRes.ok &&
    customerUpdatePrecheck.successCount === 1 &&
    customerUpdateImportRes.ok &&
    customerUpdateImport.successCount === 1 &&
    updatedR2Customer?.phone === updatedCustomerPhone,
)

const r2LeadPool = await post('/resource-pools', admin.headers, {
  module: 'lead',
  name: `R2导入线索池-${stamp}`,
  scopeIds: [`user:${manager.user.id}`],
})
const r2CustomerPool = await post('/resource-pools', admin.headers, {
  module: 'customer',
  name: `R2导入客户公海-${stamp}`,
  scopeIds: [`user:${manager.user.id}`],
})

const poolLeadTemplateResponse = await fetch(
  `${base}/leads/pool/import/template?importType=ADD&poolId=${r2LeadPool.id}`,
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

const customerOwnerField = fields.find((field) => field.key === 'ownerId')
const poolCustomerTemplateResponse = await fetch(
  `${base}/customers/pool/import/template?importType=ADD&poolId=${r2CustomerPool.id}`,
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
  '/leads/pool/import/pre-check',
  manager.headers,
  poolLeadXlsx,
  'ADD',
  r2LeadPool.id,
)
const poolLeadPrecheck = await poolLeadPrecheckRes.json()
const poolLeadImportRes = await postXlsx(
  '/leads/pool/import',
  manager.headers,
  poolLeadXlsx,
  'ADD',
  r2LeadPool.id,
)
const poolLeadImport = await poolLeadImportRes.json()
const r2PoolLeadRows = await get(
  `/leads?scope=pool&poolId=${r2LeadPool.id}&pageSize=20&keyword=${encodeURIComponent(r2PoolLeadName)}`,
  manager.headers,
)
const r2PoolLead = r2PoolLeadRows.items?.find((item) => item.name === r2PoolLeadName)
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
  '/customers/pool/import',
  manager.headers,
  poolCustomerXlsx,
  'ADD',
  r2CustomerPool.id,
)
const poolCustomerImport = await poolCustomerImportRes.json()
const r2PoolCustomerRows = await get(
  `/customers?scope=sea&poolId=${r2CustomerPool.id}&pageSize=20&keyword=${encodeURIComponent(r2PoolCustomerName)}`,
  manager.headers,
)
const r2PoolCustomer = r2PoolCustomerRows.items?.find((item) => item.name === r2PoolCustomerName)
check(
  'R2 客户公海 xlsx 导入直接写入公海且无负责人',
  poolCustomerImport.successCount === 1 &&
    r2PoolCustomer?.inSea === true &&
    r2PoolCustomer?.poolId === r2CustomerPool.id &&
    r2PoolCustomer?.ownerId === null,
)

const deniedPoolImport = await postXlsx(
  '/leads/pool/import/pre-check',
  sales.headers,
  poolLeadXlsx,
  'ADD',
  r2LeadPool.id,
)
check('R2 池导入要求独立功能权限', deniedPoolImport.status === 403)

const leadExportAllRes = await request(
  'POST',
  `/leads/export/all?keyword=${encodeURIComponent(r2LeadName)}`,
  manager.headers,
  { fileName: `R2线索导出-${stamp}`, headList: ['name', 'contactName', 'status'] },
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
  `/leads/pool/export/select?poolId=${r2LeadPool.id}`,
  manager.headers,
  {
    fileName: `R2池线索导出-${stamp}`,
    headList: ['name', 'createdAt'],
    ids: [r2PoolLead.id],
  },
)
const poolLeadExportTask = await poolLeadExportRes.json()
check(
  'R2 线索池导出选中使用独立权限 + PoolMember',
  poolLeadExportRes.ok && poolLeadExportTask.status === 'SUCCESS' && poolLeadExportTask.rowCount === 1,
)
const customerExportRes = await request(
  'POST',
  `/customers/export/select`,
  manager.headers,
  {
    fileName: `R2客户导出-${stamp}`,
    headList: ['name', 'phone'],
    ids: [r2Customer.id],
  },
)
const customerExportTask = await customerExportRes.json()
check(
  'R2 Customer 导出选中严格按 ids',
  customerExportRes.ok && customerExportTask.status === 'SUCCESS' && customerExportTask.rowCount === 1,
)
const poolCustomerExportRes = await request(
  'POST',
  `/customers/pool/export/select?poolId=${r2CustomerPool.id}`,
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
  `/leads/pool/export/all?poolId=${r2LeadPool.id}`,
  sales.headers,
  { fileName: `R2禁止导出-${stamp}`, headList: ['name'] },
)
check('R2 池导出要求独立功能权限', deniedPoolExport.status === 403)

await request('DELETE', `/export-tasks/${leadExportTask.id}`, manager.headers)
await request('DELETE', `/export-tasks/${poolLeadExportTask.id}`, manager.headers)
await request('DELETE', `/export-tasks/${customerExportTask.id}`, manager.headers)
await request('DELETE', `/export-tasks/${poolCustomerExportTask.id}`, manager.headers)
if (r2Lead?.id) await request('DELETE', `/leads/${r2Lead.id}`, manager.headers)
if (r2Customer?.id) await request('DELETE', `/customers/${r2Customer.id}`, manager.headers)
if (r2PoolLead?.id) {
  await post('/leads/pool/batch/delete', manager.headers, { poolId: r2LeadPool.id, ids: [r2PoolLead.id] })
}
if (r2PoolCustomer?.id) {
  await post('/customers/pool/batch/delete', manager.headers, {
    poolId: r2CustomerPool.id,
    ids: [r2PoolCustomer.id],
  })
}
await request('DELETE', `/resource-pools/${r2LeadPool.id}`, admin.headers)
await request('DELETE', `/resource-pools/${r2CustomerPool.id}`, admin.headers)

// R3 联系人源码对齐：独立数据范围 / 状态 / 商机关联 / 批改 / xlsx 导入导出
const contactTabsAdmin = await get('/contacts/tab', admin.headers)
const contactTabsManager = await get('/contacts/tab', manager.headers)
const contactTabsSales = await get('/contacts/tab', sales.headers)
check('R3 Contact tab：ALL 角色显示全部和部门视图', contactTabsAdmin.all && contactTabsAdmin.dept)
check('R3 Contact tab：部门角色只显示部门视图', !contactTabsManager.all && contactTabsManager.dept)
check('R3 Contact tab：SELF 角色不显示全部/部门视图', !contactTabsSales.all && !contactTabsSales.dept)

const r3ContactField = await post('/metadata/contact/fields', admin.headers, {
  label: `R3联系人字段-${stamp}`,
  type: 'text',
})
const r3Customer = await post('/customers', manager.headers, {
  name: `R3联系人客户-${stamp}`,
})
const r3OtherCustomer = await post('/customers', manager.headers, {
  name: `R3联系人其他客户-${stamp}`,
})
const r3ManagerContact = await post('/contacts/add', manager.headers, {
  customerId: r3Customer.id,
  name: `R3主管联系人-${stamp}`,
  phone: `137${stamp.slice(-8).padStart(8, '0')}`,
  customData: { [r3ContactField.key]: '主管自定义值' },
})
const r3SalesContact = await post('/contacts/add', manager.headers, {
  customerId: r3Customer.id,
  ownerId: sales.user.id,
  name: `R3销售联系人-${stamp}`,
  phone: `134${stamp.slice(-8).padStart(8, '0')}`,
})

const managerContactPage = await post('/contacts/page', manager.headers, {
  page: 1,
  pageSize: 100,
  keyword: `R3`,
  scopeView: 'DEPT',
})
check(
  'R3 独立联系人 DEPT 视图按联系人 owner/dept 返回',
  managerContactPage.items.some((item) => item.id === r3ManagerContact.id) &&
    managerContactPage.items.some((item) => item.id === r3SalesContact.id),
)
const salesContactPage = await post('/contacts/page', sales.headers, {
  page: 1,
  pageSize: 100,
  keyword: `R3`,
  scopeView: 'SELF',
})
check(
  'R3 独立联系人 SELF 视图只返回本人负责人数据',
  salesContactPage.items.some((item) => item.id === r3SalesContact.id) &&
    !salesContactPage.items.some((item) => item.id === r3ManagerContact.id),
)
const r3ManagerContactDetail = await get(`/contacts/get/${r3ManagerContact.id}`, manager.headers)
check(
  'R3 Contact customData 随详情返回',
  r3ManagerContactDetail.customData?.[r3ContactField.key] === '主管自定义值',
)

const blankDisable = await request(
  'POST',
  `/contacts/disable/${r3ManagerContact.id}`,
  manager.headers,
  { reason: '' },
)
check('R3 联系人停用原因必填', blankDisable.status === 400)
await post(`/contacts/disable/${r3ManagerContact.id}`, manager.headers, { reason: `R3停用-${stamp}` })
const disabledContact = await get(`/contacts/get/${r3ManagerContact.id}`, manager.headers)
check(
  'R3 联系人停用保存原因',
  disabledContact.enable === false && disabledContact.disableReason === `R3停用-${stamp}`,
)
await get(`/contacts/enable/${r3ManagerContact.id}`, manager.headers)
const enabledContact = await get(`/contacts/get/${r3ManagerContact.id}`, manager.headers)
check('R3 联系人重新启用会清空停用原因', enabledContact.enable === true && enabledContact.disableReason === null)

const r3BatchValue = `R3批改-${stamp}`
const r3BatchResult = await post('/contacts/batch/update', manager.headers, {
  ids: [r3ManagerContact.id, r3SalesContact.id],
  fieldId: r3ContactField.id,
  fieldValue: r3BatchValue,
})
const r3BatchPage = await post('/contacts/page', manager.headers, {
  page: 1,
  pageSize: 100,
  keyword: `R3`,
  scopeView: 'DEPT',
})
check(
  'R3 联系人批量字段修改',
  r3BatchResult.success === 2 &&
    r3BatchPage.items
      .filter((item) => [r3ManagerContact.id, r3SalesContact.id].includes(item.id))
      .every((item) => item.customData?.[r3ContactField.key] === r3BatchValue),
)

const r3Opportunity = await post('/opportunities', manager.headers, {
  name: `R3联系人商机-${stamp}`,
  customerId: r3Customer.id,
  contactId: r3ManagerContact.id,
})
check('R3 Opportunity 可绑定联系人', r3Opportunity.contactId === r3ManagerContact.id)
const r3OpportunityCheck = await get(`/contacts/opportunity/check/${r3ManagerContact.id}`, manager.headers)
check('R3 删除前可检查商机关联', r3OpportunityCheck.linked && r3OpportunityCheck.count >= 1)
const deniedLinkedContactDelete = await request(
  'GET',
  `/contacts/delete/${r3ManagerContact.id}`,
  manager.headers,
)
check('R3 Service 级阻止删除已关联商机联系人', deniedLinkedContactDelete.status === 400)
const invalidOpportunityContact = await request(
  'PATCH',
  `/opportunities/${r3Opportunity.id}`,
  manager.headers,
  { contactId: r3SalesContact.id, customerId: r3OtherCustomer.id },
)
check('R3 Opportunity 联系人必须属于当前客户', invalidOpportunityContact.status === 400)

const contactFields = await get('/metadata/contact/fields', manager.headers)
const contactNameField = contactFields.find((field) => field.key === 'name')
const contactCustomerField = contactFields.find((field) => field.key === 'customerId')
const contactPhoneField = contactFields.find((field) => field.key === 'phone')
const contactEnableField = contactFields.find((field) => field.key === 'enable')
const contactTemplateResponse = await fetch(`${base}/contacts/template/download`, {
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
  [contactCustomerField?.label ?? '客户', contactNameField?.label ?? '姓名', contactPhoneField?.label ?? '电话'],
  [[r3Customer.name, r3ImportedContactName, `133${stamp.slice(-8).padStart(8, '0')}`]],
)
const r3ContactPrecheckRes = await postXlsx(
  '/contacts/import/pre-check',
  manager.headers,
  r3ContactAddXlsx,
  'ADD',
)
const r3ContactPrecheck = await r3ContactPrecheckRes.json()
const r3ContactImportRes = await postXlsx('/contacts/import', manager.headers, r3ContactAddXlsx, 'ADD')
const r3ContactImport = await r3ContactImportRes.json()
const r3ImportedPage = await post('/contacts/page', manager.headers, {
  page: 1,
  pageSize: 100,
  keyword: r3ImportedContactName,
  scopeView: 'DEPT',
})
const r3ImportedContact = r3ImportedPage.items.find((item) => item.name === r3ImportedContactName)
check(
  'R3 联系人 xlsx ADD 预检 + 正式导入',
  r3ContactPrecheckRes.ok &&
    r3ContactPrecheck.successCount === 1 &&
    r3ContactImportRes.ok &&
    r3ContactImport.successCount === 1 &&
    Boolean(r3ImportedContact?.id),
)

if (r3ImportedContact?.id) {
  await post(`/contacts/disable/${r3ImportedContact.id}`, manager.headers, { reason: '验证导入更新重新启用' })
}
const r3UpdatedPhone = `132${stamp.slice(-8).padStart(8, '0')}`
const r3ContactUpdateXlsx = await buildXlsx(
  ['唯一ID', contactPhoneField?.label ?? '电话'],
  [[r3ImportedContact?.id, r3UpdatedPhone]],
)
const r3ContactUpdateRes = await postXlsx('/contacts/import', manager.headers, r3ContactUpdateXlsx, 'UPDATE')
const r3ContactUpdate = await r3ContactUpdateRes.json()
const r3UpdatedContact = r3ImportedContact?.id
  ? await get(`/contacts/get/${r3ImportedContact.id}`, manager.headers)
  : null
check(
  'R3 联系人 UPDATE 按唯一ID更新并重新启用',
  r3ContactUpdateRes.ok &&
    r3ContactUpdate.successCount === 1 &&
    r3UpdatedContact?.phone === r3UpdatedPhone &&
    r3UpdatedContact?.enable === true,
)

const deniedContactImport = await postXlsx(
  '/contacts/import/pre-check',
  sales.headers,
  r3ContactAddXlsx,
  'ADD',
)
check('R3 联系人导入使用独立 IMPORT 权限', deniedContactImport.status === 403)

const r3ContactExportRes = await request('POST', '/contacts/export-all', manager.headers, {
  page: 1,
  pageSize: 100,
  keyword: `R3`,
  scopeView: 'DEPT',
  fileName: `R3联系人导出-${stamp}`,
  headList: ['name', 'customerId', 'ownerId', 'enable'],
})
const r3ContactExportTask = await r3ContactExportRes.json()
check(
  'R3 联系人导出全部创建 ExportTask',
  r3ContactExportRes.ok && r3ContactExportTask.status === 'SUCCESS' && r3ContactExportTask.rowCount >= 3,
)
const r3ContactSelectExportRes = await request('POST', '/contacts/export-select', manager.headers, {
  page: 1,
  pageSize: 100,
  scopeView: 'DEPT',
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
const deniedContactExport = await request('POST', '/contacts/export-all', sales.headers, {
  page: 1,
  pageSize: 20,
  scopeView: 'SELF',
  fileName: `R3禁止导出-${stamp}`,
  headList: ['name'],
})
check('R3 联系人导出使用独立 EXPORT 权限', deniedContactExport.status === 403)

await request('DELETE', `/export-tasks/${r3ContactExportTask.id}`, manager.headers)
await request('DELETE', `/export-tasks/${r3ContactSelectExportTask.id}`, manager.headers)
await request('PATCH', `/opportunities/${r3Opportunity.id}`, manager.headers, { contactId: '' })
await request('DELETE', `/opportunities/${r3Opportunity.id}`, manager.headers)
if (r3ImportedContact?.id) await get(`/contacts/delete/${r3ImportedContact.id}`, manager.headers)
await get(`/contacts/delete/${r3ManagerContact.id}`, manager.headers)
await get(`/contacts/delete/${r3SalesContact.id}`, manager.headers)
await request('DELETE', `/customers/${r3Customer.id}`, manager.headers)
await request('DELETE', `/customers/${r3OtherCustomer.id}`, manager.headers)
await request('DELETE', `/metadata/fields/${r3ContactField.id}`, admin.headers)

const importedDup = await post('/customers/import/rows', admin.headers, {
  rows: [{ name: `冒烟线索-${stamp}` }],
})
check('导入重复行拦截', importedDup.failed >= 1)

const oppWithItems = await post('/opportunities', manager.headers, {
  name: `冒烟明细商机-${stamp}`,
  customerId: converted.customerId,
  items: [{ productName: '冒烟产品', quantity: 2, unitPrice: 15000, discount: 100 }],
})
check(
  '商机明细汇总金额',
  oppWithItems.amount === 30000 && oppWithItems.items?.length === 1,
)
const quoteFromOpp = await post('/quotes', manager.headers, {
  name: `冒烟带入报价-${stamp}`,
  customerId: converted.customerId,
  opportunityId: oppWithItems.id,
})
check(
  '报价从商机带入明细',
  quoteFromOpp.totalAmount === 30000 && quoteFromOpp.items?.length === 1,
)

// 5. 商机推进赢单
const stages = await get('/opportunities/stages', sales.headers)
const won = stages.find((s) => s.isWon)
await post(`/opportunities/${converted.opportunityId}/stage`, sales.headers, { stageId: won.id })
const kanban = await get('/opportunities/kanban', sales.headers)
check('商机赢单与看板', kanban.stages.some((s) => s.isWon && s.count >= 1))

// 6. 交易链：报价→合同→回款→发票→订单
const quote = await post('/quotes', manager.headers, {
  name: `冒烟报价-${stamp}`,
  customerId: converted.customerId,
  items: [{ productName: '冒烟服务', quantity: 1, unitPrice: 30000, discount: 100 }],
})
check('创建报价', quote.totalAmount === 30000)
const contract = await post('/contracts', manager.headers, {
  name: `冒烟合同-${stamp}`,
  customerId: converted.customerId,
  fromQuoteId: quote.id,
})
check('从报价创建合同', contract.amount === 30000 && contract.items?.length === 1)
await post(`/contracts/${contract.id}/status`, manager.headers, { status: 'EXECUTING' })
const plan = await post('/contracts/receivable-plans', manager.headers, {
  contractId: contract.id,
  amount: 30000,
  dueDate: '2026-12-31',
})
await post('/contracts/receivable-records', manager.headers, {
  contractId: contract.id,
  planId: plan.id,
  amount: 30000,
  receivedAt: new Date().toISOString().slice(0, 10),
})
const contractDetail = await get(`/contracts/${contract.id}`, manager.headers)
check('回款计入合同汇总', contractDetail.paidAmount === 30000)
const order = await post('/orders', manager.headers, {
  name: `冒烟订单-${stamp}`,
  contractId: contract.id,
  amount: 30000,
})
check('创建订单', Boolean(order.code))

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
const listed = await get(`/attachments?targetType=contract&targetId=${contract.id}`, manager.headers)
check('列出附件', Array.isArray(listed) && listed.some((a) => a.id === uploaded.id))
const downloaded = await fetch(`${base}/attachments/${uploaded.id}/download`, {
  headers: { Authorization: manager.headers.Authorization },
})
check('下载附件', downloaded.ok)

// 7. 审批流（合同 8 万以上需审批：直接生效被拦截 → 提审 → 两级通过自动生效）
const bigContract = await post('/contracts', sales.headers, {
  name: `冒烟审批合同-${stamp}`,
  customerId: converted.customerId,
  items: [{ productName: '大额服务', quantity: 1, unitPrice: 88000, discount: 100 }],
})
const blocked = await fetch(`${base}/contracts/${bigContract.id}/status`, {
  method: 'POST',
  headers: sales.headers,
  body: JSON.stringify({ status: 'EXECUTING' }),
})
check('大额合同直接生效被拦截', blocked.status === 400)
await post('/approvals/submit', sales.headers, { module: 'contract', targetId: bigContract.id })
const managerPending = await get('/approvals/my-pending?pageSize=5', manager.headers)
const task1 = managerPending.items.find((i) => i.targetId === bigContract.id)
check('直属上级收到审批待办', Boolean(task1?.myPendingTaskId))
await post(`/approvals/tasks/${task1.myPendingTaskId}/approve`, manager.headers, { comment: '同意' })
const adminPending = await get('/approvals/my-pending?pageSize=5', admin.headers)
const task2 = adminPending.items.find((i) => i.targetId === bigContract.id)
await post(`/approvals/tasks/${task2.myPendingTaskId}/approve`, admin.headers, { comment: '批准' })
const approvedContract = await get(`/contracts/${bigContract.id}`, sales.headers)
check(
  '审批通过后合同自动生效',
  approvedContract.status === 'EXECUTING' && approvedContract.approvalStatus === 'APPROVED',
)

// 8. 标讯
const fetchResult = await post('/bidding/fetch-now', manager.headers)
check('标讯抓取', typeof fetchResult.fetched === 'number')
const biddingList = await get('/bidding?pageSize=1', manager.headers)
check('标讯列表', biddingList.total >= 1)

// 9. 报表
const summary = await get('/dashboard/summary', admin.headers)
check('工作台简报', typeof summary.wonAmount === 'number')
const funnel = await get('/dashboard/funnel', admin.headers)
check('商机漏斗', Array.isArray(funnel) && funnel.length > 0)

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
