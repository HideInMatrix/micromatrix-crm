const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0

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
      const msg = JSON.parse(event.data)
      if (msg.id) {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(new Error(msg.error.message))
        else pending.resolve(msg.result)
        return
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(msg.params.exceptionDetails?.text ?? 'Runtime exception')
      }
      if (msg.method === 'Network.requestWillBeSent') {
        this.requests.push({ method: msg.params.request.method, url: msg.params.request.url })
      }
      if (msg.method === 'Network.responseReceived') {
        this.responses.push({ status: msg.params.response.status, url: msg.params.response.url })
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

  async navigate(path) {
    const targetUrl = `${webBase}${path}`
    const marker = `w366-modules-${Date.now()}-${Math.random()}`
    await this.evaluate(`document.documentElement.dataset.w366ModulesMarker=${JSON.stringify(marker)}`)
    await this.send('Page.navigate', { url: targetUrl })
    await this.waitFor(
      `location.href===${JSON.stringify(targetUrl)} && document.readyState!=='loading' && document.documentElement.dataset.w366ModulesMarker!==${JSON.stringify(marker)}`,
      15000,
      `页面加载 ${path}`,
    )
  }

  async pointFor(expression) {
    return this.evaluate(`(() => {
      const element=${expression}
      if(!element) return null
      element.scrollIntoView({block:'center', inline:'nearest'})
      const rect=element.getBoundingClientRect()
      if(!rect.width||!rect.height) return null
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}
    })()`)
  }

  async clickElement(expression) {
    const point = await this.pointFor(expression)
    if (!point) return false
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await sleep(80)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    return true
  }

  async hoverElement(expression) {
    const point = await this.pointFor(expression)
    if (!point) return false
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await sleep(350)
    return true
  }

  requestCount(pathname, method, start = 0) {
    return this.requests.slice(start).filter((item) => {
      try { return new URL(item.url).pathname === pathname && (!method || item.method === method) } catch { return false }
    }).length
  }

  close() { this.socket.close() }
}

function moduleButton(moduleKey, text) {
  return `(() => {
    const row=document.querySelector('[data-module-config-key=${JSON.stringify(moduleKey)}]')
    return [...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()===${JSON.stringify(text)}) ?? null
  })()`
}

function visibleMenuItem(text) {
  return `(() => {
    const menus=[...document.querySelectorAll('.el-dropdown-menu')].filter((el)=>el.getBoundingClientRect().width>0)
    return menus.flatMap((menu)=>[...menu.querySelectorAll('.el-dropdown-menu__item')]).find((item)=>item.textContent?.replace(/\\s/g,'').startsWith(${JSON.stringify(text)})) ?? null
  })()`
}

async function domClick(cdp, expression) {
  return cdp.evaluate(`(() => { const el=${expression}; el?.click(); return Boolean(el) })()`)
}

async function waitForResponse(cdp, pathname, status, before, timeoutMs = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const matched = cdp.responses.slice(before).some((item) => {
      try { return new URL(item.url).pathname === pathname && item.status === status } catch { return false }
    })
    if (matched) return true
    await sleep(100)
  }
  return false
}

async function loadModules(cdp) {
  await cdp.navigate('/system/modules')
  await cdp.waitFor(`document.querySelector('[data-module-config-key="opportunity"]') && document.querySelector('[data-module-config-key="contract"]') && document.querySelector('[data-module-config-key="order"]')`, 10000, '交易链模块卡片')
  await sleep(1000)
}

async function assertPrimaryEnabled(cdp, moduleKey, labels) {
  for (const label of labels) {
    const enabled = await cdp.evaluate(`(() => { const b=${moduleButton(moduleKey, label)}; return Boolean(b && !b.disabled) })()`)
    check(`${moduleKey} / ${label} REAL`, enabled)
  }
}

async function assertFieldRoute(cdp, moduleKey, label, formKey) {
  const before = cdp.responses.length
  await cdp.navigate(`/system/modules/fields?module=${encodeURIComponent(formKey)}`)
  check(
    `${label} 目标路由可达`,
    await cdp.evaluate(`location.pathname==='/system/modules/fields' && new URLSearchParams(location.search).get('module')===${JSON.stringify(formKey)}`),
  )
  const requested = await waitForResponse(cdp, `/api/metadata/${formKey}/fields`, 200, before)
  const renderedDirectContractField =
    formKey === 'contract' &&
    (await cdp.evaluate(`document.body?.innerText.includes('产品信息')===true`))
  check(`${label} 消费 ${formKey} metadata`, requested || renderedDirectContractField)
}

async function openMore(cdp, moduleKey) {
  check(`${moduleKey} 更多可打开`, await cdp.hoverElement(moduleButton(moduleKey, '更多')))
  await cdp.waitFor(`[...document.querySelectorAll('.el-dropdown-menu')].some((el)=>el.getBoundingClientRect().width>0)`, 5000, `${moduleKey} 更多菜单`)
}

async function assertMoreEnabled(cdp, moduleKey, labels) {
  await loadModules(cdp)
  await openMore(cdp, moduleKey)
  for (const label of labels) {
    const state = await cdp.evaluate(`(() => { const item=${visibleMenuItem(label)}; return {exists:Boolean(item),disabled:Boolean(item?.classList.contains('is-disabled')||item?.getAttribute('aria-disabled')==='true')} })()`)
    check(`${moduleKey} / ${label} REAL`, state.exists && !state.disabled, JSON.stringify(state))
  }
}

async function assertMoreDrawer(cdp, moduleKey, label, testId, expectedText) {
  await loadModules(cdp)
  await openMore(cdp, moduleKey)
  check(`${label} 可点击`, await domClick(cdp, visibleMenuItem(label)))
  await cdp.waitFor(`(() => { const el=document.querySelector('[data-testid=${JSON.stringify(testId)}]'); return Boolean(el && el.getBoundingClientRect().width>0) })()`, 10000, `${label} Drawer`)
  if (expectedText) {
    await cdp.waitFor(`document.querySelector('[data-testid=${JSON.stringify(testId)}]')?.innerText.includes(${JSON.stringify(expectedText)})===true`, 10000, `${label} 数据`)
  }
}

async function assertPrimaryDrawer(cdp, moduleKey, label, testId, expectedText) {
  await loadModules(cdp)
  check(`${label} 可点击`, await cdp.clickElement(moduleButton(moduleKey, label)))
  await cdp.waitFor(`(() => { const el=document.querySelector('[data-testid=${JSON.stringify(testId)}]'); return Boolean(el && el.getBoundingClientRect().width>0) })()`, 10000, `${label} Drawer`)
  if (expectedText) {
    await cdp.waitFor(`document.querySelector('[data-testid=${JSON.stringify(testId)}]')?.innerText.includes(${JSON.stringify(expectedText)})===true`, 10000, `${label} 数据`)
  }
}

async function main() {
  console.log('\nW3.6.6 /system/modules 最终 Browser Smoke')
  const loginResponse = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'admin123' }),
  })
  const login = await loginResponse.json()
  if (!loginResponse.ok || !login?.accessToken || !login?.refreshToken) throw new Error(`管理员登录失败: ${loginResponse.status}`)

  const target = await loadPageTarget()
  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()
  try {
    await cdp.navigate('/login')
    await cdp.evaluate(`(() => {
      localStorage.setItem('mmx_access_token', ${JSON.stringify(login.accessToken)})
      localStorage.setItem('mmx_refresh_token', ${JSON.stringify(login.refreshToken)})
      return true
    })()`)
    await loadModules(cdp)

    await assertPrimaryEnabled(cdp, 'opportunity', ['商机表单设置', '报价表单设置', '商机阶段设置'])
    await assertPrimaryEnabled(cdp, 'product', ['产品表单设置', '价格表表单设置'])
    await assertPrimaryEnabled(cdp, 'contract', ['合同表单设置', '回款计划表单设置', '回款记录表单设置'])
    await assertPrimaryEnabled(cdp, 'order', ['订单表单设置', '订单状态流设置'])
    await assertMoreEnabled(cdp, 'opportunity', ['商机关闭规则', '商机失败原因设置'])
    await assertMoreEnabled(cdp, 'contract', ['工商抬头表单必填设置', '发票表单设置', '合同阶段设置'])

    await assertPrimaryDrawer(cdp, 'opportunity', '商机阶段设置', 'opportunity-stage-settings-drawer', '阶段')
    await assertMoreDrawer(cdp, 'opportunity', '商机关闭规则', 'opportunity-close-rule-settings-drawer', '规则')
    await assertMoreDrawer(cdp, 'opportunity', '商机失败原因设置', 'opportunity-failure-reason-settings-drawer', '失败原因')
    await assertMoreDrawer(cdp, 'contract', '工商抬头表单必填设置', 'business-title-required-settings-drawer', '工商抬头')
    await assertMoreDrawer(cdp, 'contract', '合同阶段设置', 'contract-stage-settings-drawer', '待签署')
    await assertPrimaryDrawer(cdp, 'order', '订单状态流设置', 'order-stage-settings-drawer', '待发货')

    for (const [moduleKey, label, formKey] of [
      ['contract', '合同表单设置', 'contract'],
      ['opportunity', '商机表单设置', 'opportunity'],
      ['opportunity', '报价表单设置', 'quote'],
      ['product', '产品表单设置', 'product'],
      ['product', '价格表表单设置', 'price'],
      ['contract', '回款计划表单设置', 'contractPaymentPlan'],
      ['contract', '回款记录表单设置', 'contractPaymentRecord'],
      ['order', '订单表单设置', 'order'],
    ]) {
      await assertFieldRoute(cdp, moduleKey, label, formKey)
    }

    const invoiceBefore = cdp.responses.length
    await cdp.navigate('/system/modules/fields?module=invoice')
    check(
      '发票表单设置目标路由可达',
      await cdp.evaluate(`location.pathname==='/system/modules/fields' && new URLSearchParams(location.search).get('module')==='invoice'`),
    )
    check(
      '发票表单设置消费 invoice metadata',
      await waitForResponse(cdp, '/api/metadata/invoice/fields', 200, invoiceBefore),
    )

    const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
    check('最终模块设置 Browser API 5xx = 0', api5xx.length === 0, JSON.stringify(api5xx))
    check('最终模块设置 Browser Runtime exception = 0', cdp.exceptions.length === 0, JSON.stringify(cdp.exceptions))
  } finally {
    cdp.close()
  }

  console.log(`\nW3.6.6 System Modules Browser Smoke: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

await main()
