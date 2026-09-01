const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
const restoreFlows = []
let adminToken = ''
let adminRefreshToken = ''
let managerToken = ''
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
    await this.setViewport(1440, 1000, false)
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async setViewport(width, height, mobile) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: mobile ? 3 : 1,
      mobile,
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
  responseCount(pathname) {
    return this.responses.filter((item) => {
      try { return new URL(item.url).pathname === pathname } catch { return false }
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

async function waitForRequest(cdp, pathname, before) {
  const start = Date.now()
  while (Date.now() - start < 10000 && cdp.requestCount(pathname, 'POST') === before) await sleep(100)
  return cdp.requestCount(pathname, 'POST') > before
}

async function waitForResponse(cdp, pathname) {
  const start = Date.now()
  let response
  while (Date.now() - start < 10000 && !response) {
    response = cdp.lastResponse(pathname)
    if (!response) await sleep(100)
  }
  return response
}

async function main() {
  console.log('\nW3.7-9.3D 审批人任务撤回 Browser Smoke')
  const admin = (await api('POST', '/auth/login', { email: 'admin@demo.com', password: 'admin123' }, '')).data
  const manager = (await api('POST', '/auth/login', { email: 'zhangwei@demo.com', password: 'admin123' }, '')).data
  adminToken = admin.accessToken
  adminRefreshToken = admin.refreshToken
  managerToken = manager.accessToken
  const suffix = Date.now().toString(36)

  await disableOrderFlows()
  try {
    const flowBody = {
      name: `W370 Revoke Browser ${suffix}`,
      description: 'W3.7-9.3D approver revoke browser smoke',
      enabled: true,
      createExecute: true,
      updateExecute: false,
      deleteExecute: false,
      submitterCanRevoke: true,
      allowBatchProcess: false,
      allowWithdraw: true,
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
      const createdFlow = (await api('POST', '/approvals/flows', { formType: 'order', ...flowBody })).data
      flowId = createdFlow.id
      flowCreated = true
    }
    const currentFlow = (await api('GET', `/approvals/flows/${flowId}`)).data
    check('流程设置允许审批人撤回', currentFlow.allowWithdraw === true)

    customerId = (await api('POST', '/account/add', { name: `W370 Revoke Customer ${suffix}` })).data.id
    const orderName = `W370 Revoke Browser Order ${suffix}`
    orderId = (await api('POST', '/order/add', {
      name: orderName,
      customerId,
      owner: admin.user.id,
      amount: 23.45,
    })).data.id
    const first = (await api('GET', `/approvals/instance?module=order&targetId=${orderId}`)).data
    const firstTaskId = first.myPendingTaskId
    await api('POST', `/approvals/tasks/${firstTaskId}/approve`, { comment: 'browser 一级通过' })
    const managerPending = (await api('GET', '/approvals/my-pending?page=1&pageSize=100', undefined, managerToken)).data
      .items.find((item) => item.targetId === orderId)
    check('二级待办已生成', Boolean(managerPending?.myPendingTaskId))
    const firstHandled = (await api('GET', `/approvals/instance?module=order&targetId=${orderId}`)).data
    check('PC 前置数据可撤回', firstHandled.canWithdraw === true && firstHandled.myWithdrawTaskId === firstTaskId)

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
      await cdp.evaluate(`localStorage.setItem('mmx_access_token',${JSON.stringify(adminToken)});localStorage.setItem('mmx_refresh_token',${JSON.stringify(adminRefreshToken)});true`)

      // PC：从“我已处理”详情真正执行审批人撤回。
      await cdp.setViewport(1440, 1000, false)
      await cdp.navigate('/approvals?tab=handled')
      await cdp.waitFor(textIncludes(orderName), 10000, 'PC 已处理列表')
      check('PC 已处理列表展示测试订单', await cdp.evaluate(textIncludes(orderName)))
      check('PC 可打开已处理详情', await cdp.evaluate(`(() => {
        const row=[...document.querySelectorAll('.el-table__row')].find((item)=>item.textContent?.includes(${JSON.stringify(orderName)}) && item.getBoundingClientRect().width>0)
        const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='查看')
        button?.click(); return Boolean(button)
      })()`))
      await cdp.waitFor(textIncludes('撤回审批'), 5000, 'PC 撤回按钮')
      check('PC 详情展示撤回审批按钮', await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        return [...(dialogs.at(-1)?.querySelectorAll('button')??[])].some((item)=>item.textContent?.trim()==='撤回审批')
      })()`))

      const revokePath = `/api/approvals/tasks/${firstTaskId}/revoke`
      const beforePc = cdp.requestCount(revokePath, 'POST')
      await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        const button=[...(dialogs.at(-1)?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='撤回审批')
        button?.click(); return Boolean(button)
      })()`)
      await cdp.waitFor(textIncludes('确认撤回'), 5000, 'PC 撤回确认框')
      check('PC 可确认审批人撤回', await cdp.evaluate(`(() => {
        const box=[...document.querySelectorAll('.el-message-box')].find((item)=>item.getBoundingClientRect().width>0)
        const button=box?.querySelector('.el-message-box__btns .el-button--primary')
        button?.click(); return Boolean(button)
      })()`))
      check('PC UI 调用 revoke API', await waitForRequest(cdp, revokePath, beforePc))
      const pcResponse = await waitForResponse(cdp, revokePath)
      check('PC revoke API 响应成功', Boolean(pcResponse && pcResponse.status < 400), JSON.stringify(pcResponse))
      const afterPc = (await api('GET', `/approvals/instance?module=order&targetId=${orderId}`)).data
      const pcReopened = afterPc.tasks.find((task) => task.id === firstTaskId)
      check('PC 撤回后原 task 同 ID 回开', pcReopened?.status === 'PENDING' && pcReopened?.action === null)
      const pcExpiredManager = afterPc.tasks.find((task) => task.id === managerPending.myPendingTaskId)
      check('PC 撤回后下游旧待办失效', pcExpiredManager?.status === 'SKIPPED')

      // 重新同意，生成二级 round 2，准备 Mobile 已处理入口。
      await api('POST', `/approvals/tasks/${firstTaskId}/approve`, { comment: 'browser 一级重新通过' })
      const managerRound2 = (await api('GET', '/approvals/my-pending?page=1&pageSize=100', undefined, managerToken)).data
        .items.find((item) => item.targetId === orderId)
      const managerRound2Task = managerRound2.tasks.find((task) => task.id === managerRound2.myPendingTaskId)
      check('PC 撤回重审后下游 round 2 重建', managerRound2Task?.nodeRound === 2)

      // Mobile：切换移动视口后，动态路由必须加载 mobile ApprovalsView，并从“我已处理”执行同一动作。
      await cdp.setViewport(390, 844, true)
      await cdp.navigate('/login')
      await cdp.navigate('/approvals')
      await cdp.waitFor(textIncludes('我已审批'), 10000, 'Mobile 审批页')
      check('Mobile 审批页包含我已审批页签', await cdp.evaluate(textIncludes('我已审批')))
      check('Mobile 可切换我已审批', await cdp.evaluate(`(() => {
        const tab=[...document.querySelectorAll('.van-tab')].find((item)=>item.textContent?.trim()==='我已审批')
        tab?.click(); return Boolean(tab)
      })()`))
      await cdp.waitFor(textIncludes(orderName), 10000, 'Mobile 已处理列表')
      check('Mobile 已处理列表展示测试订单', await cdp.evaluate(textIncludes(orderName)))
      check('Mobile 可打开已处理详情', await cdp.evaluate(`(() => {
        const cell=[...document.querySelectorAll('.van-cell')].find((item)=>item.textContent?.includes(${JSON.stringify(orderName)}))
        cell?.click(); return Boolean(cell)
      })()`))
      await cdp.waitFor(textIncludes('撤回审批'), 5000, 'Mobile 撤回按钮')
      check('Mobile 详情展示撤回审批按钮', await cdp.evaluate(`(() => {
        const popup=[...document.querySelectorAll('.van-popup')].find((item)=>item.getBoundingClientRect().height>0)
        return [...(popup?.querySelectorAll('button')??[])].some((item)=>item.textContent?.trim()==='撤回审批')
      })()`))

      const beforeMobile = cdp.requestCount(revokePath, 'POST')
      const beforeMobileResponses = cdp.responseCount(revokePath)
      check('Mobile 可点击撤回审批', await cdp.evaluate(`(() => {
        const popup=[...document.querySelectorAll('.van-popup')].find((item)=>item.getBoundingClientRect().height>0)
        const button=[...(popup?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='撤回审批')
        button?.click(); return Boolean(button)
      })()`))
      check('Mobile UI 调用 revoke API', await waitForRequest(cdp, revokePath, beforeMobile))
      const mobileResponseStart = Date.now()
      while (Date.now() - mobileResponseStart < 10000 && cdp.responseCount(revokePath) === beforeMobileResponses) {
        await sleep(100)
      }
      const mobileResponse = cdp.responseCount(revokePath) > beforeMobileResponses
        ? cdp.lastResponse(revokePath)
        : undefined
      check('Mobile revoke API 响应成功', Boolean(mobileResponse && mobileResponse.status < 400), JSON.stringify(mobileResponse))
      let afterMobile
      const mobileStateStart = Date.now()
      while (Date.now() - mobileStateStart < 10000) {
        afterMobile = (await api('GET', `/approvals/instance?module=order&targetId=${orderId}`)).data
        const task = afterMobile.tasks.find((item) => item.id === firstTaskId)
        if (task?.status === 'PENDING' && task?.action === null) break
        await sleep(100)
      }
      const mobileReopened = afterMobile.tasks.find((task) => task.id === firstTaskId)
      check(
        'Mobile 撤回后原 task 再次回开',
        mobileReopened?.status === 'PENDING' && mobileReopened?.action === null,
        JSON.stringify(mobileReopened),
      )
      const mobileExpiredManager = afterMobile.tasks.find((task) => task.id === managerRound2.myPendingTaskId)
      check(
        'Mobile 撤回后 round 2 下游待办失效',
        mobileExpiredManager?.status === 'SKIPPED',
        JSON.stringify(mobileExpiredManager),
      )

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
