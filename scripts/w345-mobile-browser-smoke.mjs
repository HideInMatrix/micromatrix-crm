const mobileOrigin = process.env.MOBILE_ORIGIN ?? 'http://127.0.0.1:5174'
const pcOrigin = process.env.PC_ORIGIN ?? 'http://127.0.0.1:5173'
const webBase = process.env.WEB_BASE ?? `${mobileOrigin}/mobile`
const storageOrigin = new URL(webBase).origin
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
    this.consoleErrors = []
    this.requests = []
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
        const details = message.params.exceptionDetails
        this.exceptions.push(
          details?.exception?.description ?? details?.text ?? 'Runtime exception',
        )
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push(
          message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '),
        )
      }
      if (message.method === 'Network.requestWillBeSent') {
        this.requests.push({
          method: message.params.request.method,
          url: message.params.request.url,
        })
      }
    })
    await Promise.all([
      this.send('Page.enable'),
      this.send('Runtime.enable'),
      this.send('Network.enable'),
    ])
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    })
    await this.send('Emulation.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
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

  async waitFor(expression, timeoutMs, label) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }

  async navigate(path) {
    await this.send('Page.navigate', { url: `${webBase}${path}` })
    await this.waitFor(
      `document.readyState === 'interactive' || document.readyState === 'complete'`,
      20000,
      `页面加载 ${path}`,
    )
  }

  async navigateUrl(url) {
    await this.send('Page.navigate', { url })
    await this.waitFor(
      `document.readyState === 'interactive' || document.readyState === 'complete'`,
      20000,
      `页面加载 ${url}`,
    )
  }

  async reload() {
    const previousTimeOrigin = await this.evaluate('performance.timeOrigin')
    await this.send('Page.reload', { ignoreCache: true })
    await this.waitFor(
      `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)} && (document.readyState === 'interactive' || document.readyState === 'complete')`,
      20000,
      '页面刷新完成',
    )
  }

  resetNetwork() {
    this.requests = []
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

async function fillInput(cdp, selector, value) {
  return cdp.evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el) return false;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    setter?.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
}

async function clickVisibleText(cdp, text, selector = '*') {
  return cdp.evaluate(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent?.trim()===${JSON.stringify(text)} && item.getBoundingClientRect().width>0 && item.getBoundingClientRect().height>0);
    el?.click();
    return Boolean(el);
  })()`)
}

async function login(cdp) {
  await Promise.all([
    cdp.send('Storage.clearDataForOrigin', { origin: storageOrigin, storageTypes: 'all' }),
    cdp.send('Network.clearBrowserCookies'),
  ])
  await cdp.navigate('/login')
  await cdp.waitFor(
    `document.querySelector('input[placeholder="请输入邮箱"]') !== null`,
    10000,
    '移动登录表单',
  )
  await fillInput(cdp, 'input[placeholder="请输入邮箱"]', 'admin@demo.com')
  await fillInput(cdp, 'input[placeholder="请输入密码"]', 'admin123')
  await clickVisibleText(cdp, '登录', 'button')
  await cdp.waitFor(`location.pathname === '/mobile/home'`, 15000, '移动登录成功')
}

async function main() {
  console.log('\nW3.4.5 Mobile Browser Smoke')
  const target = await loadPageTarget()
  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()
  try {
    await cdp.navigateUrl(`${pcOrigin}/`)
    await cdp.waitFor(
      `location.origin === ${JSON.stringify(mobileOrigin)} && location.pathname.startsWith('/mobile')`,
      10000,
      'PC 开发入口切换移动设备后跳转 Mobile App',
    )
    check(
      'Device Toolbar Mobile UA 从 5173 自动进入 5174/mobile/',
      await cdp.evaluate(
        `location.origin === ${JSON.stringify(mobileOrigin)} && location.pathname.startsWith('/mobile')`,
      ),
    )
    check(
      'Device Toolbar 分流不经过 Vite public base URL 提示页',
      await cdp.evaluate(
        `!document.body.innerText.includes('The server is configured with a public base URL of /mobile/')`,
      ),
    )

    await login(cdp)

    cdp.resetNetwork()
    await cdp.navigate('/home')
    await cdp.waitFor(`document.body.innerText.includes('本月新线索')`, 15000, 'Mobile Home')
    check(
      'Mobile Home 使用手机布局和底部导航',
      await cdp.evaluate(
        `document.querySelector('.crm-mobile-layout') !== null && ['工作台','线索','客户','审批','我的'].every((x)=>document.body.innerText.includes(x))`,
      ),
    )
    check(
      'Mobile Home 加载真实统计接口',
      cdp.requestCount('/api/home/overview/summary', 'GET') === 1,
      `count=${cdp.requestCount('/api/home/overview/summary', 'GET')}`,
    )
    check(
      'Mobile Home 展示真实统计与业务入口',
      await cdp.evaluate(
        `['本月新线索','本月新客户','本月新商机','本月赢单','本月回款','我的跟进计划','待我审批'].every((x)=>document.body.innerText.includes(x))`,
      ),
    )
    await cdp.reload()
    await cdp.waitFor(
      `location.pathname === '/mobile/home' && document.body.innerText.includes('本月新线索')`,
      15000,
      'Mobile Home 刷新',
    )
    check(
      'Mobile Home 刷新保持独立移动工作台',
      await cdp.evaluate(
        `location.pathname === '/mobile/home' && document.querySelector('.crm-mobile-layout') !== null`,
      ),
    )

    await clickVisibleText(cdp, '我的跟进计划')
    await cdp.waitFor(
      `location.pathname === '/mobile/follow-plans'`,
      10000,
      'Mobile depth=2 跟进计划',
    )
    check(
      'Mobile depth=2 页面隐藏一级 Tabbar',
      await cdp.evaluate(`document.querySelector('.crm-mobile-tabbar') === null`),
    )
    await cdp.evaluate(`history.back(); true`)
    await cdp.waitFor(`location.pathname === '/mobile/home'`, 10000, 'Mobile 返回一级页面')
    check(
      'Mobile 返回 depth=1 页面恢复 Tabbar',
      await cdp.evaluate(`document.querySelector('.crm-mobile-tabbar') !== null`),
    )

    cdp.resetNetwork()
    await cdp.navigate('/leads')
    await cdp.waitFor(
      `document.body.innerText.includes('我的线索') && document.body.innerText.includes('线索池')`,
      15000,
      'Mobile Leads',
    )
    await cdp.waitFor(`document.querySelector('.van-list') !== null`, 10000, 'Mobile 线索列表')
    await sleep(300)
    check(
      'Mobile 线索页加载普通线索真实接口',
      cdp.requestCount('/api/lead/page', 'POST') >= 1,
      `count=${cdp.requestCount('/api/lead/page', 'POST')}`,
    )
    check(
      'Mobile 线索页保留搜索/新建/我的线索/线索池',
      await cdp.evaluate(
        `['新建','我的线索','线索池','搜索名称 / 联系人 / 电话'].every((x)=>document.body.innerText.includes(x) || [...document.querySelectorAll('input')].some((i)=>i.placeholder===x))`,
      ),
    )

    cdp.resetNetwork()
    await clickVisibleText(cdp, '线索池')
    await cdp.waitFor(
      `document.body.innerText.includes('领取') || document.querySelector('.van-empty') !== null || document.querySelector('.van-list') !== null`,
      15000,
      'Mobile 线索池',
    )
    await sleep(300)
    check(
      'Mobile 线索池真实请求 Pool options/page',
      cdp.requestCount('/api/pool/lead/options', 'GET') >= 1 &&
        cdp.requestCount('/api/pool/lead/page', 'POST') >= 1,
      `options=${cdp.requestCount('/api/pool/lead/options', 'GET')}, page=${cdp.requestCount('/api/pool/lead/page', 'POST')}`,
    )

    await cdp.reload()
    await cdp.waitFor(
      `location.pathname === '/mobile/leads' && document.body.innerText.includes('我的线索')`,
      15000,
      'Mobile Leads 刷新',
    )
    check(
      'Mobile 线索刷新后仍保持独立移动页面',
      await cdp.evaluate(
        `location.pathname === '/mobile/leads' && document.querySelector('.crm-mobile-layout') !== null`,
      ),
    )

    check(
      'Mobile Browser 无未捕获 Runtime exception',
      cdp.exceptions.length === 0,
      cdp.exceptions.join(' | '),
    )
    check(
      'Mobile Browser 无业务 Console error',
      cdp.consoleErrors.length === 0,
      cdp.consoleErrors.join(' | '),
    )

    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      platform: 'MacIntel',
    })
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await cdp.navigateUrl(`${mobileOrigin}/mobile/`)
    await cdp.waitFor(
      `location.origin === ${JSON.stringify(pcOrigin)} && location.pathname === '/'`,
      10000,
      '关闭 Device Toolbar 后回到 PC App',
    )
    check(
      'Desktop UA 从 5174/mobile 自动回到 5173',
      await cdp.evaluate(
        `location.origin === ${JSON.stringify(pcOrigin)} && location.pathname === '/'`,
      ),
    )
  } finally {
    cdp.close()
  }

  console.log(`\n结果：${passed} 通过, ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

await main()
