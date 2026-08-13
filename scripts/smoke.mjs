/**
 * 全链路冒烟测试：登录 → 数据范围 → 元数据 → 线索转化 → 交易链 → 审批 → 标讯 → 报表
 * 运行前置：API 已启动（pnpm dev 或 node apps/api/dist/main.js）、已执行种子数据
 * 用法：pnpm smoke
 */
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
const lead = await post('/leads', admin.headers, {
  name: `冒烟线索-${stamp}`,
  contactName: '测试联系人',
  toPool: true,
})
check('创建池内线索', lead.inPool === true)
const claimed = await post(`/leads/${lead.id}/claim`, sales.headers)
check('专员领取线索', Boolean(claimed.name))
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
