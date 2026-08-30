const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let createdFlowId = ''
let invoiceId = ''
let titleId = ''
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

async function disableInvoiceFlows() {
  const page = (await apiRequest('GET', '/approvals/flows?formType=invoice&page=1&pageSize=100')).data
  flowRestore = []
  for (const item of page.items ?? []) {
    const detail = (await apiRequest('GET', `/approvals/flows/${item.id}`)).data
    if (String(detail.name ?? '').startsWith('W364 Browser')) {
      await apiRequest('PUT', `/approvals/flows/${item.id}`, flowWrite(detail, false))
      await apiRequest('DELETE', `/approvals/flows/${item.id}`)
      continue
    }
    flowRestore.push({ id: item.id, body: flowWrite(detail) })
    await apiRequest('PUT', `/approvals/flows/${item.id}`, flowWrite(detail, false))
  }
}

async function cleanupStaleFixtures() {
  const invoices = (await apiRequest('POST', '/invoice/page', {
    current: 1,
    pageSize: 100,
    keyword: 'W364 Browser',
  })).data
  for (const invoice of invoices.list ?? []) {
    await apiRequest('GET', `/invoice/delete/${invoice.id}`, undefined, [404])
  }

  const titles = (await apiRequest('POST', '/contract/business-title/page', {
    current: 1,
    pageSize: 100,
    keyword: 'W364 Browser',
  })).data
  for (const title of titles.list ?? []) {
    const used = (await apiRequest('GET', `/contract/business-title/invoice/check/${title.id}`)).data
    if (!used) await apiRequest('GET', `/contract/business-title/delete/${title.id}`, undefined, [404])
  }
}

async function restoreInvoiceFlows() {
  if (createdFlowId) {
    try {
      const detail = (await apiRequest('GET', `/approvals/flows/${createdFlowId}`)).data
      await apiRequest('PUT', `/approvals/flows/${createdFlowId}`, flowWrite(detail, false))
      await apiRequest('DELETE', `/approvals/flows/${createdFlowId}`)
    } catch {
      // best effort fixture cleanup
    }
  }
  for (const original of flowRestore) {
    try { await apiRequest('PUT', `/approvals/flows/${original.id}`, original.body) } catch {
      // best effort restore after smoke failure
    }
  }
}

async function cleanupFixture() {
  try {
    if (createdFlowId) {
      const detail = (await apiRequest('GET', `/approvals/flows/${createdFlowId}`)).data
      await apiRequest('PUT', `/approvals/flows/${createdFlowId}`, flowWrite(detail, false))
    }
  } catch {
    // best effort: a partially-created flow may already be gone
  }
  if (invoiceId) {
    try {
      const current = (await apiRequest('GET', `/invoice/get/${invoiceId}`, undefined, [404])).data
      if (current?.approvalStatus === 'APPROVING') {
        try { await apiRequest('POST', '/approval-resource/revoke', { resourceId: invoiceId }) } catch {
          // best effort: cleanup may continue with direct delete after a failed revoke
        }
      }
      await apiRequest('GET', `/invoice/delete/${invoiceId}`, undefined, [404])
    } catch {
      // best effort fixture cleanup
    }
  }
  if (titleId) {
    try { await apiRequest('GET', `/contract/business-title/delete/${titleId}`, undefined, [404]) } catch {
      // best effort fixture cleanup
    }
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
    const marker = `w364-${Date.now()}-${Math.random()}`
    await this.evaluate(`window.__w364NavigationMarker=${JSON.stringify(marker)};true`)
    await this.send('Page.navigate', { url: targetUrl })
    await this.waitFor(
      `location.href===${JSON.stringify(targetUrl)} && window.__w364NavigationMarker!==${JSON.stringify(marker)} && document.readyState!=='loading' && document.body!==null`,
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

  lastResponse(pathname) {
    return [...this.responses].reverse().find((item) => {
      try {
        return new URL(item.url).pathname === pathname
      } catch {
        return false
      }
    })
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

async function closeVisibleDrawer(cdp) {
  return cdp.evaluate(`(() => {
    const drawers=[...document.querySelectorAll('.el-drawer')].filter((item)=>item.getBoundingClientRect().width>0)
    const drawer=drawers.at(-1)
    const button=drawer?.querySelector('.el-drawer__close-btn')
    button?.click(); return Boolean(button)
  })()`)
}

async function main() {
  console.log('\nW3.6.4 发票 / 工商抬头 Browser Smoke')
  const login = await apiRequest('POST', '/auth/login', { email: 'admin@demo.com', password: 'admin123' })
  if (!login.data?.accessToken) throw new Error('管理员登录失败')
  token = login.data.accessToken
  const userId = login.data.user.id
  const suffix = Date.now().toString(36)
  const invoiceName = `W364 Browser Invoice ${suffix}`
  const titleName = `W364 Browser Title ${suffix}`

  await disableInvoiceFlows()
  try {
    await cleanupStaleFixtures()
    const contracts = (await apiRequest('POST', '/contract/page', { current: 1, pageSize: 100 })).data
    const contract = contracts.list?.find((item) => Number(item.amount ?? 0) >= 10)
    if (!contract?.id) throw new Error('缺少可用于 Browser Smoke 的合同')

    const title = (await apiRequest('POST', '/contract/business-title/add', {
      name: titleName,
      type: 'THIRD_PARTY',
      identificationNumber: `W364${Date.now()}`,
      openingBank: 'Browser Smoke Bank',
      bankAccount: '6222000000000000000',
      registrationAddress: 'Browser Smoke Address',
      phoneNumber: '021-12345678',
      registeredCapital: '1000万人民币',
      companySize: '100-499人',
      registrationNumber: `W364-${suffix}`,
      province: '上海市',
      city: '上海市',
      scale: '中型',
      industry: '软件与信息服务',
      remark: 'W3.6.4 browser smoke',
    })).data
    titleId = title.id
    check('Browser 夹具工商抬头直接通过', title.approvalStatus === 'APPROVED')

    const invoice = (await apiRequest('POST', '/invoice/add', {
      name: invoiceName,
      contractId: contract.id,
      owner: userId,
      amount: 1.23,
      invoiceType: '增值税普通发票',
      taxRate: 6,
      businessTitleId: title.id,
    })).data
    invoiceId = invoice.id
    check('Browser 夹具发票在流程关闭时为 NONE', invoice.approvalStatus === 'NONE')

    const flow = (await apiRequest('POST', '/approvals/flows', {
      formType: 'invoice',
      name: `W364 Browser Invoice Flow ${suffix}`,
      description: 'W3.6.4 browser smoke',
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

      const invoiceStart = cdp.requests.length
      await cdp.navigate('/contract/contractInvoice')
      await cdp.waitFor(textIncludes('新建发票'), 10000, '独立发票页')
      await cdp.waitFor(textIncludes(invoiceName), 10000, '发票夹具列表')
      await sleep(500)
      check('发票独立路由与 Cordys 一致', await cdp.evaluate(`location.pathname==='/contract/contractInvoice'`))
      check('发票页读取 module form', cdp.requestCount('/api/invoice/module/form', 'GET', invoiceStart) >= 1)
      check('发票页读取 Saved View', cdp.requestCount('/api/invoice/view/list', 'GET', invoiceStart) >= 1)
      check('发票页读取 scope tab', cdp.requestCount('/api/invoice/tab', 'GET', invoiceStart) >= 1)
      check('发票页有导入入口', await cdp.evaluate(`document.body.innerText.includes('导入')`))
      check('发票页有导出全部入口', await cdp.evaluate(`document.body.innerText.includes('导出全部')`))

      check('发票详情可打开', await clickRowAction(cdp, invoiceName, '详情'))
      await cdp.waitFor(textIncludes('审批冻结快照'), 5000, '发票详情 Drawer')
      check('发票详情展示审批详情', await cdp.evaluate(`document.body.innerText.includes('审批详情')`))
      await closeVisibleDrawer(cdp)

      const pushBefore = cdp.requestCount('/api/approval-resource/push', 'POST')
      check('发票行可提交审批', await clickRowAction(cdp, invoiceName, '提交审批'))
      await waitForRequest(cdp, '/api/approval-resource/push', 'POST', pushBefore)
      const pushResponse = await waitForResponse(cdp, '/api/approval-resource/push')
      const pushRequest = cdp.lastRequest('/api/approval-resource/push', 'POST')
      const pushedInvoice = (await apiRequest('GET', `/invoice/get/${invoiceId}`)).data
      check('提交审批接口响应成功', Boolean(pushResponse && pushResponse.status < 400), JSON.stringify(pushResponse))
      check(
        '提交审批后后端状态为 APPROVING',
        pushedInvoice.approvalStatus === 'APPROVING',
        pushedInvoice.approvalStatus,
      )
      if (!pushResponse || pushResponse.status >= 400) {
        throw new Error(
          `提交审批失败诊断: status=${pushResponse?.status ?? 'no-response'} postData=${pushRequest?.postData ?? 'none'}`,
        )
      }
      await cdp.waitFor(`document.body.innerText.includes('撤回')`, 10000, '发票审批中状态')
      check('提交审批调用 approval-resource/push', cdp.requestCount('/api/approval-resource/push', 'POST') > pushBefore)

      const revokeBefore = cdp.requestCount('/api/approval-resource/revoke', 'POST')
      check('发票行可撤回审批', await clickRowAction(cdp, invoiceName, '撤回'))
      await waitForRequest(cdp, '/api/approval-resource/revoke', 'POST', revokeBefore)
      await cdp.waitFor(`document.body.innerText.includes('提交审批')`, 10000, '发票撤回状态')
      check('撤回调用 approval-resource/revoke', cdp.requestCount('/api/approval-resource/revoke', 'POST') > revokeBefore)

      check('新建发票 Drawer 可打开', await clickExact(cdp, '新建发票'))
      await cdp.waitFor(textIncludes('开票金额'), 5000, '新建发票 Drawer')
      check('新建发票包含工商抬头字段', await cdp.evaluate(`document.body.innerText.includes('工商抬头')`))
      check('新建发票包含负责人字段', await cdp.evaluate(`document.body.innerText.includes('负责人')`))
      await closeVisibleDrawer(cdp)

      const titleStart = cdp.requests.length
      await cdp.navigate('/contract/contractBusinessName')
      await cdp.waitFor(textIncludes('新建工商抬头'), 10000, '独立工商抬头页')
      await cdp.waitFor(textIncludes(titleName), 10000, '工商抬头夹具列表')
      await sleep(400)
      check('工商抬头独立路由与 Cordys 一致', await cdp.evaluate(`location.pathname==='/contract/contractBusinessName'`))
      check('工商抬头读取 module form', cdp.requestCount('/api/contract/business-title/module/form', 'GET', titleStart) >= 1)
      check('工商抬头读取真实 page', cdp.requestCount('/api/contract/business-title/page', 'POST', titleStart) >= 1)
      check('工商抬头有 Import/Export', await cdp.evaluate(`document.body.innerText.includes('导入') && document.body.innerText.includes('导出全部')`))

      const checkBefore = cdp.requestCount(`/api/contract/business-title/invoice/check/${titleId}`, 'GET')
      check('被发票引用的工商抬头执行删除保护', await clickRowAction(cdp, titleName, '删除'))
      await cdp.waitFor(textIncludes('该工商抬头已被发票引用，无法删除'), 5000, '工商抬头删除保护')
      check('删除前调用 invoice-check', cdp.requestCount(`/api/contract/business-title/invoice/check/${titleId}`, 'GET') > checkBefore)

      check('工商抬头详情可打开', await clickRowAction(cdp, titleName, '详情'))
      await cdp.waitFor(textIncludes('纳税人识别号'), 5000, '工商抬头详情 Drawer')
      await closeVisibleDrawer(cdp)
      check('新建工商抬头 Drawer 可打开', await clickExact(cdp, '新建工商抬头'))
      await cdp.waitFor(textIncludes('开户行'), 5000, '新建工商抬头 Drawer')
      check('工商抬头表单包含抬头类型', await cdp.evaluate(`document.body.innerText.includes('抬头类型')`))
      await closeVisibleDrawer(cdp)

      const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
      check('Browser Smoke API 5xx = 0', api5xx.length === 0, JSON.stringify(api5xx))
      check('Browser Smoke Runtime exception = 0', cdp.exceptions.length === 0, JSON.stringify(cdp.exceptions))
    } finally {
      cdp.close()
    }
  } finally {
    await cleanupFixture()
    await restoreInvoiceFlows()
  }

  console.log(`\nW3.6.4 Browser Smoke: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

main().catch(async (error) => {
  console.error(error)
  try { await cleanupFixture() } catch {
    // preserve the original smoke error
  }
  try { await restoreInvoiceFlows() } catch {
    // preserve the original smoke error
  }
  process.exit(1)
})
