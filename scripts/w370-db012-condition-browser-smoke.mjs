const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let adminToken = ''
let flowId = ''

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
  const result = await api('POST', '/auth/login', { email, password }, '')
  return result.data
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
  try { await api('DELETE', `/approvals/flows/${flowId}`, undefined, adminToken, [400, 404]) } catch { /* best effort */ }
}

let cdp
try {
  console.log('\nW3.7-9.4A DB-012 Condition Browser Smoke')
  const admin = await login('admin@demo.com', 'admin123')
  const manager = await login('zhangwei@demo.com', 'admin123')
  const lina = await login('lina@demo.com', 'demo123')
  adminToken = admin.accessToken

  const suffix = Date.now().toString(36)
  const name = `W370_DB012_BROWSER_${suffix}`
  const created = (await api('POST', '/approvals/flows', {
    formType: 'quotation',
    name,
    description: '9.4A browser readonly guard',
    enabled: false,
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
      { clientId: 'start', nodeType: 'START', name: '开始' },
      {
        clientId: 'condition', nodeType: 'CONDITION', name: '高金额',
        conditionConfig: { searchMode: 'AND', conditions: [{ name: 'amount', operator: 'GE', value: 1000 }] },
      },
      { clientId: 'default', nodeType: 'DEFAULT', name: '默认' },
      { clientId: 'manager', nodeType: 'APPROVER', name: '主管审批', approverType: 'USER', approverIds: [manager.user.id], ccUserIds: [], mode: 'ANY' },
      { clientId: 'sales', nodeType: 'APPROVER', name: '销售审批', approverType: 'USER', approverIds: [lina.user.id], ccUserIds: [], mode: 'ANY' },
      { clientId: 'end', nodeType: 'END', name: '结束' },
    ],
    createLinks: [
      { fromNodeId: 'start', toNodeId: 'condition', sort: 0 },
      { fromNodeId: 'start', toNodeId: 'default', sort: 1 },
      { fromNodeId: 'condition', toNodeId: 'manager', sort: 0 },
      { fromNodeId: 'default', toNodeId: 'sales', sort: 0 },
      { fromNodeId: 'manager', toNodeId: 'end', sort: 0 },
      { fromNodeId: 'sales', toNodeId: 'end', sort: 0 },
    ],
  })).data
  flowId = created.id
  const before = (await api('GET', `/approvals/flows/${flowId}`)).data
  check('API 已创建真实 CONDITION / DEFAULT 图', before.createNodes.some((node) => node.nodeType === 'CONDITION') && before.createNodes.some((node) => node.nodeType === 'DEFAULT'))

  const target = await loadPageTarget()
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.navigate('/login')
  await cdp.evaluate(`localStorage.setItem('mmx_access_token',${JSON.stringify(adminToken)});localStorage.setItem('mmx_refresh_token',${JSON.stringify(admin.refreshToken)});true`)
  await cdp.navigate('/system/approval-flows')
  await cdp.waitFor(`document.body?.innerText.includes(${JSON.stringify(name)})===true`, 12000, '流程列表出现高级图')
  check('流程设置列表可读取高级图流程', true)

  const requestStart = cdp.requests.length
  const opened = await cdp.evaluate(`(() => {
    const button=document.querySelector('button[data-flow-edit=${JSON.stringify(flowId)}]')
    button?.click()
    return Boolean(button)
  })()`)
  check('高级图流程可进入编辑抽屉', opened)
  await cdp.waitFor(`document.body?.innerText.includes('编辑流程')===true`, 12000, '编辑抽屉')
  await sleep(1500)
  const drawerState = await cdp.evaluate(`(() => {
    const drawers=[...document.querySelectorAll('.el-drawer')].map((item)=>({width:item.getBoundingClientRect().width,text:item.innerText}))
    return { drawers, body: document.body?.innerText?.slice(0,1200) ?? '' }
  })()`)
  const detailPath = `/api/approvals/flows/${flowId}`
  const detailResponses = cdp.responses.filter((item) => {
    try { return new URL(item.url).pathname === detailPath } catch { return false }
  })
  const visibleDrawerText = drawerState.drawers.find((item) => item.width > 0)?.text ?? ''
  check(
    '高级图详情加载完成',
    visibleDrawerText.includes(before.number) && detailResponses.some((item) => item.status === 200),
    JSON.stringify({ drawer: visibleDrawerText.slice(0,500), detailResponses }),
  )
  const flowStepClicked = await cdp.evaluate(`(() => {
    const drawer=[...document.querySelectorAll('.el-drawer')].find((item)=>item.getBoundingClientRect().width>0)
    const b=[...(drawer?.querySelectorAll('.step-nav button')??[])].find((item)=>item.querySelector('strong')?.textContent?.trim()==='流程设计')
    b?.click()
    return Boolean(b)
  })()`)
  check('编辑抽屉可切换到流程设计', flowStepClicked)
  await cdp.waitFor(`(() => {
    const drawer=[...document.querySelectorAll('.el-drawer')].find((item)=>item.getBoundingClientRect().width>0)
    return Boolean(drawer?.innerText.includes('该流程包含 Condition / DEFAULT 分支'))
  })()`, 8000, '高级图只读警告')
  check('页面明确显示高级图只读警告', true)
  check('线性画布不提供添加审批节点', !(await cdp.evaluate(`document.body?.innerText.includes('添加审批节点')===true`)))

  const saveClicked = await cdp.evaluate(`(() => {
    const drawers=[...document.querySelectorAll('.el-drawer')].filter((item)=>item.getBoundingClientRect().width>0)
    const save=[...(drawers.at(-1)?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='保存')
    save?.click()
    return Boolean(save)
  })()`)
  check('编辑抽屉仍保留保存入口用于 fail-closed 校验', saveClicked)
  await cdp.waitFor(`document.body?.innerText.includes('当前版本禁止线性覆盖保存')===true`, 5000, '禁止覆盖提示')
  check('点击保存被前端明确阻止', true)
  await sleep(500)
  const putRequests = cdp.requests.slice(requestStart).filter((item) => {
    try { return item.method === 'PUT' && new URL(item.url).pathname === `/api/approvals/flows/${flowId}` } catch { return false }
  })
  check('高级图编辑未发出 PUT 覆盖请求', putRequests.length === 0, `PUT=${putRequests.length}`)

  const after = (await api('GET', `/approvals/flows/${flowId}`)).data
  check('高级图版本未被线性编辑器改写', after.currentVersion === before.currentVersion)
  check('高级图 links 保持不变', JSON.stringify(after.createLinks) === JSON.stringify(before.createLinks))
  check('Browser API 5xx = 0', !cdp.responses.some((item) => item.status >= 500 && item.url.includes('/api/')))
  check('Browser Runtime exception = 0', cdp.exceptions.length === 0, cdp.exceptions.join('; '))

  console.log(`\nW3.7-9.4A Condition Browser Smoke: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
} finally {
  cdp?.close()
  await cleanup()
}
