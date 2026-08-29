const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0

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
      if (msg.method === 'Network.responseReceived') {
        this.responses.push({ status: msg.params.response.status, url: msg.params.response.url })
      }
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
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? '浏览器表达式执行失败')
    }
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
    const marker = `w362-nav-${Date.now()}-${Math.random()}`
    await this.evaluate(`document.documentElement.dataset.w362NavMarker=${JSON.stringify(marker)}`)
    await this.send('Page.navigate', { url: targetUrl })
    await this.waitFor(
      `location.href===${JSON.stringify(targetUrl)} && document.readyState!=='loading' && document.body!==null && document.documentElement.dataset.w362NavMarker!==${JSON.stringify(marker)}`,
      15000,
      `页面加载 ${path}`,
    )
  }

  async clickElement(expression) {
    const point = await this.evaluate(`(() => {
      const element=${expression}
      if (!element) return null
      const rect=element.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`)
    if (!point) return false
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    return true
  }

  close() {
    this.socket.close()
  }
}

async function main() {
  console.log('\nW3.6.2 报价模块设置 Browser Smoke')
  const loginResponse = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'admin123' }),
  })
  const login = await loginResponse.json()
  if (!loginResponse.ok || !login?.accessToken || !login?.refreshToken) {
    throw new Error(`管理员登录失败: ${loginResponse.status}`)
  }
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
    await cdp.waitFor(
      `document.querySelector('[data-module-config-key="opportunity"]') !== null`,
      10000,
      '模块设置商机卡片',
    )
    await cdp.waitFor(`(() => {
      const row=document.querySelector('[data-module-config-key="opportunity"]')
      const button=[...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='报价表单设置')
      return Boolean(button && !button.disabled)
    })()`, 10000, '报价表单设置按钮可用')
    // Vite 开发态首次加载时，Element Plus 按钮会先解除 disabled，随后才完成事件绑定。
    // 等待交互层稳定后再用真实鼠标事件点击，避免把开发态初始化窗口误判为入口失效。
    await sleep(1500)

    const clicked = await cdp.clickElement(`(() => {
      const row=document.querySelector('[data-module-config-key="opportunity"]')
      return [...(row?.querySelectorAll('button')??[])].find((item)=>item.textContent?.trim()==='报价表单设置' && !item.disabled) ?? null
    })()`)
    check('/system/modules 商机卡片报价表单设置为 REAL', clicked)
    await cdp.waitFor(
      `location.pathname==='/system/modules/fields' && new URLSearchParams(location.search).get('module')==='quote'`,
      30000,
      '报价表单设置导航',
    )
    await cdp.waitFor(`document.body?.innerText.includes('累计金额')===true`, 30000, '报价表单元数据加载')
    const text = await cdp.evaluate('document.body.innerText')
    check(
      '报价表单设置消费 direct quote 元数据',
      ['报价', '商机', '联系人', '报价日期', '有效期至', '累计金额'].every((item) => text.includes(item)),
    )
    check(
      '报价表单设置已移除旧 Quote 单号/状态主字段',
      ['报价单号', '报价状态'].every((item) => !text.includes(item)),
    )
    const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
    check('报价模块设置 Browser Smoke 无 API 5xx', api5xx.length === 0)
    check('报价模块设置 Browser Smoke 无 Runtime exception', cdp.exceptions.length === 0)
  } finally {
    cdp.close()
  }

  console.log(`\n结果：${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

await main()
