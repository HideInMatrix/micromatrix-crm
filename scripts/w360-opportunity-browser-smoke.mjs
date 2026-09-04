const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let createdOpportunityId = ''

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

async function apiRequest(method, path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const raw = await response.text()
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    /* ignore */
  }
  return { response, data, raw }
}

async function loadPageTarget() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((r) => r.json())
      const page = targets.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* Chrome may be starting */
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
      const msg = JSON.parse(event.data)
      if (msg.id) {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(new Error(msg.error.message))
        else pending.resolve(msg.result)
        return
      }
      if (msg.method === 'Runtime.exceptionThrown')
        this.exceptions.push(msg.params.exceptionDetails?.text ?? 'Runtime exception')
      if (msg.method === 'Network.requestWillBeSent')
        this.requests.push({ method: msg.params.request.method, url: msg.params.request.url })
      if (msg.method === 'Network.responseReceived')
        this.responses.push({ status: msg.params.response.status, url: msg.params.response.url })
    })
    await Promise.all([
      this.send('Page.enable'),
      this.send('Runtime.enable'),
      this.send('Network.enable'),
    ])
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
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.text ?? '浏览器表达式执行失败')
    return result.result?.value
  }
  async navigate(path) {
    await this.send('Page.navigate', { url: `${webBase}${path}` })
    await this.waitFor(`document.readyState !== 'loading'`, 10000, `页面加载 ${path}`)
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
      try {
        return new URL(item.url).pathname === pathname && (!method || item.method === method)
      } catch {
        return false
      }
    }).length
  }
  close() {
    this.socket.close()
  }
}

const textIncludes = (text) => `document.body?.innerText.includes(${JSON.stringify(text)}) === true`

async function clickText(cdp, text, selector = 'button') {
  return cdp.evaluate(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0)
    el?.click(); return Boolean(el)
  })()`)
}

async function closeDrawer(cdp, testId) {
  await cdp.evaluate(
    `document.querySelector('[data-testid=${JSON.stringify(testId)}] .el-drawer__close-btn')?.click()`,
  )
  await sleep(150)
}

async function openOpportunityMore(cdp) {
  const hovered = await cdp.evaluate(`(() => {
    const row=document.querySelector('[data-module-config-key="opportunity"]')
    const btn=[...(row?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='更多')
    if(!btn) return false
    btn.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}))
    return true
  })()`)
  if (!hovered) throw new Error('无法打开商机更多菜单')
  await sleep(200)
}

async function clickVisibleMenuItem(cdp, text) {
  return cdp.evaluate(`(() => {
    const el=[...document.querySelectorAll('.el-dropdown-menu__item')].find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0)
    el?.click(); return Boolean(el)
  })()`)
}

async function main() {
  console.log('\nW3.6.0 商机 Browser Smoke')
  const login = await apiRequest('POST', '/auth/login', {
    email: 'admin@demo.com',
    password: 'admin123',
  })
  if (!login.response.ok || !login.data?.accessToken)
    throw new Error(`演示管理员登录失败: ${login.response.status}`)
  token = login.data.accessToken
  const name = `W360 Browser Opportunity ${Date.now().toString(36)}`
  const created = await apiRequest('POST', '/opportunity/add', { name, products: [] })
  if (!created.response.ok || !created.data?.id)
    throw new Error(`创建 Browser Smoke 商机失败: ${created.response.status} ${created.raw}`)
  createdOpportunityId = created.data.id

  const target = await loadPageTarget()
  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()
  try {
    await Promise.all([
      cdp.send('Storage.clearDataForOrigin', { origin: webBase, storageTypes: 'all' }),
      cdp.send('Network.clearBrowserCookies'),
    ])
    await cdp.navigate('/login')
    await cdp.waitFor(textIncludes('演示账号：admin@demo.com / admin123'), 10000, '登录页')
    await cdp.evaluate(
      `(() => { const button=[...document.querySelectorAll('button')].find((item)=>item.textContent?.replace(/\\s/g,'').includes('登录')); button?.click(); return Boolean(button) })()`,
    )
    await cdp.waitFor(`location.pathname === '/dashboard'`, 10000, '登录成功')

    await cdp.navigate('/opportunities')
    await cdp.waitFor(textIncludes('新建商机'), 10000, '商机页面')
    await cdp.waitFor(
      `document.body.innerText.includes(${JSON.stringify(name)})`,
      10000,
      'Smoke 商机出现在列表',
    )
    check(
      '列表使用 Cordys POST /opportunity/page',
      cdp.requestCount('/api/opportunity/page', 'POST') >= 1,
    )
    check(
      '商机保存视图加载 /opportunity/view/list',
      cdp.requestCount('/api/opportunity/view/list', 'GET') >= 1,
    )

    await clickText(cdp, '新建商机')
    await cdp.waitFor(textIncludes('商机名称'), 5000, '新建商机弹窗')
    const labels = await cdp.evaluate(`document.body.innerText`)
    check(
      '新建表单使用 Cordys 直接字段',
      [
        '商机名称',
        '负责人',
        '关联客户',
        '联系人',
        '商机金额',
        '可能性',
        '意向产品',
        '结束时间',
      ].every((item) => labels.includes(item)),
    )
    check('商机表单已移除旧产品明细', !labels.includes('产品明细'))
    await clickText(cdp, '取消')

    const selected = await cdp.evaluate(`(() => {
      const row=[...document.querySelectorAll('tbody tr')].find((x)=>x.innerText.includes(${JSON.stringify(name)}))
      const checkbox=row?.querySelector('.el-checkbox__input')
      checkbox?.dispatchEvent(new MouseEvent('click',{bubbles:true}))
      return Boolean(checkbox)
    })()`)
    check('商机列表支持批量选择', selected)
    await cdp.waitFor(textIncludes('批量转移'), 3000, '批量动作')
    check(
      '批量转移/删除动作可见',
      await cdp.evaluate(
        `document.body.innerText.includes('批量转移') && document.body.innerText.includes('批量删除')`,
      ),
    )

    const kanbanClicked = await cdp.evaluate(`(() => {
      const el=[...document.querySelectorAll('.el-radio-button')].find((x)=>x.textContent?.trim()==='看板' && x.getBoundingClientRect().width>0)
      el?.click(); return Boolean(el)
    })()`)
    check('商机列表可切换看板', kanbanClicked)
    await cdp.waitFor(
      `document.querySelectorAll('[data-testid="opportunity-board-column"]').length > 0`,
      5000,
      '商机看板',
    )
    check(
      '商机看板使用可拖拽容器',
      await cdp.evaluate(
        `document.querySelectorAll('[data-testid="opportunity-board-column"]').length > 0`,
      ),
    )

    await cdp.navigate(`/opportunities?id=${encodeURIComponent(createdOpportunityId)}`)
    await cdp.waitFor(textIncludes(name), 10000, '商机深链详情')
    await cdp.waitFor(
      `document.querySelector('[data-testid="opportunity-detail-drawer"]')?.innerText.includes(${JSON.stringify(name)}) === true`,
      10000,
      '商机详情 Drawer',
    )
    check(
      '深链打开商机详情 Drawer',
      await cdp.evaluate(
        `document.querySelector('[data-testid="opportunity-detail-drawer"]')?.innerText.includes(${JSON.stringify(name)}) === true`,
      ),
    )
    check(
      '详情包含详情/联系人/跟进记录 Tab',
      await cdp.evaluate(
        `['详情','联系人','跟进记录'].every((x)=>document.querySelector('[data-testid="opportunity-detail-drawer"]')?.innerText.includes(x))`,
      ),
    )

    await cdp.navigate('/system/modules')
    await cdp.waitFor(
      `document.querySelector('[data-module-config-key="opportunity"]') !== null`,
      10000,
      '模块设置商机卡片',
    )
    const stageClicked = await cdp.evaluate(`(() => {
      const row=document.querySelector('[data-module-config-key="opportunity"]')
      const btn=[...(row?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='商机阶段设置')
      btn?.click(); return Boolean(btn)
    })()`)
    check('商机阶段设置入口可点击', stageClicked)
    await cdp.waitFor(
      `document.querySelector('[data-testid="opportunity-stage-settings-drawer"]') !== null`,
      5000,
      '商机阶段 Drawer',
    )
    check(
      '阶段 Drawer 包含回退设置与添加阶段',
      await cdp.evaluate(
        `document.querySelector('[data-testid="opportunity-stage-settings-drawer"]')?.innerText.includes('进行中允许回退') && document.querySelector('[data-testid="opportunity-stage-settings-drawer"]')?.innerText.includes('添加阶段')`,
      ),
    )
    await closeDrawer(cdp, 'opportunity-stage-settings-drawer')

    await openOpportunityMore(cdp)
    check('商机关闭规则菜单可点击', await clickVisibleMenuItem(cdp, '商机关闭规则'))
    await cdp.waitFor(
      `document.querySelector('[data-testid="opportunity-close-rule-settings-drawer"]') !== null`,
      5000,
      '商机关闭规则 Drawer',
    )
    check(
      '关闭规则 Drawer 为真实功能',
      await cdp.evaluate(
        `document.querySelector('[data-testid="opportunity-close-rule-settings-drawer"]')?.innerText.includes('添加规则') === true`,
      ),
    )
    await closeDrawer(cdp, 'opportunity-close-rule-settings-drawer')

    await openOpportunityMore(cdp)
    check('商机失败原因菜单可点击', await clickVisibleMenuItem(cdp, '商机失败原因设置'))
    await cdp.waitFor(
      `document.querySelector('[data-testid="opportunity-failure-reason-settings-drawer"]') !== null`,
      5000,
      '商机失败原因 Drawer',
    )
    check(
      '失败原因 Drawer 为真实功能',
      await cdp.evaluate(
        `document.querySelector('[data-testid="opportunity-failure-reason-settings-drawer"]')?.innerText.includes('最多 50 条') === true`,
      ),
    )

    const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
    check(
      '商机 Browser Smoke 无 API 5xx',
      api5xx.length === 0,
      api5xx.map((item) => `${item.status} ${item.url}`).join(', '),
    )
    check(
      '商机 Browser Smoke 无 Runtime exception',
      cdp.exceptions.length === 0,
      cdp.exceptions.join(', '),
    )
  } finally {
    cdp.close()
  }

  console.log(`\n结果：${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

try {
  await main()
} finally {
  if (createdOpportunityId) await apiRequest('GET', `/opportunity/delete/${createdOpportunityId}`)
}
