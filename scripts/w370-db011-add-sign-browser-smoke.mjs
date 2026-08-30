const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let refreshToken = ''
let testFlowId = ''
let testFlowCreated = false
let customerId = ''
const orderIds = []
const instanceIds = []
const flowRestore = []

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

async function disableOrderFlows() {
  const page = (await apiRequest('GET', '/approvals/flows?formType=order&page=1&pageSize=100')).data
  for (const item of page.items ?? []) {
    const detail = (await apiRequest('GET', `/approvals/flows/${item.id}`)).data
    flowRestore.push({ id: item.id, body: flowWrite(detail) })
    await apiRequest('PUT', `/approvals/flows/${item.id}`, flowWrite(detail, false))
  }
}

async function cleanup() {
  for (const instanceId of instanceIds) {
    try { await apiRequest('POST', `/approvals/${instanceId}/cancel`, undefined, [400, 404]) } catch {
      // best effort
    }
  }
  if (testFlowId) {
    try {
      const detail = (await apiRequest('GET', `/approvals/flows/${testFlowId}`)).data
      await apiRequest('PUT', `/approvals/flows/${testFlowId}`, flowWrite(detail, false))
      if (testFlowCreated) await apiRequest('DELETE', `/approvals/flows/${testFlowId}`)
    } catch {
      // best effort
    }
  }
  for (const orderId of orderIds) {
    try { await apiRequest('GET', `/order/delete/${orderId}`, undefined, [400, 404]) } catch {
      // best effort
    }
  }
  if (customerId) {
    try { await apiRequest('GET', `/account/delete/${customerId}`, undefined, [400, 404]) } catch {
      // best effort
    }
  }
  for (const original of flowRestore) {
    try { await apiRequest('PUT', `/approvals/flows/${original.id}`, original.body) } catch {
      // best effort
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
    const marker = `w370-sign-${Date.now()}-${Math.random()}`
    await this.evaluate(`window.__w370SignNavigationMarker=${JSON.stringify(marker)};true`)
    await this.send('Page.navigate', { url: targetUrl })
    await this.waitFor(
      `location.href===${JSON.stringify(targetUrl)} && window.__w370SignNavigationMarker!==${JSON.stringify(marker)} && document.readyState!=='loading' && document.body!==null`,
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

async function clickRowAction(cdp, rowName, action) {
  return cdp.evaluate(`(() => {
    const row=[...document.querySelectorAll('.el-table__row')].find((item)=>item.textContent?.includes(${JSON.stringify(rowName)}) && item.getBoundingClientRect().width>0)
    const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()===${JSON.stringify(action)})
    button?.click(); return Boolean(button)
  })()`)
}

async function clickVisibleDialogButton(cdp, text) {
  return cdp.evaluate(`(() => {
    const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
    const dialog=dialogs.at(-1)
    const button=[...(dialog?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()===${JSON.stringify(text)})
    button?.click(); return Boolean(button)
  })()`)
}

async function closeVisibleDialog(cdp) {
  return cdp.evaluate(`(() => {
    const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
    const button=dialogs.at(-1)?.querySelector('.el-dialog__headerbtn')
    button?.click(); return Boolean(button)
  })()`)
}

async function main() {
  console.log('\nW3.7-9.3B 加签 Browser Smoke')
  const admin = await apiRequest('POST', '/auth/login', { email: 'admin@demo.com', password: 'admin123' })
  if (!admin.data?.accessToken) throw new Error('管理员登录失败')
  token = admin.data.accessToken
  refreshToken = admin.data.refreshToken
  const adminId = admin.data.user.id
  const manager = await apiRequest('POST', '/auth/login', { email: 'zhangwei@demo.com', password: 'admin123' })
  const managerId = manager.data.user.id
  const managerName = manager.data.user.name
  const suffix = Date.now().toString(36)

  await disableOrderFlows()
  try {
    const flowBody = {
      name: `W370 AddSign Browser ${suffix}`,
      description: 'W3.7-9.3B add-sign browser smoke',
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
      createNodes: [{
        name: '管理员审批',
        approverType: 'USER',
        approverIds: [adminId],
        ccUserIds: [],
        mode: 'ANY',
      }],
    }
    if (flowRestore.length) {
      testFlowId = flowRestore[0].id
      await apiRequest('PUT', `/approvals/flows/${testFlowId}`, flowBody)
    } else {
      const flow = (await apiRequest('POST', '/approvals/flows', { formType: 'order', ...flowBody })).data
      testFlowId = flow.id
      testFlowCreated = true
    }
    const customer = (await apiRequest('POST', '/account/add', { name: `W370 AddSign Customer ${suffix}` })).data
    customerId = customer.id

    const createOrder = async (name) => {
      const order = (await apiRequest('POST', '/order/add', {
        name,
        customerId,
        owner: adminId,
        amount: 12.34,
      })).data
      orderIds.push(order.id)
      const instance = (await apiRequest('GET', `/approvals/instance?module=order&targetId=${order.id}`)).data
      if (!instance?.id) throw new Error(`订单 ${name} 未生成审批实例`)
      instanceIds.push(instance.id)
      return { order, instance }
    }

    const gatedName = `W370 AddSign Gate ${suffix}`
    const gated = await createOrder(gatedName)
    check('gate 关闭时 API canAddSign=false', gated.instance.canAddSign === false)

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
      await cdp.evaluate(`localStorage.setItem('mmx_access_token',${JSON.stringify(token)});localStorage.setItem('mmx_refresh_token',${JSON.stringify(refreshToken)});true`)
      await cdp.navigate('/approvals')
      await cdp.waitFor(textIncludes(gatedName), 10000, 'gate 关闭待办')
      check('gate 关闭待办可打开', await clickRowAction(cdp, gatedName, '去审批'))
      await cdp.waitFor(textIncludes('驳回'), 5000, 'gate 关闭审批详情')
      check('gate 关闭时不展示加签按钮', await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        return ![...(dialogs.at(-1)?.querySelectorAll('button')??[])].some((item)=>item.textContent?.trim()==='加签')
      })()`))
      await closeVisibleDialog(cdp)

      await apiRequest('POST', `/approvals/${gated.instance.id}/cancel`)
      await apiRequest('PUT', `/approvals/flows/${testFlowId}`, { ...flowBody, allowAddSign: true })

      const enabledName = `W370 AddSign Enabled ${suffix}`
      const enabled = await createOrder(enabledName)
      check('gate 开启时 API canAddSign=true', enabled.instance.canAddSign === true)
      await cdp.navigate('/approvals')
      await cdp.waitFor(textIncludes(enabledName), 10000, 'gate 开启待办')
      check('gate 开启待办可打开', await clickRowAction(cdp, enabledName, '去审批'))
      await cdp.waitFor(textIncludes('加签'), 5000, '加签按钮')
      check('gate 开启时展示加签按钮', await clickVisibleDialogButton(cdp, '加签'))
      await cdp.waitFor(textIncludes('加签方式'), 5000, '加签弹窗')
      check('加签弹窗展示 BEFORE/AFTER', await cdp.evaluate(`document.body.innerText.includes('我之前') && document.body.innerText.includes('我之后')`))

      check('可选择 AFTER', await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        const radio=[...(dialogs.at(-1)?.querySelectorAll('.el-radio-button')??[])].find((item)=>item.textContent?.trim()==='我之后')
        radio?.click(); return Boolean(radio)
      })()`))
      const memberDropdownId = await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        const wrapper=dialogs.at(-1)?.querySelector('.el-select__wrapper')
        const input=dialogs.at(-1)?.querySelector('.el-select__input')
        wrapper?.click(); return input?.getAttribute('aria-controls') || ''
      })()`)
      check('可打开成员选择', Boolean(memberDropdownId))
      if (!memberDropdownId) throw new Error('无法定位加签成员下拉')
      await cdp.waitFor(
        `[...document.getElementById(${JSON.stringify(memberDropdownId)})?.querySelectorAll('.el-select-dropdown__item') ?? []].some((item)=>item.textContent?.trim()===${JSON.stringify(managerName)} && item.getBoundingClientRect().width>0)`,
        5000,
        '成员下拉',
      )
      check('可选择租户成员', await cdp.evaluate(`(() => {
        const root=document.getElementById(${JSON.stringify(memberDropdownId)})
        const option=[...(root?.querySelectorAll('.el-select-dropdown__item')??[])].find((item)=>item.textContent?.trim()===${JSON.stringify(managerName)} && item.getBoundingClientRect().width>0)
        option?.click(); return Boolean(option)
      })()`))
      check('可填写加签说明', await cdp.evaluate(`(() => {
        const dialogs=[...document.querySelectorAll('.el-dialog')].filter((item)=>item.getBoundingClientRect().width>0)
        const input=dialogs.at(-1)?.querySelector('textarea')
        if (!input) return false
        const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set
        setter?.call(input,'browser add sign')
        input.dispatchEvent(new Event('input',{bubbles:true}))
        return true
      })()`))

      const taskId = enabled.instance.myPendingTaskId
      const signPath = `/api/approvals/tasks/${taskId}/sign`
      const signBefore = cdp.requestCount(signPath, 'POST')
      check('确认加签可点击', await clickVisibleDialogButton(cdp, '确认加签'))
      const start = Date.now()
      while (Date.now() - start < 10000 && cdp.requestCount(signPath, 'POST') === signBefore) await sleep(100)
      check('UI 调用 sign API', cdp.requestCount(signPath, 'POST') > signBefore)
      const responseStart = Date.now()
      let signResponse
      while (Date.now() - responseStart < 10000 && !signResponse) {
        signResponse = cdp.lastResponse(signPath)
        if (!signResponse) await sleep(100)
      }
      check('sign API 响应成功', Boolean(signResponse && signResponse.status < 400), JSON.stringify(signResponse))

      const after = (await apiRequest('GET', `/approvals/instance?module=order&targetId=${enabled.order.id}`)).data
      check('Browser AFTER 写入 addSignTasks', after.addSignTasks?.length === 1 && after.addSignTasks[0].type === 'AFTER')
      const signTask = after.tasks?.find((task) => task.taskType === 'SIGN' && task.status === 'PENDING')
      check('Browser AFTER 生成 SIGN 待办', signTask?.approverId === managerId)
      check('Browser 无运行时异常', cdp.exceptions.length === 0, cdp.exceptions.join('; '))
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
  try { await cleanup() } catch {
    // best effort
  }
  process.exitCode = 1
})
