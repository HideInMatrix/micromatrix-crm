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

async function loginApi() {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'admin123' }),
  })
  if (!response.ok) throw new Error(`API 登录失败：${response.status}`)
  return response.json()
}

async function pageTarget() {
  for (let index = 0; index < 50; index += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((response) => response.json())
      const page = targets.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // Chrome 仍在启动。
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
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable')])
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
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
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '表达式执行失败')
    return result.result?.value
  }

  async navigate(path) {
    await this.send('Page.navigate', { url: `${webBase}${path}` })
    await this.waitFor(`document.readyState === 'complete'`, 10000, `页面加载 ${path}`)
  }

  async waitFor(expression, timeoutMs, label) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }

  close() {
    this.socket.close()
  }
}

async function installSession(cdp) {
  const auth = await loginApi()
  await cdp.navigate('/login')
  await cdp.evaluate(`(() => {
    localStorage.setItem('mmx_access_token', ${JSON.stringify(auth.accessToken)});
    localStorage.setItem('mmx_refresh_token', ${JSON.stringify(auth.refreshToken ?? '')});
  })()`)
  await cdp.navigate('/dashboard')
  await cdp.waitFor(`document.querySelector('.crm-layout-header') !== null`, 10000, '登录后 Layout')
}

async function toolbarMetrics(cdp) {
  return cdp.evaluate(`(() => {
    const primary = document.querySelector('[data-testid="crm-table-primary-toolbar"]');
    const saved = document.querySelector('[data-testid="saved-view-bar"]');
    const tools = [...document.querySelectorAll('[data-testid="crm-table-utility-actions"] .el-button')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height), label: el.getAttribute('aria-label') };
      });
    const primaryRect = primary?.getBoundingClientRect();
    const savedRect = saved?.getBoundingClientRect();
    const exactButtonCount = (text) => [...document.querySelectorAll('button')]
      .filter((el) => el.getBoundingClientRect().width > 0 && el.textContent?.trim() === text).length;
    return {
      primary: primaryRect ? { top: primaryRect.top, bottom: primaryRect.bottom } : null,
      saved: savedRect ? { top: savedRect.top, bottom: savedRect.bottom } : null,
      tools,
      searchTextButtons: exactButtonCount('搜索'),
      columnTextButtons: exactButtonCount('列设置'),
      manageTextButtons: exactButtonCount('管理视图'),
      hasNewView: [...document.querySelectorAll('[data-testid="saved-view-bar"] button')]
        .some((el) => el.getBoundingClientRect().width > 0 && el.textContent?.includes('新建视图')),
    };
  })()`)
}

async function checkSavedViewPage(cdp, path, label, { modeSwitch = false } = {}) {
  await cdp.navigate(path)
  await cdp.waitFor(
    `document.querySelector('[data-testid="crm-table-primary-toolbar"]') !== null`,
    15000,
    `${label} 第一层工具区`,
  )
  await cdp.waitFor(
    `document.querySelector('[data-testid="saved-view-bar"]') !== null`,
    15000,
    `${label} 视图行`,
  )
  const metrics = await toolbarMetrics(cdp)
  check(
    `${label} 第一层操作位于视图行之前`,
    metrics.primary?.bottom <= metrics.saved?.top,
    JSON.stringify(metrics),
  )
  check(
    `${label} 表格工具使用 32px 点击区`,
    metrics.tools.length >= 3 &&
      metrics.tools.every((item) => item.width === 32 && item.height === 32),
    JSON.stringify(metrics.tools),
  )
  check(
    `${label} 不再显示独立“搜索”文字按钮`,
    metrics.searchTextButtons === 0,
    String(metrics.searchTextButtons),
  )
  check(
    `${label} 视图行不再显示“列设置”文字按钮`,
    metrics.columnTextButtons === 0,
    String(metrics.columnTextButtons),
  )
  check(
    `${label} 视图行不再常驻“管理视图”文字按钮`,
    metrics.manageTextButtons === 0,
    String(metrics.manageTextButtons),
  )
  check(`${label} 视图行提供“新建视图”`, metrics.hasNewView)

  if (modeSwitch) {
    const modeMetrics = await cdp.evaluate(`[
      ...document.querySelectorAll('.crm-display-mode-switch .el-button')
    ].filter((el)=>el.getBoundingClientRect().width>0).map((el)=>{
      const r=el.getBoundingClientRect(); return {width:Math.round(r.width),height:Math.round(r.height)};
    })`)
    check(
      `${label} 列表/看板使用 32px 图标切换`,
      modeMetrics.length === 2 &&
        modeMetrics.every((item) => item.width === 32 && item.height === 32),
      JSON.stringify(modeMetrics),
    )
  }

  const openedColumns = await cdp.evaluate(`(() => {
    const button=document.querySelector('[data-table-tool="columns"]');
    button?.click();
    return Boolean(button);
  })()`)
  if (openedColumns) {
    await cdp.waitFor(
      `[...document.querySelectorAll('.el-dialog')].some((el)=>el.getBoundingClientRect().width>0 && el.textContent?.includes('当前视图列设置'))`,
      5000,
      `${label} 列设置`,
    )
    check(`${label} 图标列设置仍可打开原列偏好功能`, true)
    await cdp.evaluate(`document.querySelector('.el-dialog__headerbtn')?.click()`)
  }
}

async function checkProductPage(cdp, path, label) {
  await cdp.navigate(path)
  await cdp.waitFor(
    `document.querySelector('.product-page-card [data-testid="crm-table-primary-toolbar"]') !== null`,
    15000,
    `${label} 第一层工具区`,
  )
  const metrics = await cdp.evaluate(`(() => {
    const card=document.querySelector('.product-page-card');
    const body=card?.querySelector('.el-card__body');
    const toolbar=body?.querySelector('[data-testid="crm-table-primary-toolbar"]');
    const bodyStyle=body ? getComputedStyle(body) : null;
    const tools=[...document.querySelectorAll('[data-testid="crm-table-utility-actions"] .el-button')]
      .filter((el)=>el.getBoundingClientRect().width>0)
      .map((el)=>{const r=el.getBoundingClientRect(); return {width:Math.round(r.width),height:Math.round(r.height)};});
    return {
      paddingTop: bodyStyle ? parseFloat(bodyStyle.paddingTop) : 0,
      bodyTop: body?.getBoundingClientRect().top ?? 0,
      toolbarTop: toolbar?.getBoundingClientRect().top ?? 0,
      tools,
      hasSavedView: Boolean(document.querySelector('[data-testid="saved-view-bar"]')),
    };
  })()`)
  check(
    `${label} Card 顶部 padding 恢复统一基线`,
    metrics.paddingTop > 0 && metrics.toolbarTop > metrics.bodyTop,
    JSON.stringify(metrics),
  )
  check(`${label} 按 Cordys 不额外增加视图行`, !metrics.hasSavedView)
  check(
    `${label} 刷新/全屏工具使用 32px 图标按钮`,
    metrics.tools.length === 2 &&
      metrics.tools.every((item) => item.width === 32 && item.height === 32),
    JSON.stringify(metrics.tools),
  )
}

console.log('\nUI-001 T12 PC 列表工具区 Browser Smoke')

let cdp
try {
  const target = await pageTarget()
  cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()
  await installSession(cdp)

  await checkProductPage(cdp, '/products', '产品')
  await checkProductPage(cdp, '/products/prices', '价格表')
  await checkSavedViewPage(cdp, '/leads', '线索')
  await checkSavedViewPage(cdp, '/leads/pool', '线索池')
  await checkSavedViewPage(cdp, '/customers', '客户')
  await checkSavedViewPage(cdp, '/contacts', '联系人')
  await checkSavedViewPage(cdp, '/customers/open-sea', '客户公海')
  await checkSavedViewPage(cdp, '/opportunities', '商机', { modeSwitch: true })
  await checkSavedViewPage(cdp, '/quotes', '报价')
  await checkSavedViewPage(cdp, '/contracts', '合同', { modeSwitch: true })
  await checkSavedViewPage(cdp, '/contract/contractInvoice', '发票')
  await checkSavedViewPage(cdp, '/order/index', '订单', { modeSwitch: true })
} catch (error) {
  check('T12 Browser Smoke 执行异常', false, String(error?.stack ?? error))
} finally {
  cdp?.close()
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exitCode = 1
