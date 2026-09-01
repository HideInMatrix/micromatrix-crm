const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
const restoreFlows = []
let adminToken = ''
let managerToken = ''
let managerRefreshToken = ''
let flowId = ''
let flowCreated = false
let orderId = ''
let customerId = ''

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

async function api(method, path, body, token = adminToken, allowed = []) {
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
  return { response, data }
}

function flowWrite(detail, enabled = detail.enabled) {
  return {
    name: detail.name,
    description: detail.description,
    enabled,
    createExecute: detail.createExecute,
    updateExecute: detail.updateExecute,
    deleteExecute: detail.deleteExecute,
    submitterCanRevoke: detail.submitterCanRevoke,
    allowBatchProcess: detail.allowBatchProcess,
    allowWithdraw: detail.allowWithdraw,
    allowAddSign: detail.allowAddSign,
    duplicateApproverRule: detail.duplicateApproverRule,
    requireComment: detail.requireComment,
    condition: detail.condition,
    createNodes: (detail.createNodes ?? [])
      .filter((node) => node.nodeType === 'APPROVER' && node.approverType && node.mode)
      .map((node) => ({
        clientId: node.id,
        name: node.name,
        approverType: node.approverType,
        approverIds: [...(node.approverIds ?? [])],
        ccUserIds: [...(node.ccUserIds ?? [])],
        mode: node.mode,
      })),
  }
}

async function disableOrderFlows() {
  const page = (await api('GET', '/approvals/flows?formType=order&page=1&pageSize=100')).data
  for (const item of page.items ?? []) {
    const detail = (await api('GET', `/approvals/flows/${item.id}`)).data
    restoreFlows.push({ id: item.id, body: flowWrite(detail) })
    await api('PUT', `/approvals/flows/${item.id}`, flowWrite(detail, false))
  }
}

async function cleanup() {
  if (flowId) {
    try {
      const detail = (await api('GET', `/approvals/flows/${flowId}`)).data
      await api('PUT', `/approvals/flows/${flowId}`, flowWrite(detail, false))
      if (flowCreated) {
        await api('DELETE', `/approvals/flows/${flowId}`, undefined, adminToken, [400, 404])
      }
    } catch { /* best effort */ }
  }
  if (orderId) {
    try { await api('GET', `/order/delete/${orderId}`, undefined, adminToken, [400, 404]) } catch { /* best effort */ }
  }
  if (customerId) {
    try { await api('GET', `/account/delete/${customerId}`, undefined, adminToken, [400, 404]) } catch { /* best effort */ }
  }
  for (const flow of restoreFlows) {
    try { await api('PUT', `/approvals/flows/${flow.id}`, flow.body) } catch { /* best effort */ }
  }
}

async function loadPageTarget() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((response) => response.json())
      const page = targets.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* Chrome starting */ }
    await sleep(100)
  }
  throw new Error(`无法连接 Chrome DevTools: ${debugBase}`)
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.requests = []
    this.responses = []
    this.exceptions = []
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
        this.requests.push({ method: message.params.request.method, url: message.params.request.url })
      }
      if (message.method === 'Network.responseReceived') {
        this.responses.push({ status: message.params.response.status, url: message.params.response.url })
      }
    })
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable')])
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
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
      expression, awaitPromise: true, returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '浏览器表达式执行失败')
    return result.result?.value
  }
  async navigate(path) {
    const url = `${webBase}${path}`
    await this.send('Page.navigate', { url })
    await this.waitFor(`location.href===${JSON.stringify(url)} && document.readyState!=='loading'`, 10000, path)
  }
  async waitFor(expression, timeoutMs, label) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }
  requestCount(pathname, method) {
    return this.requests.filter((item) => {
      try { return new URL(item.url).pathname === pathname && (!method || item.method === method) } catch { return false }
    }).length
  }
  lastResponse(pathname) {
    return [...this.responses].reverse().find((item) => {
      try { return new URL(item.url).pathname === pathname } catch { return false }
    })
  }
  close() { this.socket.close() }
}

const textIncludes = (text) => `document.body?.innerText.includes(${JSON.stringify(text)})===true`

async function main() {
  console.log('\nW3.7-9.3C 节点退回 Browser Smoke')
  const admin = (await api('POST', '/auth/login', { email: 'admin@demo.com', password: 'admin123' }, '')).data
  const manager = (await api('POST', '/auth/login', { email: 'zhangwei@demo.com', password: 'admin123' }, '')).data
  adminToken = admin.accessToken
  managerToken = manager.accessToken
  managerRefreshToken = manager.refreshToken
  const suffix = Date.now().toString(36)

  await disableOrderFlows()
  try {
    const flowBody = {
      name: `W370 Back Browser ${suffix}`,
      description: 'W3.7-9.3C return-back browser smoke',
      enabled: true,
      createExecute: true,
      updateExecute: false,
      deleteExecute: false,
      submitterCanRevoke: true,
      allowBatchProcess: false,
      allowWithdraw: false,
      allowAddSign: false,
      duplicateApproverRule: 'FIRST_ONLY',
      requireComment: false,
      condition: null,
      createNodes: [
        { name: '一级审批', approverType: 'USER', approverIds: [admin.user.id], ccUserIds: [], mode: 'ANY' },
        { name: '二级审批', approverType: 'USER', approverIds: [manager.user.id], ccUserIds: [], mode: 'ANY' },
      ],
    }
    if (restoreFlows.length) {
      flowId = restoreFlows[0].id
      await api('PUT', `/approvals/flows/${flowId}`, flowBody)
    } else {
      const createdFlow = (await api('POST', '/approvals/flows', {
        formType: 'order',
        ...flowBody,
      })).data
      flowId = createdFlow.id
      flowCreated = true
    }
    const flowDetail = (await api('GET', `/approvals/flows/${flowId}`)).data
    const firstNodeId = flowDetail.createNodes.find((node) => node.nodeType === 'APPROVER')?.id
    check('流程冻结一级节点 ID', Boolean(firstNodeId))

    customerId = (await api('POST', '/account/add', { name: `W370 Back Customer ${suffix}` })).data.id
    const orderName = `W370 Back Browser Order ${suffix}`
    orderId = (await api('POST', '/order/add', {
      name: orderName, customerId, owner: admin.user.id, amount: 12.34,
    })).data.id
    const first = (await api('GET', `/approvals/instance?module=order&targetId=${orderId}`)).data
    check('首节点没有退回入口', first.canReturnBack === false)
    await api('POST', `/approvals/tasks/${first.myPendingTaskId}/approve`, { comment: '一级通过' })
    const second = (await api('GET', `/approvals/instance?module=order&targetId=${orderId}`, undefined, managerToken)).data
    check('二级节点获得退回能力', second.canReturnBack === true && second.returnBackTargets?.[0]?.nodeId === firstNodeId)
    check('UI 数据显示重新进入第 2 轮', second.returnBackTargets?.[0]?.nextRound === 2)

    const target = await loadPageTarget()
    const cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.connect()
    try {
      await Promise.all([
        cdp.send('Storage.clearDataForOrigin', { origin: webBase, storageTypes: 'all' }),
        cdp.send('Network.clearBrowserCookies'),
        cdp.send('Network.clearBrowserCache'),
      ])
      await cdp.navigate('/login')
      await cdp.evaluate(`localStorage.setItem('mmx_access_token',${JSON.stringify(managerToken)});localStorage.setItem('mmx_refresh_token',${JSON.stringify(managerRefreshToken)});true`)
      await cdp.navigate('/approvals')
      await cdp.waitFor(textIncludes(orderName), 10000, '审批待办列表')
      check('待办列表展示测试订单', await cdp.evaluate(textIncludes(orderName)))
      check('可打开审批详情', await cdp.evaluate(`(() => {
        const row=[...document.querySelectorAll('.el-table__row')].find((item)=>item.textContent?.includes(${JSON.stringify(orderName)}) && item.getBoundingClientRect().width>0)
        const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='去审批')
        button?.click(); return Boolean(button)
      })()`))
      await cdp.waitFor(textIncludes('退回节点'), 5000, '退回节点按钮')
      check('详情展示退回节点按钮', await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        return [...(dialogs.at(-1)?.querySelectorAll('button')??[])].some((item)=>item.textContent?.trim()==='退回节点')
      })()`))
      check('可打开退回弹窗', await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        const button=[...(dialogs.at(-1)?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='退回节点')
        button?.click(); return Boolean(button)
      })()`))
      await cdp.waitFor(textIncludes('重新进入第 2 轮'), 5000, '退回节点弹窗')
      check('弹窗显示一级审批与第 2 轮', await cdp.evaluate(`document.body.innerText.includes('一级审批') && document.body.innerText.includes('重新进入第 2 轮')`))
      check('可填写退回原因', await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        const input=dialogs.at(-1)?.querySelector('textarea')
        if (!input) return false
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set?.call(input,'browser return back')
        input.dispatchEvent(new Event('input',{bubbles:true}))
        return true
      })()`))

      const path = `/api/approvals/tasks/${second.myPendingTaskId}/back`
      const before = cdp.requestCount(path, 'POST')
      check('可点击确认退回', await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        const button=[...(dialogs.at(-1)?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='确认退回')
        button?.click(); return Boolean(button)
      })()`))
      await cdp.waitFor(`${cdp.requestCount.bind(cdp) ? 'true' : 'false'}`, 100, 'noop')
      const start = Date.now()
      while (Date.now() - start < 10000 && cdp.requestCount(path, 'POST') === before) await sleep(100)
      check('UI 调用 back API', cdp.requestCount(path, 'POST') > before)
      let response
      const responseStart = Date.now()
      while (Date.now() - responseStart < 10000 && !response) {
        response = cdp.lastResponse(path)
        if (!response) await sleep(100)
      }
      check('back API 响应成功', Boolean(response && response.status < 400), JSON.stringify(response))

      const after = (await api('GET', `/approvals/instance?module=order&targetId=${orderId}`)).data
      check('Browser 写入 ReturnBackRecord', after.returnBackRecords?.[0]?.returnReason === 'browser return back')
      const round2 = after.tasks.find((task) => task.nodeId === firstNodeId && task.nodeRound === 2 && task.status === 'PENDING')
      check('Browser 重建一级审批 round 2', Boolean(round2))
      check('Browser 无 Runtime exception', cdp.exceptions.length === 0, cdp.exceptions.join('; '))
      const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
      check('Browser API 5xx=0', api5xx.length === 0, JSON.stringify(api5xx))
    } finally {
      cdp.close()
    }
  } finally {
    await cleanup()
  }

  console.log(`\n结果：${passed} 通过, ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

main().catch(async (error) => {
  console.error(error)
  try { await cleanup() } catch { /* best effort */ }
  process.exitCode = 1
})
