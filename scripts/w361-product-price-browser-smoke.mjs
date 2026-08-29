const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let productId = ''
let priceId = ''

function check(name, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); return }
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
  try { data = raw ? JSON.parse(raw) : null } catch { /* ignore */ }
  return { response, data, raw }
}

async function loadPageTarget() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((r) => r.json())
      const page = targets.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* Chrome may be starting */ }
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
      if (msg.method === 'Runtime.exceptionThrown') this.exceptions.push(msg.params.exceptionDetails?.text ?? 'Runtime exception')
      if (msg.method === 'Network.requestWillBeSent') this.requests.push({ method: msg.params.request.method, url: msg.params.request.url })
      if (msg.method === 'Network.responseReceived') this.responses.push({ status: msg.params.response.status, url: msg.params.response.url })
    })
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable')])
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
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
      try { return new URL(item.url).pathname === pathname && (!method || item.method === method) } catch { return false }
    }).length
  }
  close() { this.socket.close() }
}

const textIncludes = (text) => `document.body?.innerText.includes(${JSON.stringify(text)}) === true`

async function clickText(cdp, text, selector = 'button') {
  return cdp.evaluate(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0)
    el?.click(); return Boolean(el)
  })()`)
}

async function main() {
  console.log('\nW3.6.1 产品/价格表 Browser Smoke')
  const login = await apiRequest('POST', '/auth/login', { email: 'admin@demo.com', password: 'admin123' })
  if (!login.response.ok || !login.data?.accessToken) throw new Error(`演示管理员登录失败: ${login.response.status}`)
  token = login.data.accessToken

  const suffix = Date.now().toString(36)
  const productName = `W361 Browser Product ${suffix}`
  const priceName = `W361 Browser Price ${suffix}`
  const createdProduct = await apiRequest('POST', '/product/add', {
    name: productName,
    price: 321.45,
    status: '1',
  })
  if (!createdProduct.response.ok || !createdProduct.data?.id) {
    throw new Error(`创建 Browser Smoke 产品失败: ${createdProduct.response.status} ${createdProduct.raw}`)
  }
  productId = createdProduct.data.id
  const createdPrice = await apiRequest('POST', '/price/add', {
    name: priceName,
    status: '1',
    products: [{
      product: productId,
      amount: 399.99,
      values: { priceProductSku: 'BROWSER-SKU', priceProductTax: 6.5 },
    }],
  })
  if (!createdPrice.response.ok || !createdPrice.data?.id) {
    throw new Error(`创建 Browser Smoke 价格表失败: ${createdPrice.response.status} ${createdPrice.raw}`)
  }
  priceId = createdPrice.data.id

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
    await cdp.evaluate(`(() => { const button=[...document.querySelectorAll('button')].find((item)=>item.textContent?.replace(/\\s/g,'').includes('登录')); button?.click(); return Boolean(button) })()`)
    await cdp.waitFor(`location.pathname === '/dashboard'`, 10000, '登录成功')

    await cdp.navigate('/products')
    await cdp.waitFor(textIncludes('新建产品'), 10000, '产品页面')
    await cdp.waitFor(textIncludes(productName), 10000, '产品列表')
    check('产品列表使用 Cordys POST /product/page', cdp.requestCount('/api/product/page', 'POST') >= 1)
    check('产品/价格表双页签存在', await cdp.evaluate(`['产品','价格表'].every((x)=>[...document.querySelectorAll('.el-tabs__item')].some((el)=>el.textContent?.trim()===x))`))

    await clickText(cdp, '新建产品')
    await cdp.waitFor(textIncludes('产品名称'), 5000, '新建产品弹窗')
    const productDialogText = await cdp.evaluate(`document.body.innerText`)
    check('产品表单使用 Cordys 字段', ['产品名称','产品价格','状态','描述','产品图片'].every((item) => productDialogText.includes(item)))
    check('产品图片使用真实上传控件', productDialogText.includes('上传图片') && productDialogText.includes('最多 10 张'))
    check('产品表单已移除旧字段', ['产品编码','产品分类','单位','成本价'].every((item) => !productDialogText.includes(item)))
    await clickText(cdp, '取消')

    const priceTabClicked = await clickText(cdp, '价格表', '.el-tabs__item')
    check('可切换价格表页签', priceTabClicked)
    await cdp.waitFor(textIncludes(priceName), 10000, '价格表列表')
    check('价格表列表使用 Cordys POST /price/page', cdp.requestCount('/api/price/page', 'POST') >= 1)
    check('价格表复制动作可见', await cdp.evaluate(`document.body.innerText.includes('复制')`))

    await clickText(cdp, '导出全部')
    await cdp.waitFor(textIncludes('选择字段'), 5000, '价格表导出 Drawer')
    check('价格表导出可选择 SUB_PRODUCT 子字段', await cdp.evaluate(`['产品','产品SKU','产品定价','税点'].every((x)=>document.body.innerText.includes(x))`))
    await clickText(cdp, '取消')

    await clickText(cdp, '新建价格表')
    await cdp.waitFor(textIncludes('产品信息'), 5000, '新建价格表弹窗')
    const priceDialogText = await cdp.evaluate(`document.body.innerText`)
    check('价格表表单包含 Cordys 主字段与子表', ['价格表名称','状态','产品信息','产品定价','产品SKU','税点'].every((item) => priceDialogText.includes(item)))
    await clickText(cdp, '取消')

    const openedDetail = await cdp.evaluate(`(() => {
      const button=[...document.querySelectorAll('button')].find((el)=>el.textContent?.trim()===${JSON.stringify(priceName)} && el.getBoundingClientRect().width>0)
      button?.click(); return Boolean(button)
    })()`)
    check('价格表名称可打开详情', openedDetail)
    await cdp.waitFor(textIncludes('BROWSER-SKU'), 5000, '价格表详情')
    check('价格表详情展示 SUB_PRODUCT 扩展字段', await cdp.evaluate(`document.body.innerText.includes('BROWSER-SKU') && document.body.innerText.includes('6.5')`))

    await cdp.navigate('/system/modules')
    await cdp.waitFor(`document.querySelector('[data-module-config-key="product"]') !== null`, 10000, '模块设置产品卡片')
    const productSettingClicked = await cdp.evaluate(`(() => {
      const row=document.querySelector('[data-module-config-key="product"]')
      const button=[...(row?.querySelectorAll('button')??[])].find((el)=>el.textContent?.trim()==='产品表单设置')
      button?.click(); return Boolean(button)
    })()`)
    check('/system/modules 产品表单设置入口为 REAL', productSettingClicked)
    await cdp.waitFor(`location.pathname === '/system/modules/fields' && new URLSearchParams(location.search).get('module') === 'product'`, 5000, '产品表单设置导航')
    await cdp.waitFor(textIncludes('产品名称'), 5000, '产品表单设置页面')
    const productSettingsText = await cdp.evaluate(`document.body.innerText`)
    check('产品表单设置包含 productPic 图片字段', productSettingsText.includes('产品图片'))
    check('产品表单设置已清除旧字段', ['产品编码','产品分类','单位','成本价'].every((item) => !productSettingsText.includes(item)))

    await cdp.navigate('/system/modules')
    await cdp.waitFor(`document.querySelector('[data-module-config-key="product"]') !== null`, 10000, '模块设置产品卡片重载')
    const priceSettingClicked = await cdp.evaluate(`(() => {
      const row=document.querySelector('[data-module-config-key="product"]')
      const button=[...(row?.querySelectorAll('button')??[])].find((el)=>el.textContent?.trim()==='价格表表单设置')
      button?.click(); return Boolean(button)
    })()`)
    check('/system/modules 价格表表单设置入口为 REAL', priceSettingClicked)
    await cdp.waitFor(`location.pathname === '/system/modules/fields' && new URLSearchParams(location.search).get('module') === 'price'`, 5000, '价格表表单设置导航')
    await cdp.waitFor(textIncludes('价格表名称'), 5000, '价格表表单设置页面')
    check('价格表表单设置真实加载 module=price', await cdp.evaluate(`document.body.innerText.includes('价格表名称') && document.body.innerText.includes('备注')`))

    const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
    check('产品/价格表 Browser Smoke 无 API 5xx', api5xx.length === 0, api5xx.map((item) => `${item.status} ${item.url}`).join(', '))
    check('产品/价格表 Browser Smoke 无 Runtime exception', cdp.exceptions.length === 0, cdp.exceptions.join(', '))
  } finally {
    cdp.close()
  }

  console.log(`\n结果：${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

try {
  await main()
} finally {
  if (priceId) await apiRequest('GET', `/price/delete/${priceId}`)
  if (productId) await apiRequest('GET', `/product/delete/${productId}`)
}
