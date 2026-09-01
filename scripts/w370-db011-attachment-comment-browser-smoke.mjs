import { writeFileSync, unlinkSync } from 'node:fs'

const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'
const uploadPath = `/tmp/mmx-w370-attachment-${process.pid}.txt`

let passed = 0
let failed = 0
const restoreFlows = []
const orderIds = []
const customerIds = []
let adminToken = ''
let adminRefreshToken = ''
let flowId = ''
let flowCreated = false

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
      if (flowCreated) await api('DELETE', `/approvals/flows/${flowId}`, undefined, adminToken, [400, 404])
    } catch { /* best effort */ }
  }
  for (const id of orderIds) {
    try { await api('GET', `/order/delete/${id}`, undefined, adminToken, [400, 404]) } catch { /* best effort */ }
  }
  for (const id of customerIds) {
    try { await api('GET', `/account/delete/${id}`, undefined, adminToken, [400, 404]) } catch { /* best effort */ }
  }
  for (const flow of restoreFlows) {
    try { await api('PUT', `/approvals/flows/${flow.id}`, flow.body) } catch { /* best effort */ }
  }
  try { unlinkSync(uploadPath) } catch { /* best effort */ }
}

async function createOrder(userId, name) {
  const customerId = (await api('POST', '/account/add', { name: `${name} Customer` })).data.id
  customerIds.push(customerId)
  const orderId = (await api('POST', '/order/add', {
    name,
    customerId,
    owner: userId,
    amount: 88.66,
  })).data.id
  orderIds.push(orderId)
  return orderId
}

async function loadPageTarget() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((response) => response.json())
      const page = targets.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* starting */ }
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
    await Promise.all([
      this.send('Page.enable'),
      this.send('Runtime.enable'),
      this.send('Network.enable'),
      this.send('DOM.enable'),
    ])
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
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
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
  async setFile(selector, filePath) {
    const { root } = await this.send('DOM.getDocument', { depth: -1, pierce: true })
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) return false
    await this.send('DOM.setFileInputFiles', { nodeId, files: [filePath] })
    return true
  }
  close() { this.socket.close() }
}

const textIncludes = (text) => `document.body?.innerText.includes(${JSON.stringify(text)})===true`

async function waitForRequest(cdp, pathname, before, timeout = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeout && cdp.requestCount(pathname, 'POST') === before) await sleep(100)
  return cdp.requestCount(pathname, 'POST') > before
}

async function waitForFreshResponse(cdp, pathname, beforeCount, timeout = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const count = cdp.responses.filter((item) => {
      try { return new URL(item.url).pathname === pathname } catch { return false }
    }).length
    if (count > beforeCount) return cdp.lastResponse(pathname)
    await sleep(100)
  }
  return undefined
}

async function setTextarea(cdp, value) {
  return cdp.evaluate(`(() => {
    const input=[...document.querySelectorAll('.el-dialog textarea,.van-popup textarea')]
      .find((item)=>item.getBoundingClientRect().height>0 && item.getBoundingClientRect().width>0)
    if (!input) return false
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set?.call(input,${JSON.stringify(value)})
    input.dispatchEvent(new Event('input',{bubbles:true}))
    return true
  })()`)
}

async function main() {
  console.log('\nW3.7-9.3E requireComment / ApprovalInstanceAttachment Browser Smoke')
  writeFileSync(uploadPath, 'MicroMatrix W3.7-9.3E browser attachment\n', 'utf8')
  const admin = (await api('POST', '/auth/login', { email: 'admin@demo.com', password: 'admin123' }, '')).data
  const manager = (await api('POST', '/auth/login', { email: 'zhangwei@demo.com', password: 'admin123' }, '')).data
  adminToken = admin.accessToken
  adminRefreshToken = admin.refreshToken
  const suffix = Date.now().toString(36)

  await disableOrderFlows()
  try {
    const flowBody = {
      name: `W370 Attach Browser ${suffix}`,
      description: 'W3.7-9.3E browser smoke',
      enabled: true,
      createExecute: true,
      updateExecute: false,
      deleteExecute: false,
      submitterCanRevoke: true,
      allowBatchProcess: false,
      allowWithdraw: true,
      allowAddSign: true,
      duplicateApproverRule: 'FIRST_ONLY',
      requireComment: true,
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
      const created = (await api('POST', '/approvals/flows', { formType: 'order', ...flowBody })).data
      flowId = created.id
      flowCreated = true
    }
    const flow = (await api('GET', `/approvals/flows/${flowId}`)).data
    check('requireComment 配置真实开启', flow.requireComment === true)

    const pcOrderName = `W370 Attach PC ${suffix}`
    const pcOrderId = await createOrder(admin.user.id, pcOrderName)
    const pcDetail = (await api('GET', `/approvals/instance?module=order&targetId=${pcOrderId}`)).data
    const pcTaskId = pcDetail.myPendingTaskId
    check('PC 前置 VO requireComment=true', pcDetail.requireComment === true && Boolean(pcTaskId))

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
      await cdp.setViewport(1440, 1000, false)
      await cdp.navigate('/approvals')
      await cdp.waitFor(textIncludes(pcOrderName), 10000, 'PC 待办列表')
      check('PC 可打开待办详情', await cdp.evaluate(`(() => {
        const row=[...document.querySelectorAll('.el-table__row')].find((item)=>item.textContent?.includes(${JSON.stringify(pcOrderName)}))
        const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='去审批')
        button?.click(); return Boolean(button)
      })()`))
      const requiredPlaceholder = '审批意见（必填）'
      await cdp.waitFor(
        `document.querySelector('.el-dialog textarea')?.getAttribute('placeholder')===${JSON.stringify(requiredPlaceholder)}`,
        5000,
        'PC 必填意见',
      )
      check(
        'PC 展示审批意见必填',
        await cdp.evaluate(
          `document.querySelector('.el-dialog textarea')?.getAttribute('placeholder')===${JSON.stringify(requiredPlaceholder)}`,
        ),
      )
      check('PC 展示上传附件入口', await cdp.evaluate(textIncludes('上传附件')))

      const pcApprovePath = `/api/approvals/tasks/${pcTaskId}/approve`
      const pcApproveBefore = cdp.requestCount(pcApprovePath, 'POST')
      await cdp.evaluate(`(() => {
        const dialog=[...document.querySelectorAll('.el-dialog')].find((item)=>item.getBoundingClientRect().height>0)
        const button=[...(dialog?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='同意')
        button?.click(); return Boolean(button)
      })()`)
      await sleep(300)
      check('PC 空意见不会调用 approve API', cdp.requestCount(pcApprovePath, 'POST') === pcApproveBefore)

      const uploadApiPath = '/api/attachments/upload'
      const uploadBefore = cdp.requestCount(uploadApiPath, 'POST')
      check('PC 可向 file input 注入真实文件', await cdp.setFile('.el-dialog input[type="file"]', uploadPath))
      check('PC UI 调用附件上传 API', await waitForRequest(cdp, uploadApiPath, uploadBefore))
      await cdp.waitFor(textIncludes(`mmx-w370-attachment-${process.pid}.txt`), 10000, 'PC 上传文件名')
      check('PC 上传后显示文件名', await cdp.evaluate(textIncludes(`mmx-w370-attachment-${process.pid}.txt`)))
      check('PC 可填写审批意见', await setTextarea(cdp, 'PC 浏览器附件审批通过'))
      const pcResponseCount = cdp.responses.filter((item) => {
        try { return new URL(item.url).pathname === pcApprovePath } catch { return false }
      }).length
      await cdp.evaluate(`(() => {
        const dialog=[...document.querySelectorAll('.el-dialog')].find((item)=>item.getBoundingClientRect().height>0)
        const button=[...(dialog?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='同意')
        button?.click(); return Boolean(button)
      })()`)
      check('PC UI 调用 approve API', await waitForRequest(cdp, pcApprovePath, pcApproveBefore))
      const pcApproveResponse = await waitForFreshResponse(cdp, pcApprovePath, pcResponseCount)
      check('PC approve API 成功', Boolean(pcApproveResponse && pcApproveResponse.status < 400), JSON.stringify(pcApproveResponse))
      const pcAfter = (await api('GET', `/approvals/instance?module=order&targetId=${pcOrderId}`)).data
      check('PC 后端详情返回动作附件', pcAfter.approvalAttachments?.some((item) => item.attachment.name.includes('mmx-w370-attachment-')))

      await cdp.navigate('/approvals?tab=handled')
      await cdp.waitFor(textIncludes(pcOrderName), 10000, 'PC 已处理列表')
      await cdp.evaluate(`(() => {
        const row=[...document.querySelectorAll('.el-table__row')].find((item)=>item.textContent?.includes(${JSON.stringify(pcOrderName)}))
        const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='查看')
        button?.click(); return Boolean(button)
      })()`)
      await cdp.waitFor(textIncludes(`mmx-w370-attachment-${process.pid}.txt`), 5000, 'PC 历史附件')
      check('PC 时间线展示历史审批附件', await cdp.evaluate(textIncludes(`mmx-w370-attachment-${process.pid}.txt`)))

      const mobileOrderName = `W370 Attach Mobile ${suffix}`
      const mobileOrderId = await createOrder(admin.user.id, mobileOrderName)
      const mobileDetail = (await api('GET', `/approvals/instance?module=order&targetId=${mobileOrderId}`)).data
      const mobileTaskId = mobileDetail.myPendingTaskId
      check('Mobile 前置 VO requireComment=true', mobileDetail.requireComment === true && Boolean(mobileTaskId))

      await cdp.setViewport(390, 844, true)
      await cdp.navigate('/login')
      await cdp.navigate('/approvals')
      await cdp.waitFor(textIncludes(mobileOrderName), 10000, 'Mobile 待办列表')
      check('Mobile 可打开待办详情', await cdp.evaluate(`(() => {
        const cell=[...document.querySelectorAll('.van-cell')].find((item)=>item.textContent?.includes(${JSON.stringify(mobileOrderName)}))
        cell?.click(); return Boolean(cell)
      })()`))
      await cdp.waitFor(
        `document.querySelector('.van-popup textarea')?.getAttribute('placeholder')===${JSON.stringify(requiredPlaceholder)}`,
        5000,
        'Mobile 必填意见',
      )
      check(
        'Mobile 展示审批意见必填',
        await cdp.evaluate(
          `document.querySelector('.van-popup textarea')?.getAttribute('placeholder')===${JSON.stringify(requiredPlaceholder)}`,
        ),
      )
      check('Mobile 展示上传附件入口', await cdp.evaluate(textIncludes('上传附件')))

      const mobileApprovePath = `/api/approvals/tasks/${mobileTaskId}/approve`
      const mobileApproveBefore = cdp.requestCount(mobileApprovePath, 'POST')
      await cdp.evaluate(`(() => {
        const popup=[...document.querySelectorAll('.van-popup')].find((item)=>item.getBoundingClientRect().height>0)
        const button=[...(popup?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='同意')
        button?.click(); return Boolean(button)
      })()`)
      await sleep(300)
      check('Mobile 空意见不会调用 approve API', cdp.requestCount(mobileApprovePath, 'POST') === mobileApproveBefore)

      const mobileUploadBefore = cdp.requestCount(uploadApiPath, 'POST')
      check('Mobile 可向 file input 注入真实文件', await cdp.setFile('.van-popup input[type="file"]', uploadPath))
      check('Mobile UI 调用附件上传 API', await waitForRequest(cdp, uploadApiPath, mobileUploadBefore))
      await cdp.waitFor(textIncludes(`mmx-w370-attachment-${process.pid}.txt`), 10000, 'Mobile 上传文件名')
      check('Mobile 上传后显示文件名', await cdp.evaluate(textIncludes(`mmx-w370-attachment-${process.pid}.txt`)))
      check('Mobile 可填写审批意见', await setTextarea(cdp, 'Mobile 浏览器附件审批通过'))
      const mobileResponseCount = cdp.responses.filter((item) => {
        try { return new URL(item.url).pathname === mobileApprovePath } catch { return false }
      }).length
      await cdp.evaluate(`(() => {
        const popup=[...document.querySelectorAll('.van-popup')].find((item)=>item.getBoundingClientRect().height>0)
        const button=[...(popup?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='同意')
        button?.click(); return Boolean(button)
      })()`)
      check('Mobile UI 调用 approve API', await waitForRequest(cdp, mobileApprovePath, mobileApproveBefore))
      const mobileResponse = await waitForFreshResponse(cdp, mobileApprovePath, mobileResponseCount)
      check('Mobile approve API 成功', Boolean(mobileResponse && mobileResponse.status < 400), JSON.stringify(mobileResponse))
      const mobileAfter = (await api('GET', `/approvals/instance?module=order&targetId=${mobileOrderId}`)).data
      check('Mobile 后端详情返回动作附件', mobileAfter.approvalAttachments?.some((item) => item.attachment.name.includes('mmx-w370-attachment-')))

      check('Browser Runtime exception=0', cdp.exceptions.length === 0, cdp.exceptions.join('; '))
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
