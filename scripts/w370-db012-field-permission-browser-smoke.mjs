import { explicitApprovalFlowRequest } from './helpers/approval-flow-graph.mjs'

const webBase = process.env.WEB_BASE ?? 'http://localhost:5173'
const apiBase = process.env.API_BASE ?? 'http://localhost:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let adminToken = ''
let flowId = ''
let invoiceId = ''
let instanceId = ''
const fieldIds = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function api(method, path, body, token = adminToken, allowed = []) {
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
  return { response, data }
}

async function loadPageTarget() {
  for (let i = 0; i < 120; i += 1) {
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
    this.responses = []
    this.exceptions = []
    this.consoleErrors = []
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
        this.exceptions.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? 'Runtime exception')
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '))
      }
      if (message.method === 'Network.responseReceived') {
        this.responses.push({ status: message.params.response.status, url: message.params.response.url })
      }
    })
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable')])
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '浏览器表达式执行失败')
    return result.result?.value
  }
  async waitFor(expression, timeoutMs, label) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }
  async desktop() {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    })
  }
  async mobile() {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
      screenWidth: 390, screenHeight: 844,
    })
  }
  async navigate(path) {
    const url = `${webBase}${path}`
    await this.send('Page.navigate', { url })
    await this.waitFor(`location.href.startsWith(${JSON.stringify(url)}) && document.readyState!=='loading'`, 15000, path)
  }
  close() { this.socket.close() }
}

function formItemState(label) {
  return `(() => {
    const item=[...document.querySelectorAll('.el-form-item')].find((node)=>node.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)})
    return item ? { exists:true, input:Boolean(item.querySelector('input,textarea')), text:item.textContent ?? '' } : { exists:false,input:false,text:'' }
  })()`
}

function vantFieldState(label) {
  return `(() => {
    const item=[...document.querySelectorAll('.van-field')].find((node)=>node.querySelector('.van-field__label')?.textContent?.trim()===${JSON.stringify(label)})
    return item ? { exists:true, input:Boolean(item.querySelector('input,textarea')), text:item.textContent ?? '' } : { exists:false,input:false,text:'' }
  })()`
}

function vantReadonlyCellState(label) {
  return `(() => {
    const item=[...document.querySelectorAll('.van-cell')].find((node)=>node.querySelector('.van-cell__title')?.textContent?.trim()===${JSON.stringify(label)})
    return item ? { exists:true, input:Boolean(item.querySelector('input,textarea')), text:item.textContent ?? '' } : { exists:false,input:false,text:'' }
  })()`
}

async function setDesktopField(cdp, label, value) {
  return cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.el-form-item')].find((node)=>node.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)})
    const input=item?.querySelector('input,textarea')
    if (!input) return false
    const setter=Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value')?.set
    setter?.call(input,${JSON.stringify(value)})
    input.dispatchEvent(new Event('input',{bubbles:true}))
    input.dispatchEvent(new Event('change',{bubbles:true}))
    return true
  })()`)
}

async function setMobileField(cdp, label, value) {
  return cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.van-field')].find((node)=>node.querySelector('.van-field__label')?.textContent?.trim()===${JSON.stringify(label)})
    const input=item?.querySelector('input,textarea')
    if (!input) return false
    const setter=Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value')?.set
    setter?.call(input,${JSON.stringify(value)})
    input.dispatchEvent(new Event('input',{bubbles:true}))
    input.dispatchEvent(new Event('change',{bubbles:true}))
    return true
  })()`)
}

async function clickText(cdp, text, selector = 'button') {
  return cdp.evaluate(`(() => {
    const target=[...document.querySelectorAll(${JSON.stringify(selector)})].find((node)=>node.textContent?.replace(/\\s/g,'').includes(${JSON.stringify(text.replace(/\s/g, ''))}))
    target?.click(); return Boolean(target)
  })()`)
}

async function cleanup() {
  if (instanceId) {
    try { await api('POST', `/approvals/${instanceId}/cancel`, undefined, adminToken, [400, 404]) } catch { /* best effort */ }
  }
  if (invoiceId) {
    try { await api('GET', `/invoice/delete/${invoiceId}`, undefined, adminToken, [400, 404]) } catch { /* best effort */ }
  }
  if (flowId) {
    try { await api('PATCH', `/approvals/flows/${flowId}/enabled`, { enabled: false }, adminToken, [400, 404]) } catch { /* best effort */ }
    try { await api('DELETE', `/approvals/flows/${flowId}`, undefined, adminToken, [400, 404]) } catch { /* best effort */ }
  }
  for (const fieldId of fieldIds.reverse()) {
    try { await api('DELETE', `/metadata/fields/${fieldId}`, undefined, adminToken, [400, 404]) } catch { /* best effort */ }
  }
}

let cdp
try {
  console.log('\nW3.7-9.4C DB-012 Field Permission Browser Smoke')
  const login = (await api('POST', '/auth/login', { email: 'admin@demo.com', password: 'admin123' }, '')).data
  adminToken = login.accessToken
  const adminId = login.user.id
  const suffix = Date.now().toString(36)
  const invoiceName = `W370 Field Browser ${suffix}`

  const existingFlows = (await api('GET', '/approvals/flows?page=1&pageSize=10&formType=invoice')).data
  if (existingFlows.total !== 0) throw new Error('Browser Smoke 要求 invoice 当前无流程，避免覆盖用户配置')

  const editField = (await api('POST', '/metadata/invoice/fields', {
    label: `审批可编辑_${suffix}`, type: 'text', required: false, span: 12, showInList: false,
  })).data
  const viewField = (await api('POST', '/metadata/invoice/fields', {
    label: `审批只读_${suffix}`, type: 'text', required: false, span: 12, showInList: false,
  })).data
  const hiddenField = (await api('POST', '/metadata/invoice/fields', {
    label: `审批隐藏_${suffix}`, type: 'text', required: false, span: 12, showInList: false,
  })).data
  fieldIds.push(editField.id, viewField.id, hiddenField.id)
  const metadata = (await api('GET', '/metadata/invoice/fields')).data
  const nameField = metadata.find((field) => field.key === 'name')
  if (!nameField?.id) throw new Error('invoice name metadata field missing')

  const contracts = (await api('POST', '/contract/page', { current: 1, pageSize: 100 })).data
  const contract = contracts.list?.find((item) => item.id)
  if (!contract?.id) throw new Error('缺少 Browser Smoke 合同夹具')

  const flow = (await api('POST', '/approvals/flows', {
    formType: 'invoice',
    name: `W370 Field Browser Flow ${suffix}`,
    description: 'W3.7-9.4C field permission browser smoke',
    enabled: true,
    createExecute: true,
    updateExecute: false,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: false,
    allowAddSign: false,
    duplicateApproverRule: 'EACH',
    requireComment: false,
    condition: null,
    createNodes: [{
      name: '管理员字段审批',
      approverType: 'USER', approverIds: [adminId], ccUserIds: [], mode: 'ANY',
      sameSubmitterAction: 'ALLOW', emptyApproverAction: 'AUTO_PASS', approverDirection: 'BOTTOM_UP',
      fieldPermissions: [
        { fieldId: nameField.id, permissionType: 'EDIT' },
        { fieldId: editField.id, permissionType: 'EDIT' },
        { fieldId: viewField.id, permissionType: 'VIEW' },
        { fieldId: hiddenField.id, permissionType: 'HIDDEN' },
      ],
    }],
  })).data
  flowId = flow.id

  const invoice = (await api('POST', '/invoice/add', {
    name: invoiceName,
    contractId: contract.id,
    owner: adminId,
    amount: 12.34,
    invoiceType: '增值税普通发票',
    taxRate: 6,
    moduleFields: [
      { fieldId: editField.id, fieldValue: 'pc-before' },
      { fieldId: viewField.id, fieldValue: 'readonly-value' },
      { fieldId: hiddenField.id, fieldValue: 'hidden-value' },
    ],
  })).data
  invoiceId = invoice.id
  const pendingPage = (await api('GET', '/approvals/my-pending?page=1&pageSize=100')).data
  const pending = pendingPage.items.find((item) => item.targetId === invoiceId)
  if (!pending?.id || !pending.myPendingTaskId) throw new Error('未生成管理员字段审批待办')
  instanceId = pending.id

  const target = await loadPageTarget()
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.desktop()
  await cdp.navigate('/login')
  await cdp.evaluate(`localStorage.setItem('mmx_access_token',${JSON.stringify(adminToken)});localStorage.setItem('mmx_refresh_token',${JSON.stringify(login.refreshToken)});true`)
  await cdp.navigate('/approvals?tab=pending')
  await cdp.waitFor(`document.body?.innerText.includes(${JSON.stringify(invoiceName)})`, 12000, 'PC 审批列表')
  check('PC 待我审批读取字段权限实例', true)
  check('PC 可打开字段审批详情', await clickText(cdp, '去审批'))
  await cdp.waitFor(`document.body?.innerText.includes('业务字段') && document.body?.innerText.includes(${JSON.stringify(editField.label)})`, 12000, 'PC 业务字段')

  const pcEdit = await cdp.evaluate(formItemState(editField.label))
  const pcView = await cdp.evaluate(formItemState(viewField.label))
  const pcHidden = await cdp.evaluate(formItemState(hiddenField.label))
  check('PC EDIT 字段渲染输入控件', pcEdit.exists && pcEdit.input, JSON.stringify(pcEdit))
  check('PC VIEW 字段只读展示', pcView.exists && !pcView.input, JSON.stringify(pcView))
  check('PC HIDDEN 字段不进入详情 DOM', !pcHidden.exists, JSON.stringify(pcHidden))
  check('PC 系统 name 字段可编辑', (await cdp.evaluate(formItemState('发票名称'))).input)

  const pcRenamed = `W370 PC Renamed ${suffix}`
  check('PC 可输入 EDIT 自定义字段', await setDesktopField(cdp, editField.label, 'pc-after'))
  check('PC 可输入 EDIT 系统字段', await setDesktopField(cdp, '发票名称', pcRenamed))
  check('PC 保存字段按钮可点击', await clickText(cdp, '保存字段'))
  await cdp.waitFor(`document.body?.innerText.includes('审批字段已保存')`, 8000, 'PC 字段保存成功')
  const pcDetail = (await api('GET', `/approvals/instances/${instanceId}`)).data
  check('PC 保存真实写入服务端', pcDetail.targetName === `发票 ${pcRenamed}` && pcDetail.resourceFields.find((field) => field.fieldId === editField.id)?.value === 'pc-after')

  await cdp.mobile()
  await cdp.navigate('/approvals')
  await cdp.waitFor(`document.body?.innerText.includes('待我审批') && document.body?.innerText.includes(${JSON.stringify(pcRenamed)})`, 12000, 'Mobile 审批列表')
  check('Mobile 路由加载移动审批中心', Boolean(await cdp.evaluate(`document.querySelector('.van-nav-bar')`)))
  check('Mobile 可打开字段审批详情', await cdp.evaluate(`(() => {
    const cell=[...document.querySelectorAll('.van-cell')].find((node)=>node.textContent?.includes(${JSON.stringify(pcRenamed)}))
    cell?.click(); return Boolean(cell)
  })()`))
  await cdp.waitFor(`document.body?.innerText.includes('业务字段') && document.body?.innerText.includes(${JSON.stringify(editField.label)})`, 12000, 'Mobile 业务字段')

  const mobileEdit = await cdp.evaluate(vantFieldState(editField.label))
  const mobileView = await cdp.evaluate(vantReadonlyCellState(viewField.label))
  const mobileHidden = await cdp.evaluate(vantFieldState(hiddenField.label))
  check('Mobile EDIT 字段渲染输入控件', mobileEdit.exists && mobileEdit.input, JSON.stringify(mobileEdit))
  check('Mobile VIEW 字段只读展示', mobileView.exists && !mobileView.input, JSON.stringify(mobileView))
  check('Mobile HIDDEN 字段不进入详情 DOM', !mobileHidden.exists, JSON.stringify(mobileHidden))

  check('Mobile 可输入 EDIT 自定义字段', await setMobileField(cdp, editField.label, 'mobile-after'))
  check('Mobile 保存字段按钮可点击', await clickText(cdp, '保存字段', '.van-button,button'))
  await cdp.waitFor(`document.body?.innerText.includes('审批字段已保存')`, 8000, 'Mobile 字段保存成功')
  const mobileDetail = (await api('GET', `/approvals/instances/${instanceId}`)).data
  check('Mobile 保存真实写入服务端', mobileDetail.resourceFields.find((field) => field.fieldId === editField.id)?.value === 'mobile-after')

  check('Browser API 5xx = 0', !cdp.responses.some((item) => item.status >= 500 && item.url.includes('/api/')))
  check('Browser Runtime exception = 0', cdp.exceptions.length === 0, cdp.exceptions.join('; '))
  check('Browser console error = 0', cdp.consoleErrors.length === 0, cdp.consoleErrors.join('; '))

  console.log(`\nW3.7-9.4C Field Permission Browser Smoke: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
} finally {
  cdp?.close()
  await cleanup()
}
