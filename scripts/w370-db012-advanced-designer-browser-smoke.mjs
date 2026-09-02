import {
  approvalFlowWriteFromDetail,
  explicitApprovalFlowRequest,
} from './helpers/approval-flow-graph.mjs'

const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let adminToken = ''
let flowId = ''
let flowCreated = false
let restoreFlow = null

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

async function login(email, password) {
  return (await api('POST', '/auth/login', { email, password }, '')).data
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
  async waitFor(expression, timeoutMs, label) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }
  async navigate(path) {
    const url = `${webBase}${path}`
    await this.send('Page.navigate', { url })
    await this.waitFor(
      `location.href===${JSON.stringify(url)} && document.readyState!=='loading'`,
      12000,
      path,
    )
  }
  close() { this.socket.close() }
}

async function cleanup() {
  if (!flowId) return
  try {
    if (flowCreated) {
      await api('DELETE', `/approvals/flows/${flowId}`, undefined, adminToken, [400, 404])
      return
    }
    if (restoreFlow) {
      await api('PUT', `/approvals/flows/${flowId}`, restoreFlow, adminToken)
    }
  } catch (error) {
    console.error(`9.4F Browser fixture 恢复失败: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

let cdp
try {
  console.log('\nW3.7-9.4F DB-012 Advanced Designer Browser Smoke')
  const admin = await login('admin@demo.com', 'admin123')
  adminToken = admin.accessToken
  const fields = (await api('GET', '/metadata/order/fields')).data
  const nameField = fields.find((field) => field.key === 'name')
  check('订单审批表单可读取 name 元数据', Boolean(nameField?.id))
  if (!nameField?.id) throw new Error('order name field missing')

  const suffix = Date.now().toString(36)
  const flowName = `W370_ADVANCED_UI_${suffix}`
  const testFlow = {
    name: flowName,
    description: '9.4F advanced designer browser',
    enabled: false,
    createExecute: true,
    updateExecute: false,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: true,
    allowAddSign: true,
    duplicateApproverRule: 'EACH',
    requireComment: true,
    condition: null,
    createNodes: [{
      name: '高级审批节点',
      approverType: 'USER',
      approverIds: [admin.user.id],
      ccUserIds: [],
      mode: 'ANY',
      emptyApproverAction: 'AUTO_PASS',
      sameSubmitterAction: 'ALLOW',
      approverDirection: 'BOTTOM_UP',
      fieldPermissions: [{ fieldId: nameField.id, permissionType: 'EDIT' }],
      passPostConfig: {
        fieldUpdateConfigs: [{ fieldId: nameField.id, fieldValue: 'PASS_V1', enable: true }],
        webHookConfig: {
          webHookEnable: false,
          webHookUrl: '',
          webHookMethod: 'POST',
          webHookHeader: '{"Content-Type":"application/json"}',
          webHookBody: '{}',
          webHookDescribe: '9.4F browser webhook',
        },
      },
      rejectPostConfig: { fieldUpdateConfigs: [] },
    }],
  }
  const existingPage = (await api('GET', '/approvals/flows?formType=order&page=1&pageSize=100')).data
  let created
  if ((existingPage.items ?? []).length) {
    flowId = existingPage.items[0].id
    const original = (await api('GET', `/approvals/flows/${flowId}`)).data
    restoreFlow = approvalFlowWriteFromDetail(original)
    created = (await api('PUT', `/approvals/flows/${flowId}`, testFlow)).data
    check('Browser fixture 复用并冻结现有订单流程配置', Boolean(restoreFlow?.createLinks?.length))
  } else {
    created = (await api('POST', '/approvals/flows', { formType: 'order', ...testFlow })).data
    flowId = created.id
    flowCreated = true
    check('Browser fixture 创建独立订单流程', true)
  }
  check('API 已创建带字段权限和后置动作的显式图', created.createLinks.length === 2 && created.createNodes.length === 3)

  const target = await loadPageTarget()
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.navigate('/login')
  await cdp.evaluate(`localStorage.setItem('mmx_access_token',${JSON.stringify(adminToken)});localStorage.setItem('mmx_refresh_token',${JSON.stringify(admin.refreshToken)});true`)
  await cdp.navigate('/system/approval-flows')
  await cdp.waitFor(`document.body?.innerText.includes(${JSON.stringify(flowName)})===true`, 12000, '高级流程列表')
  check('流程设置列表可读取 9.4F 流程', true)

  const opened = await cdp.evaluate(`(() => {
    const button=document.querySelector('button[data-flow-edit=${JSON.stringify(flowId)}]')
    button?.click()
    return Boolean(button)
  })()`)
  check('高级流程可进入编辑抽屉', opened)
  await cdp.waitFor(`document.body?.innerText.includes('编辑流程')===true`, 12000, '高级流程编辑抽屉')
  await sleep(800)

  await cdp.waitFor(`(() => {
    const drawer=[...document.querySelectorAll('.approval-flow-drawer')].find((item)=>item.getBoundingClientRect().width>0)
    return Boolean(drawer?.querySelector('.step-nav button'))
  })()`, 8000, '高级流程抽屉初始化')
  const flowStep = await cdp.evaluate(`(() => {
    const drawer=[...document.querySelectorAll('.approval-flow-drawer')].find((item)=>item.getBoundingClientRect().width>0)
    const button=[...(drawer?.querySelectorAll('.step-nav button')??[])].find((item)=>item.querySelector('strong')?.textContent?.trim()==='流程设计')
    button?.click()
    return Boolean(button)
  })()`)
  check('可进入高级流程设计步骤', flowStep)
  await cdp.waitFor(`Boolean(document.querySelector('[data-testid="approval-flow-canvas"]'))`, 8000, '高级流程画布')

  const approverOpened = await cdp.evaluate(`(() => {
    const node=[...document.querySelectorAll('.process-node--approver')].find((item)=>item.innerText.includes('高级审批节点'))
    node?.click()
    return Boolean(node)
  })()`)
  check('审批节点可打开高级配置面板', approverOpened)
  await sleep(300)

  const inspectorState = await cdp.evaluate(`(() => {
    const inspector=document.querySelector('.node-inspector')
    const permission=[...(inspector?.querySelectorAll('.field-permission-row')??[])].find((row)=>row.innerText.includes('名称'))
    const editActive=[...(permission?.querySelectorAll('.el-radio-button')??[])].some((item)=>item.innerText.includes('编辑')&&item.classList.contains('is-active'))
    const postValue=inspector?.querySelector('.post-field-row .el-input__inner')?.value ?? ''
    return {
      editActive,
      postValue,
      hasWebhook:inspector?.innerText.includes('Webhook')===true,
      hasFallback:inspector?.innerText.includes('审批人为空时')===true,
      hasSameSubmitter:inspector?.innerText.includes('审批人与提交人相同时')===true,
      text:inspector?.innerText?.slice(0,1800) ?? '',
      selected:[...document.querySelectorAll('.process-node.is-selected')].map((item)=>item.innerText),
    }
  })()`)
  check('节点字段 EDIT 权限真实回显', inspectorState.editActive, JSON.stringify(inspectorState))
  check('pass 后置字段配置真实回显', inspectorState.postValue === 'PASS_V1', JSON.stringify(inspectorState))
  check('异常策略和 Webhook 配置入口已开放', inspectorState.hasWebhook && inspectorState.hasFallback && inspectorState.hasSameSubmitter, JSON.stringify(inspectorState))

  const newNodeName = `高级审批节点_${suffix}`
  const nameEdited = await cdp.evaluate(`(() => {
    const inspector=document.querySelector('.node-inspector')
    const nameInput=inspector?.querySelector('.el-form-item .el-input__inner')
    const set=(input,value)=>{
      if (!input) return false
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set?.call(input,value)
      input.dispatchEvent(new Event('input',{bubbles:true}))
      input.dispatchEvent(new Event('change',{bubbles:true}))
      return true
    }
    return set(nameInput,${JSON.stringify(newNodeName)})
  })()`)
  await sleep(150)
  const postEdited = await cdp.evaluate(`(() => {
    const postInput=document.querySelector('.node-inspector .post-field-row .el-input__inner')
    if (!postInput) return false
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set?.call(postInput,'PASS_V2')
    postInput.dispatchEvent(new Event('input',{bubbles:true}))
    postInput.dispatchEvent(new Event('change',{bubbles:true}))
    return true
  })()`)
  check('审批节点名称与后置字段值可真实编辑', nameEdited && postEdited, JSON.stringify({ nameEdited, postEdited }))

  const webhookTestStart = cdp.requests.length
  const webhookEnabled = await cdp.evaluate(`(() => {
    const inspector=document.querySelector('.node-inspector')
    const header=[...(inspector?.querySelectorAll('span')??[])].find((item)=>item.textContent?.trim()==='Webhook')?.parentElement
    const toggle=header?.querySelector('.el-switch__input')
    toggle?.click()
    return Boolean(toggle)
  })()`)
  await sleep(150)
  const webhookPrepared = await cdp.evaluate(`(() => {
    const inspector=document.querySelector('.node-inspector')
    const urlItem=[...(inspector?.querySelectorAll('.el-form-item')??[])].find((item)=>item.querySelector('.el-form-item__label')?.textContent?.trim()==='URL')
    const input=urlItem?.querySelector('.el-input__inner')
    if (!input) return false
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set?.call(input,'http://127.0.0.1:9/hook?secret=browser')
    input.dispatchEvent(new Event('input',{bubbles:true}))
    input.dispatchEvent(new Event('change',{bubbles:true}))
    return true
  })()`)
  check('Webhook 可在流程设计器中启用并编辑 URL', webhookEnabled && webhookPrepared)
  await sleep(200)
  const testClicked = await cdp.evaluate(`(() => {
    const inspector=document.querySelector('.node-inspector')
    const button=[...(inspector?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='测试连接')
    button?.click()
    return Boolean(button)
  })()`)
  check('Webhook 测试连接入口可触发', testClicked)
  let webhookRequested = false
  for (let i = 0; i < 80; i += 1) {
    webhookRequested = cdp.requests
      .slice(webhookTestStart)
      .some((item) => item.url.includes('/api/approvals/flows/webhook/test'))
    if (webhookRequested) break
    await sleep(100)
  }
  if (!webhookRequested) throw new Error('Webhook 测试请求超时')
  await sleep(300)
  const webhookResponses = cdp.responses.filter((item) => item.url.includes('/api/approvals/flows/webhook/test'))
  check('Webhook 测试真实调用安全 API 并拒绝 loopback', webhookResponses.some((item) => item.status === 400), JSON.stringify(webhookResponses))

  const disabledAgain = await cdp.evaluate(`(() => {
    const inspector=document.querySelector('.node-inspector')
    const header=[...(inspector?.querySelectorAll('span')??[])].find((item)=>item.textContent?.trim()==='Webhook')?.parentElement
    const toggle=header?.querySelector('.el-switch__input')
    toggle?.click()
    return Boolean(toggle)
  })()`)
  check('Webhook 测试后可重新关闭再保存配置', disabledAgain)
  await sleep(150)

  const settingsStep = await cdp.evaluate(`(() => {
    const drawer=[...document.querySelectorAll('.el-drawer')].find((item)=>item.getBoundingClientRect().width>0)
    const button=[...(drawer?.querySelectorAll('.step-nav button')??[])].find((item)=>item.querySelector('strong')?.textContent?.trim()==='审批设置')
    button?.click()
    return Boolean(button)
  })()`)
  check('可进入审批设置步骤', settingsStep)
  await sleep(200)
  const duplicateEnabled = await cdp.evaluate(`(() => {
    const rows=[...document.querySelectorAll('.setting-row')]
    const row=rows.find((item)=>item.innerText.includes('同一审批人重复出现'))
    return Boolean(row && !row.classList.contains('is-disabled') && !row.querySelector('.el-select')?.classList.contains('is-disabled'))
  })()`)
  check('duplicateApproverRule 已解除历史禁用状态', duplicateEnabled)

  const requestStart = cdp.requests.length
  const saved = await cdp.evaluate(`(() => {
    const drawer=[...document.querySelectorAll('.el-drawer')].find((item)=>item.getBoundingClientRect().width>0)
    const button=[...(drawer?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='保存')
    button?.click()
    return Boolean(button)
  })()`)
  check('高级配置可提交保存', saved)
  await cdp.waitFor(`(() => ![...document.querySelectorAll('.el-drawer')].some((item)=>item.getBoundingClientRect().width>0))()`, 8000, '高级配置保存')
  await sleep(300)
  const puts = cdp.requests.slice(requestStart).filter((item) => {
    try { return item.method === 'PUT' && new URL(item.url).pathname === `/api/approvals/flows/${flowId}` } catch { return false }
  })
  check('高级设计器保存真实使用 PUT 图写契约', puts.length === 1, `PUT=${puts.length}`)

  const after = (await api('GET', `/approvals/flows/${flowId}`)).data
  const approver = after.createNodes.find((node) => node.nodeType === 'APPROVER')
  check(
    '节点高级配置保存后完整 round-trip',
    approver?.name === newNodeName && approver?.fieldPermissions?.some((item) => item.fieldId === nameField.id && item.permissionType === 'EDIT'),
    JSON.stringify({ expectedName: newNodeName, actualName: approver?.name, nameFieldId: nameField.id, fieldPermissions: approver?.fieldPermissions }),
  )
  check('后置字段值保存为 PASS_V2', approver?.passPostConfig?.fieldUpdateConfigs?.[0]?.fieldValue === 'PASS_V2')
  check('Webhook 配置保留但关闭', approver?.passPostConfig?.webHookConfig?.webHookEnable === false && approver?.passPostConfig?.webHookConfig?.webHookUrl.includes('127.0.0.1'))
  check('流程级高级设置保持真实值', after.allowWithdraw === true && after.allowAddSign === true && after.requireComment === true && after.duplicateApproverRule === 'EACH')
  check('Browser API 非预期 5xx = 0', !cdp.responses.some((item) => item.status >= 500 && item.url.includes('/api/') && !item.url.includes('/webhook/test')))
  check('Browser Runtime exception = 0', cdp.exceptions.length === 0, cdp.exceptions.join('; '))

  console.log(`\nW3.7-9.4F Advanced Designer Browser Smoke: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
} finally {
  cdp?.close()
  await cleanup()
}
