import { approvalFlowWriteFromDetail, explicitApprovalFlowRequest } from './helpers/approval-flow-graph.mjs'

const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let orderId = ''
let createdFlowId = ''
let flowRestore = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
    return
  }
  failed += 1
  console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function apiRequest(method, path, body, allowed = []) {
  body = explicitApprovalFlowRequest(path, method, body)
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const raw = await response.text()
  let data
  try { data = raw ? JSON.parse(raw) : null } catch { data = raw }
  if (!response.ok && !allowed.includes(response.status)) {
    throw new Error(`${method} ${path} -> ${response.status} ${raw}`)
  }
  return { response, data, raw }
}

function flowWrite(detail, enabled = detail.enabled) {
  return approvalFlowWriteFromDetail(detail, enabled)
}

async function disableOrderFlows() {
  const page = (await apiRequest('GET', '/approvals/flows?formType=order&page=1&pageSize=100')).data
  flowRestore = []
  for (const item of page.items ?? []) {
    const detail = (await apiRequest('GET', `/approvals/flows/${item.id}`)).data
    if (String(detail.name ?? '').startsWith('W365 Browser')) {
      await apiRequest('PUT', `/approvals/flows/${item.id}`, flowWrite(detail, false))
      await apiRequest('DELETE', `/approvals/flows/${item.id}`)
      continue
    }
    flowRestore.push({ id: item.id, body: flowWrite(detail) })
    await apiRequest('PUT', `/approvals/flows/${item.id}`, flowWrite(detail, false))
  }
}

async function restoreOrderFlows() {
  if (createdFlowId) {
    try {
      const detail = (await apiRequest('GET', `/approvals/flows/${createdFlowId}`)).data
      await apiRequest('PUT', `/approvals/flows/${createdFlowId}`, flowWrite(detail, false))
      await apiRequest('DELETE', `/approvals/flows/${createdFlowId}`)
    } catch {
      // best effort cleanup
    }
  }
  for (const original of flowRestore) {
    try { await apiRequest('PUT', `/approvals/flows/${original.id}`, original.body) } catch {
      // best effort restore
    }
  }
}

async function cleanupStaleFixtures() {
  const page = (await apiRequest('POST', '/order/page', {
    current: 1,
    pageSize: 100,
    keyword: 'W365 Browser Order',
  })).data
  for (const item of page.list ?? []) {
    await apiRequest('GET', `/order/delete/${item.id}`, undefined, [404])
  }
}

async function cleanupFixture() {
  if (!orderId) return
  try {
    const current = (await apiRequest('GET', `/order/get/${orderId}`, undefined, [404])).data
    if (current?.approvalStatus === 'APPROVING') {
      try {
        await apiRequest('POST', '/approval-resource/revoke', { resourceId: orderId, formKey: 'order' })
      } catch {
        // flow may already be disabled or instance may already be closed
      }
    }
    await apiRequest('GET', `/order/delete/${orderId}`, undefined, [404])
  } catch {
    // best effort cleanup
  }
}

async function loadPageTarget() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((response) => response.json())
      const page = targets.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // Chrome may still be starting.
    }
    await sleep(100)
  }
  throw new Error(`无法连接 Chrome DevTools: ${debugBase}`)
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.exceptions = []
    this.requests = []
    this.responses = []
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params.exceptionDetails?.text ?? 'Runtime exception')
      }
      if (message.method === 'Network.requestWillBeSent') {
        this.requests.push({
          method: message.params.request.method,
          url: message.params.request.url,
          postData: message.params.request.postData,
        })
      }
      if (message.method === 'Network.responseReceived') {
        this.responses.push({ status: message.params.response.status, url: message.params.response.url })
      }
    })
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable')])
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '浏览器表达式执行失败')
    return result.result?.value
  }

  async navigate(path) {
    const targetUrl = `${webBase}${path}`
    const marker = `w365-${Date.now()}-${Math.random()}`
    await this.evaluate(`window.__w365NavigationMarker=${JSON.stringify(marker)};true`)
    await this.send('Page.navigate', { url: targetUrl })
    await this.waitFor(
      `location.href===${JSON.stringify(targetUrl)} && window.__w365NavigationMarker!==${JSON.stringify(marker)} && document.readyState!=='loading' && document.body!==null`,
      10000,
      `页面加载 ${path}`,
    )
  }

  async waitFor(expression, timeoutMs, label) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }

  requestCount(pathname, method, start = 0) {
    return this.requests.slice(start).filter((item) => {
      try {
        return new URL(item.url).pathname === pathname && (!method || item.method === method)
      } catch {
        return false
      }
    }).length
  }

  lastRequest(pathname, method) {
    return [...this.requests].reverse().find((item) => {
      try {
        return new URL(item.url).pathname === pathname && (!method || item.method === method)
      } catch {
        return false
      }
    })
  }

  lastResponse(pathname) {
    return [...this.responses].reverse().find((item) => {
      try { return new URL(item.url).pathname === pathname } catch { return false }
    })
  }

  close() { this.socket.close() }
}

const textIncludes = (text) => `document.body?.innerText.includes(${JSON.stringify(text)})===true`

async function clickExact(cdp, text, selector = 'button') {
  return cdp.evaluate(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent?.trim()===${JSON.stringify(text)} && item.getBoundingClientRect().width>0)
    el?.click(); return Boolean(el)
  })()`)
}

async function clickRowAction(cdp, rowName, action) {
  return cdp.evaluate(`(() => {
    const row=[...document.querySelectorAll('.el-table__row')].find((item)=>item.textContent?.includes(${JSON.stringify(rowName)}) && item.getBoundingClientRect().width>0)
    const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()===${JSON.stringify(action)})
    button?.click(); return Boolean(button)
  })()`)
}

async function waitForRequest(cdp, pathname, method, before, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (cdp.requestCount(pathname, method) > before) return true
    await sleep(100)
  }
  return false
}

async function waitForResponse(cdp, pathname, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const response = cdp.lastResponse(pathname)
    if (response) return response
    await sleep(100)
  }
  return undefined
}

async function waitForOrderStatus(id, status, timeoutMs = 10000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = (await apiRequest('GET', `/order/get/${id}`)).data
    if (last?.approvalStatus === status) return last
    await sleep(100)
  }
  throw new Error(`订单 ${id} 未进入 ${status}，当前=${last?.approvalStatus ?? 'unknown'}`)
}

async function closeVisibleDrawer(cdp) {
  return cdp.evaluate(`(() => {
    const drawers=[...document.querySelectorAll('.el-drawer')].filter((item)=>item.getBoundingClientRect().width>0)
    const drawer=drawers.at(-1)
    const button=drawer?.querySelector('.el-drawer__close-btn')
    button?.click(); return Boolean(button)
  })()`)
}

async function main() {
  console.log('\nW3.6.5 订单 Browser Smoke')
  const login = await apiRequest('POST', '/auth/login', { email: 'admin@demo.com', password: 'admin123' })
  if (!login.data?.accessToken) throw new Error('管理员登录失败')
  token = login.data.accessToken
  const userId = login.data.user.id
  const suffix = Date.now().toString(36)
  const orderName = `W365 Browser Order ${suffix}`

  await disableOrderFlows()
  try {
    await cleanupStaleFixtures()
    const contracts = (await apiRequest('POST', '/contract/page', { current: 1, pageSize: 100 })).data
    const contract = contracts.list?.find((item) => item.customerId && item.id)
    if (!contract?.id || !contract.customerId) throw new Error('缺少可用于订单 Browser Smoke 的合同')

    const created = (await apiRequest('POST', '/order/add', {
      name: orderName,
      customerId: contract.customerId,
      contractId: contract.id,
      owner: userId,
      amount: 8.88,
    })).data
    orderId = created.id
    check('Browser 夹具订单在流程关闭时为 NONE', created.approvalStatus === 'NONE', created.approvalStatus)

    const flow = (await apiRequest('POST', '/approvals/flows', {
      formType: 'order',
      name: `W365 Browser Order Flow ${suffix}`,
      description: 'W3.6.5 order browser smoke',
      enabled: true,
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
      createNodes: [{
        name: '管理员审批',
        approverType: 'USER',
        approverIds: [userId],
        ccUserIds: [],
        mode: 'ANY',
      }],
    })).data
    createdFlowId = flow.id

    const target = await loadPageTarget()
    const cdp = new CdpClient(target.webSocketDebuggerUrl)
    await cdp.connect()
    try {
      await Promise.all([
        cdp.send('Storage.clearDataForOrigin', { origin: webBase, storageTypes: 'all' }),
        cdp.send('Network.clearBrowserCookies'),
        cdp.send('Network.clearBrowserCache'),
      ])
      await cdp.navigate('/login')
      await cdp.waitFor(textIncludes('演示账号：admin@demo.com / admin123'), 10000, '登录页')
      check('管理员登录按钮可点击', await cdp.evaluate(`(() => {
        const button=[...document.querySelectorAll('button')].find((item)=>item.textContent?.replace(/\\s/g,'').includes('登录'))
        button?.click(); return Boolean(button)
      })()`))
      await cdp.waitFor(`location.pathname==='/dashboard'`, 10000, '管理员登录')

      const pageStart = cdp.requests.length
      await cdp.navigate('/order/index')
      await cdp.waitFor(textIncludes('新建订单'), 10000, '独立订单页')
      await cdp.waitFor(textIncludes(orderName), 10000, '订单夹具列表')
      await sleep(400)
      check('订单独立路由为 /order/index', await cdp.evaluate(`location.pathname==='/order/index'`))
      check('订单页读取 module form', cdp.requestCount('/api/order/module/form', 'GET', pageStart) >= 1)
      check('订单页读取 Saved View', cdp.requestCount('/api/order/view/list', 'GET', pageStart) >= 1)
      check('订单页读取 scope tab', cdp.requestCount('/api/order/tab', 'GET', pageStart) >= 1)
      check('订单页有 Import/Export', await cdp.evaluate(`document.body.innerText.includes('导入') && document.body.innerText.includes('导出全部')`))
      check('订单页有动态筛选与列表/看板', await cdp.evaluate(`document.body.innerText.includes('高级筛选') && document.body.innerText.includes('列表') && document.body.innerText.includes('看板')`))

      check('订单详情可打开', await clickRowAction(cdp, orderName, '详情'))
      await cdp.waitFor(textIncludes('订单冻结快照'), 5000, '订单详情 Drawer')
      check('订单详情展示审批详情与表单快照', await cdp.evaluate(`document.body.innerText.includes('审批详情') && document.body.innerText.includes('表单配置快照')`))
      await closeVisibleDrawer(cdp)

      const boardBefore = cdp.requestCount('/api/order/page', 'POST')
      check('看板切换可点击', await clickExact(cdp, '看板', '.el-segmented__item'))
      await waitForRequest(cdp, '/api/order/page', 'POST', boardBefore)
      await cdp.waitFor(textIncludes(orderName), 5000, '订单看板')
      const boardRequest = cdp.lastRequest('/api/order/page', 'POST')
      check('看板请求 board=true', String(boardRequest?.postData ?? '').includes('"board":true'), boardRequest?.postData ?? '')
      check('列表切换可点击', await clickExact(cdp, '列表', '.el-segmented__item'))
      await cdp.waitFor(`document.querySelectorAll('.el-table__row').length>0`, 5000, '恢复订单列表')

      const pushBefore = cdp.requestCount('/api/approval-resource/push', 'POST')
      check('订单行可提交审批', await clickRowAction(cdp, orderName, '提交审批'))
      await waitForRequest(cdp, '/api/approval-resource/push', 'POST', pushBefore)
      const pushResponse = await waitForResponse(cdp, '/api/approval-resource/push')
      check('提交审批接口响应成功', Boolean(pushResponse && pushResponse.status < 400), JSON.stringify(pushResponse))
      const pushed = await waitForOrderStatus(orderId, 'APPROVING')
      check('提交审批后状态 APPROVING', pushed.approvalStatus === 'APPROVING', pushed.approvalStatus)
      check('提交审批调用统一 approval-resource', cdp.requestCount('/api/approval-resource/push', 'POST') > pushBefore)
      await cdp.waitFor(textIncludes('撤回'), 10000, '订单审批中操作')

      const revokeBefore = cdp.requestCount('/api/approval-resource/revoke', 'POST')
      check('订单行可发起撤回', await clickRowAction(cdp, orderName, '撤回'))
      await cdp.waitFor(textIncludes('撤回订单'), 5000, '订单撤回确认')
      check('订单撤回确认可点击', await clickExact(cdp, '确定'))
      await waitForRequest(cdp, '/api/approval-resource/revoke', 'POST', revokeBefore)
      const revokeResponse = await waitForResponse(cdp, '/api/approval-resource/revoke')
      check('撤回审批接口响应成功', Boolean(revokeResponse && revokeResponse.status < 400), JSON.stringify(revokeResponse))
      const revoked = await waitForOrderStatus(orderId, 'REVOKED')
      check('撤回后状态 REVOKED', revoked.approvalStatus === 'REVOKED', revoked.approvalStatus)

      const customerStart = cdp.requests.length
      await cdp.navigate(`/customers/${contract.customerId}`)
      await cdp.waitFor(textIncludes('订单'), 10000, '客户详情')
      await sleep(700)
      const customerOrderRequest = cdp.requests.slice(customerStart).find((item) => {
        try { return new URL(item.url).pathname === '/api/order/page' && item.method === 'POST' && String(item.postData ?? '').includes(contract.customerId) } catch { return false }
      })
      check('客户 360 复用 direct OrderTable', Boolean(customerOrderRequest), customerOrderRequest?.postData ?? 'no order request')
      check('客户订单 Tab 可点击', await clickExact(cdp, '订单', '.el-tabs__item'))
      await cdp.waitFor(textIncludes(orderName), 5000, '客户订单 Tab 数据')

      const contractStart = cdp.requests.length
      await cdp.navigate(`/contracts?id=${contract.id}`)
      await cdp.waitFor(textIncludes(contract.name), 10000, '合同详情 Drawer')
      await sleep(700)
      const contractOrderRequest = cdp.requests.slice(contractStart).find((item) => {
        try { return new URL(item.url).pathname === '/api/order/page' && item.method === 'POST' && String(item.postData ?? '').includes(contract.id) } catch { return false }
      })
      check('合同详情复用 direct OrderTable', Boolean(contractOrderRequest), contractOrderRequest?.postData ?? 'no order request')
      check('合同订单 Tab 可点击', await clickExact(cdp, '订单', '.el-tabs__item'))
      await cdp.waitFor(textIncludes(orderName), 5000, '合同订单 Tab 数据')
      check('合同转订单入口存在', await clickExact(cdp, '转订单'))
      await cdp.waitFor(`location.pathname==='/order/index' && new URLSearchParams(location.search).get('fromContract')===${JSON.stringify(contract.id)}`, 10000, '合同转订单深链')
      await cdp.waitFor(`(() => {
        const drawers=[...document.querySelectorAll('.el-drawer')].filter((item)=>item.getBoundingClientRect().width>0)
        const input=drawers.at(-1)?.querySelector('input')
        return input?.value===${JSON.stringify(`${contract.name}-订单`)}
      })()`, 5000, '合同转订单预填 Drawer')
      check('合同转订单预填关键字段', await cdp.evaluate(`document.body.innerText.includes('客户') && document.body.innerText.includes('合同') && document.body.innerText.includes('负责人') && document.body.innerText.includes('产品信息')`))
      await closeVisibleDrawer(cdp)

      await cdp.navigate('/system/modules')
      await cdp.waitFor(`document.querySelector('[data-module-config-key="order"]')!==null`, 10000, '订单模块设置卡片')
      await sleep(500)
      check('订单表单设置为 REAL', await cdp.evaluate(`(() => {
        const row=document.querySelector('[data-module-config-key="order"]')
        const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='订单表单设置')
        return Boolean(button && !button.disabled)
      })()`))
      check('订单状态流设置为 REAL', await cdp.evaluate(`(() => {
        const row=document.querySelector('[data-module-config-key="order"]')
        const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='订单状态流设置')
        return Boolean(button && !button.disabled)
      })()`))

      const metadataBefore = cdp.requestCount('/api/metadata/order/fields', 'GET')
      check('订单表单设置可点击', await cdp.evaluate(`(() => {
        const row=document.querySelector('[data-module-config-key="order"]')
        const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='订单表单设置')
        button?.click(); return Boolean(button)
      })()`))
      await cdp.waitFor(`location.pathname==='/system/modules/fields' && new URLSearchParams(location.search).get('module')==='order'`, 10000, '订单表单设置导航')
      await cdp.waitFor(textIncludes('订单名称'), 10000, '订单 direct metadata 页面')
      check('订单表单设置消费 direct metadata', cdp.requestCount('/api/metadata/order/fields', 'GET') > metadataBefore)

      await cdp.navigate('/system/modules')
      await cdp.waitFor(`document.querySelector('[data-module-config-key="order"]')!==null`, 10000, '订单模块设置卡片重载')
      const stageBefore = cdp.requestCount('/api/order/stage/get', 'GET')
      check('订单状态流设置可点击', await cdp.evaluate(`(() => {
        const row=document.querySelector('[data-module-config-key="order"]')
        const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='订单状态流设置')
        button?.click(); return Boolean(button)
      })()`))
      await cdp.waitFor(`(() => { const el=document.querySelector('[data-testid="order-stage-settings-drawer"]'); return Boolean(el && el.getBoundingClientRect().width>0) })()`, 10000, '订单状态流 Drawer')
      await cdp.waitFor(`document.querySelector('[data-testid="order-stage-settings-drawer"]')?.innerText.includes('待发货')===true`, 10000, '订单状态流 direct 数据')
      const stageText = await cdp.evaluate(`document.querySelector('[data-testid="order-stage-settings-drawer"]')?.innerText ?? ''`)
      check('订单状态流 Drawer 请求 direct stage API', cdp.requestCount('/api/order/stage/get', 'GET') > stageBefore)
      check('订单状态流 Drawer 展示默认 7 阶段', ['新建','待发货','部分发货','已发货','待验收','已完成','已作废'].every((text) => stageText.includes(text)), stageText)
      check('订单状态流 Drawer 暴露 rollback/NORMAL/ADVANCED', ['进行中允许回退','完结后允许回退','基础流转','高级流转','添加阶段'].every((text) => stageText.includes(text)))

      const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
      check('Browser Smoke API 5xx = 0', api5xx.length === 0, JSON.stringify(api5xx))
      check('Browser Smoke Runtime exception = 0', cdp.exceptions.length === 0, JSON.stringify(cdp.exceptions))
    } finally {
      cdp.close()
    }
  } finally {
    try {
      if (createdFlowId) {
        const detail = (await apiRequest('GET', `/approvals/flows/${createdFlowId}`)).data
        await apiRequest('PUT', `/approvals/flows/${createdFlowId}`, flowWrite(detail, false))
      }
    } catch {
      // best effort
    }
    await cleanupFixture()
    await restoreOrderFlows()
  }

  console.log(`\nW3.6.5 Order Browser Smoke: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

main().catch(async (error) => {
  console.error(error)
  try { await cleanupFixture() } catch {
    // preserve the original Browser Smoke error
  }
  try { await restoreOrderFlows() } catch {
    // preserve the original Browser Smoke error
  }
  process.exit(1)
})
