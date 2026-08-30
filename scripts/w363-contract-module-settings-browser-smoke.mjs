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
  for (let i = 0; i < 50; i += 1) {
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
    const marker = `w363-module-${Date.now()}-${Math.random()}`
    await this.evaluate(`document.documentElement.dataset.w363ModuleMarker=${JSON.stringify(marker)}`)
    await this.send('Page.navigate', { url: targetUrl })
    await this.waitFor(
      `location.href===${JSON.stringify(targetUrl)} && document.readyState!=='loading' && document.documentElement.dataset.w363ModuleMarker!==${JSON.stringify(marker)}`,
      15000,
      `页面加载 ${path}`,
    )
  }

  async clickElement(expression) {
    const visible = await this.evaluate(`(() => {
      const element=${expression}
      if(!element) return false
      element.scrollIntoView({block:'center',inline:'center'})
      return true
    })()`)
    if (!visible) return false
    await sleep(150)
    const point = await this.evaluate(`(() => {
      const element=${expression}
      if(!element) return null
      const rect=element.getBoundingClientRect()
      if(!rect.width||!rect.height||rect.bottom<0||rect.right<0||rect.top>innerHeight||rect.left>innerWidth) return null
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}
    })()`)
    if (!point) return false
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await sleep(120)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    return true
  }

  async hoverElement(expression) {
    const visible = await this.evaluate(`(() => {
      const element=${expression}
      if(!element) return false
      element.scrollIntoView({block:'center',inline:'center'})
      return true
    })()`)
    if (!visible) return false
    await sleep(150)
    const point = await this.evaluate(`(() => {
      const element=${expression}
      if(!element) return null
      const rect=element.getBoundingClientRect()
      if(!rect.width||!rect.height||rect.bottom<0||rect.right<0||rect.top>innerHeight||rect.left>innerWidth) return null
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}
    })()`)
    if (!point) return false
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await sleep(300)
    return true
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

  close() { this.socket.close() }
}

function contractButton(text) {
  return `(() => {
    const row=document.querySelector('[data-module-config-key="contract"]')
    return [...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()===${JSON.stringify(text)}) ?? null
  })()`
}

async function main() {
  console.log('\nW3.6.3 合同模块设置 Browser Smoke')
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
    await cdp.navigate('/system/modules')
    await cdp.waitFor(`document.querySelector('[data-module-config-key="contract"]')!==null`, 10000, '合同模块卡片')
    await sleep(800)

    check('合同表单设置为 REAL', await cdp.evaluate(`(() => { const b=${contractButton('合同表单设置')}; return Boolean(b && !b.disabled) })()`))
    check('回款计划表单设置为 REAL', await cdp.evaluate(`(() => { const b=${contractButton('回款计划表单设置')}; return Boolean(b && !b.disabled) })()`))
    check('回款记录表单设置为 REAL', await cdp.evaluate(`(() => { const b=${contractButton('回款记录表单设置')}; return Boolean(b && !b.disabled) })()`))

    check('合同更多菜单可打开', await cdp.hoverElement(contractButton('更多')))
    await cdp.waitFor(`[...document.querySelectorAll('.el-dropdown-menu')].some((el)=>el.getBoundingClientRect().width>0)`, 5000, '合同更多菜单')
    check('合同阶段设置可点击', await cdp.evaluate(`(() => {
      const item=[...document.querySelectorAll('.el-dropdown-menu__item')].find((el)=>el.getBoundingClientRect().width>0 && el.textContent?.replace(/\\s/g,'').startsWith('合同阶段设置'))
      item?.click(); return Boolean(item)
    })()`))
    await cdp.waitFor(`(() => { const el=document.querySelector('[data-testid="contract-stage-settings-drawer"]'); return Boolean(el && el.getBoundingClientRect().width>0) })()`, 10000, '合同阶段 Drawer')
    await cdp.waitFor(`document.querySelector('[data-testid="contract-stage-settings-drawer"]')?.innerText.includes('待签署')===true`, 10000, '合同阶段 direct 数据加载')
    const stageText = await cdp.evaluate(`document.querySelector('[data-testid="contract-stage-settings-drawer"]')?.innerText ?? ''`)
    const stageApiLoaded = cdp.responses.some((item) => {
      try { return new URL(item.url).pathname === '/api/contract/stage/get' && item.status === 200 } catch { return false }
    })
    check(
      '合同阶段 Drawer 消费 direct stage 配置',
      stageApiLoaded && ['待签署','已签署','履行中','合同完结','作废'].every((text) => stageText.includes(text)),
      stageText,
    )
    check('合同阶段 Drawer 暴露回退与流转模式', ['进行中允许回退','完结后允许回退','基础流转','高级流转','添加阶段'].every((text) => stageText.includes(text)))

    await cdp.navigate('/system/modules')
    await cdp.waitFor(`document.querySelector('[data-module-config-key="contract"]')!==null`, 10000, '合同模块卡片重载')
    await sleep(800)

    const contractMetadataBefore = cdp.requestCount('/api/metadata/contract/fields', 'GET')
    check('合同表单设置可点击', await cdp.clickElement(contractButton('合同表单设置')))
    await cdp.waitFor(`location.pathname==='/system/modules/fields' && new URLSearchParams(location.search).get('module')==='contract'`, 15000, '合同表单设置导航')
    await sleep(800)
    check('合同表单消费 direct metadata', cdp.requestCount('/api/metadata/contract/fields', 'GET') > contractMetadataBefore)

    await cdp.navigate('/system/modules')
    await cdp.waitFor(`document.querySelector('[data-module-config-key="contract"]')!==null`, 10000, '合同模块卡片重载')
    await sleep(500)
    const planMetadataBefore = cdp.requestCount('/api/metadata/contractPaymentPlan/fields', 'GET')
    check('回款计划表单设置可点击', await cdp.clickElement(contractButton('回款计划表单设置')))
    await cdp.waitFor(`location.pathname==='/system/modules/fields' && new URLSearchParams(location.search).get('module')==='contractPaymentPlan'`, 15000, '回款计划表单设置导航')
    await sleep(800)
    check('回款计划表单消费 direct metadata', cdp.requestCount('/api/metadata/contractPaymentPlan/fields', 'GET') > planMetadataBefore)

    await cdp.navigate('/system/modules')
    await cdp.waitFor(`document.querySelector('[data-module-config-key="contract"]')!==null`, 10000, '合同模块卡片重载')
    await sleep(500)
    const recordMetadataBefore = cdp.requestCount('/api/metadata/contractPaymentRecord/fields', 'GET')
    check('回款记录表单设置可点击', await cdp.clickElement(contractButton('回款记录表单设置')))
    await cdp.waitFor(`location.pathname==='/system/modules/fields' && new URLSearchParams(location.search).get('module')==='contractPaymentRecord'`, 15000, '回款记录表单设置导航')
    await sleep(800)
    check('回款记录表单消费 direct metadata', cdp.requestCount('/api/metadata/contractPaymentRecord/fields', 'GET') > recordMetadataBefore)

    await cdp.navigate('/system/modules')
    await cdp.waitFor(`document.querySelector('[data-module-config-key="contract"]')!==null`, 10000, '合同模块卡片重载')
    await sleep(800)
    check('合同更多菜单可打开', await cdp.hoverElement(contractButton('更多')))
    await cdp.waitFor(`[...document.querySelectorAll('.el-dropdown-menu')].some((el)=>el.getBoundingClientRect().width>0)`, 5000, '合同更多菜单')
    const moreState = await cdp.evaluate(`(() => {
      const visible=[...document.querySelectorAll('.el-dropdown-menu')].filter((el)=>el.getBoundingClientRect().width>0)
      const items=visible.flatMap((menu)=>[...menu.querySelectorAll('.el-dropdown-menu__item')])
      const state=(text)=>{const item=items.find((el)=>el.textContent?.replace(/\\s/g,'').startsWith(text));return {exists:Boolean(item),disabled:Boolean(item?.classList.contains('is-disabled')||item?.getAttribute('aria-disabled')==='true')}}
      return { title:state('工商抬头表单必填设置'), invoice:state('发票表单设置'), stage:state('合同阶段设置') }
    })()`)
    check('工商抬头必填设置为 REAL', moreState.title.exists && !moreState.title.disabled, JSON.stringify(moreState.title))
    check('发票表单设置为 REAL', moreState.invoice.exists && !moreState.invoice.disabled, JSON.stringify(moreState.invoice))
    check('合同阶段设置为 REAL', moreState.stage.exists && !moreState.stage.disabled, JSON.stringify(moreState.stage))

    check('工商抬头必填设置可点击', await cdp.evaluate(`(() => {
      const item=[...document.querySelectorAll('.el-dropdown-menu__item')].find((el)=>el.getBoundingClientRect().width>0 && el.textContent?.replace(/\\s/g,'').startsWith('工商抬头表单必填设置'))
      item?.click(); return Boolean(item)
    })()`))
    await cdp.waitFor(`(() => { const el=document.querySelector('[data-testid="business-title-required-settings-drawer"]'); return Boolean(el && el.getBoundingClientRect().width>0) })()`, 10000, '工商抬头必填 Drawer')

    await cdp.navigate('/system/modules')
    await cdp.waitFor(`document.querySelector('[data-module-config-key="contract"]')!==null`, 10000, '合同模块卡片重载')
    await sleep(500)
    check('合同更多菜单可再次打开', await cdp.hoverElement(contractButton('更多')))
    await cdp.waitFor(`[...document.querySelectorAll('.el-dropdown-menu')].some((el)=>el.getBoundingClientRect().width>0)`, 5000, '合同更多菜单')
    const invoiceMetadataBefore = cdp.requestCount('/api/metadata/invoice/fields', 'GET')
    check('发票表单设置可点击', await cdp.evaluate(`(() => {
      const item=[...document.querySelectorAll('.el-dropdown-menu__item')].find((el)=>el.getBoundingClientRect().width>0 && el.textContent?.replace(/\\s/g,'').startsWith('发票表单设置'))
      if (!item) return false
      setTimeout(() => item.click(), 0)
      return true
    })()`))
    await cdp.waitFor(`location.pathname==='/system/modules/fields' && new URLSearchParams(location.search).get('module')==='invoice'`, 15000, '发票表单设置导航')
    await sleep(800)
    check('发票表单消费 direct metadata', cdp.requestCount('/api/metadata/invoice/fields', 'GET') > invoiceMetadataBefore)

    const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
    check('合同模块设置 Browser Smoke 无 API 5xx', api5xx.length === 0, api5xx.map((item) => `${item.status} ${item.url}`).join(', '))
    check('合同模块设置 Browser Smoke 无 Runtime exception', cdp.exceptions.length === 0, cdp.exceptions.join(', '))
  } finally {
    cdp.close()
  }

  console.log(`\n结果：${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

await main()
