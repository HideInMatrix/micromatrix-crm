const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5174'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let createdPoolId = ''
let createdLeadId = ''

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
    return
  }
  failed += 1
  console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`)
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function apiRequest(method, path, token, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const raw = await response.text()
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    // delete 等接口允许无 JSON body。
  }
  return { response, data, raw }
}

async function loadPageTarget() {
  for (let index = 0; index < 50; index += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((response) => response.json())
      const page = targets.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // Chrome may still be booting.
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
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
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

  async navigate(path) {
    await this.send('Page.navigate', { url: `${webBase}${path}` })
    await this.waitFor(`document.readyState === 'complete'`, 10000, `页面加载 ${path}`)
  }

  async waitFor(expression, timeoutMs, label) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }

  resetRequests() {
    this.requests = []
  }

  countRequests(pathname) {
    return this.requests.filter((request) => {
      try {
        return new URL(request.url).pathname === pathname
      } catch {
        return false
      }
    }).length
  }

  close() {
    this.socket.close()
  }
}

function textIncludes(text) {
  return `document.body?.innerText.includes(${JSON.stringify(text)}) === true`
}

function clickTab(label) {
  return `
    (() => {
      const tab = [...document.querySelectorAll('.el-tabs__item')].find(
        (item) => item.textContent?.trim() === ${JSON.stringify(label)},
      )
      tab?.click()
      return Boolean(tab)
    })()
  `
}

async function waitForRequestCount(cdp, pathname, minimum = 1, timeoutMs = 5000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (cdp.countRequests(pathname) >= minimum) return
    await sleep(100)
  }
  throw new Error(`等待请求 ${pathname} 超时`)
}

async function main() {
  console.log('\nW3.4.2 线索页面 Browser Smoke')

  const login = await apiRequest('POST', '/auth/login', undefined, {
    email: 'admin@demo.com',
    password: 'admin123',
  })
  if (!login.response.ok || !login.data?.accessToken || !login.data?.user?.id) {
    throw new Error(`演示管理员登录失败: ${login.response.status}`)
  }
  const token = login.data.accessToken
  const adminId = login.data.user.id
  const suffix = Date.now().toString(36)

  const poolName = `Browser Pool ${suffix}`
  const pool = await apiRequest('POST', '/lead-pool/add', token, {
    name: poolName,
    scopeIds: ['*'],
    ownerIds: [adminId],
    enable: true,
    auto: false,
    hiddenFieldIds: [],
    pickRule: {
      limitOnNumber: false,
      pickNumber: null,
      limitPreOwner: false,
      pickIntervalDays: null,
      limitNew: false,
      newPickInterval: null,
    },
    recycleRule: { operator: 'AND', conditions: [] },
  })
  if (!pool.response.ok) {
    throw new Error(
      `创建 Browser Smoke 线索池失败: status=${pool.response.status} body=${pool.raw}`,
    )
  }
  const poolPage = await apiRequest('POST', '/lead-pool/page', token, {
    current: 1,
    pageSize: 200,
    keyword: poolName,
  })
  const createdPool = poolPage.data?.list?.find((item) => item.name === poolName)
  if (!poolPage.response.ok || !createdPool?.id) {
    throw new Error(`回查 Browser Smoke 线索池失败: ${poolPage.raw}`)
  }
  createdPoolId = createdPool.id

  const leadName = `Browser Lead ${suffix}`
  const lead = await apiRequest('POST', '/lead/add', token, { name: leadName })
  if (!lead.response.ok || !lead.data?.id) {
    throw new Error(`创建 Browser Smoke 线索失败: ${JSON.stringify(lead.data)}`)
  }
  createdLeadId = lead.data.id

  const target = await loadPageTarget()
  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()

  try {
    await Promise.all([
      cdp.send('Storage.clearDataForOrigin', { origin: webBase, storageTypes: 'all' }),
      cdp.send('Network.clearBrowserCookies'),
    ])
    await cdp.navigate('/login')
    await cdp.waitFor(textIncludes('演示账号：admin@demo.com / admin123'), 10000, '登录页渲染')
    await cdp.evaluate(`
      (() => {
        const button = [...document.querySelectorAll('button')].find((item) =>
          item.textContent?.replace(/\\s/g, '').includes('登录'),
        )
        button?.click()
        return Boolean(button)
      })()
    `)
    await cdp.waitFor(`location.pathname === '/dashboard'`, 10000, '登录后进入首页')

    await cdp.navigate('/leads')
    await cdp.waitFor(textIncludes('新建线索'), 10000, '普通线索页面渲染')
    check('普通线索与线索池为独立顶部导航', await cdp.evaluate(textIncludes('线索池')))
    check(
      '普通线索工具栏包含新建/导入/导出全部',
      await cdp.evaluate(
        `document.body.innerText.includes('新建线索') && document.body.innerText.includes('导入') && document.body.innerText.includes('导出全部')`,
      ),
    )
    check('旧“我的线索”双 Tab 已移除', !(await cdp.evaluate(textIncludes('我的线索'))))
    await cdp.waitFor(textIncludes(leadName), 10000, 'Browser Smoke 线索进入列表')
    check(
      '点击线索名称可打开 Overview Drawer',
      await cdp.evaluate(`
        (() => {
          const button = [...document.querySelectorAll('button')].find(
            (item) => item.textContent?.trim() === ${JSON.stringify(leadName)},
          )
          button?.click()
          return Boolean(button)
        })()
      `),
    )
    await cdp.waitFor(textIncludes('跟进计划'), 5000, '普通线索 Overview Drawer 渲染')
    check(
      '普通 Overview 提供编辑/转换/移池/转移/删除动作',
      await cdp.evaluate(`
        (() => {
          const text = document.body.innerText
          return ['编辑', '转换', '移入线索池', '转移', '删除'].every((item) => text.includes(item))
        })()
      `),
    )
    check(
      '普通 Overview 提供跟进记录/跟进计划/负责人历史',
      await cdp.evaluate(`
        (() => {
          const text = document.body.innerText
          return ['跟进记录', '跟进计划', '负责人历史'].every((item) => text.includes(item))
        })()
      `),
    )
    await cdp.evaluate(`
      (() => {
        const buttons = [...document.querySelectorAll('.el-drawer__close-btn')]
        const button = buttons.find((item) => item.getBoundingClientRect().width > 0)
        button?.click()
        return Boolean(button)
      })()
    `)
    await cdp.waitFor(
      `![...document.querySelectorAll('.el-overlay')].some((item) => item.getBoundingClientRect().width > 0 && getComputedStyle(item).visibility !== 'hidden')`,
      5000,
      '关闭普通线索 Overview Drawer',
    )

    cdp.resetRequests()
    check('可点击顶部“线索池”导航', await cdp.evaluate(clickTab('线索池')))
    await cdp.waitFor(`location.pathname === '/leads/pool'`, 5000, '进入线索池路由')
    await waitForRequestCount(cdp, '/api/pool/lead/page')
    await sleep(300)
    const firstPoolPageCount = cdp.countRequests('/api/pool/lead/page')
    check(
      '首次切到线索池只请求一次 /api/pool/lead/page',
      firstPoolPageCount === 1,
      `实际 ${firstPoolPageCount} 次`,
    )
    check(
      '线索池工具栏包含设置/导入/导出全部',
      await cdp.evaluate(
        `document.body.innerText.includes('设置') && document.body.innerText.includes('导入') && document.body.innerText.includes('导出全部')`,
      ),
    )

    check('可点击顶部“线索”返回', await cdp.evaluate(clickTab('线索')))
    await cdp.waitFor(`location.pathname === '/leads'`, 5000, '返回普通线索路由')
    await cdp.waitFor(textIncludes('新建线索'), 10000, '普通线索重新渲染')

    cdp.resetRequests()
    check('可再次进入线索池', await cdp.evaluate(clickTab('线索池')))
    await cdp.waitFor(`location.pathname === '/leads/pool'`, 5000, '再次进入线索池路由')
    await waitForRequestCount(cdp, '/api/pool/lead/page')
    await sleep(300)
    const secondPoolPageCount = cdp.countRequests('/api/pool/lead/page')
    check(
      '切换回来再次进入线索池仍只请求一次 /api/pool/lead/page',
      secondPoolPageCount === 1,
      `实际 ${secondPoolPageCount} 次`,
    )

    check('页面运行期间无未捕获 Runtime 异常', cdp.exceptions.length === 0, cdp.exceptions.join('；'))
  } finally {
    cdp.close()
  }
}

try {
  await main()
} catch (error) {
  failed += 1
  console.error(`  ✗ Browser Smoke 执行失败：${error instanceof Error ? error.message : String(error)}`)
} finally {
  try {
    const login = await apiRequest('POST', '/auth/login', undefined, {
      email: 'admin@demo.com',
      password: 'admin123',
    })
    const token = login.data?.accessToken
    if (token && createdLeadId) await apiRequest('GET', `/lead/delete/${createdLeadId}`, token)
    if (token && createdPoolId) await apiRequest('GET', `/lead-pool/delete/${createdPoolId}`, token)
  } catch (error) {
    console.error(`  · Browser Smoke 清理失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log(`\nW3.4.2 线索页面 Browser Smoke：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
