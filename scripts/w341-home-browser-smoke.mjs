const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5174'
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
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

  close() {
    this.socket.close()
  }
}

function textIncludes(text) {
  return `document.body?.innerText.includes(${JSON.stringify(text)}) === true`
}

async function main() {
  console.log('\nW3.4.1 首页 Browser Smoke')
  const target = await loadPageTarget()
  const cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()

  try {
    await Promise.all([
      cdp.send('Storage.clearDataForOrigin', { origin: webBase, storageTypes: 'all' }),
      cdp.send('Network.clearBrowserCookies'),
    ])
    await cdp.navigate('/login')
    await cdp.waitFor(textIncludes('微矩阵 CRM'), 10000, '登录页渲染')
    check(
      '桌面登录页正常渲染',
      await cdp.evaluate(textIncludes('演示账号：admin@demo.com / admin123')),
    )

    await cdp.evaluate(`
      (() => {
        const button = [...document.querySelectorAll('button')].find((item) =>
          item.textContent.replace(/\\s/g, '').includes('登录'),
        )
        button?.click()
        return Boolean(button)
      })()
    `)
    await cdp.waitFor(`location.pathname === '/dashboard'`, 10000, '登录后进入首页')
    await cdp.waitFor(
      `Boolean(document.querySelector('[data-testid="home-page"]'))`,
      10000,
      '首页渲染',
    )
    await cdp.waitFor(
      `Boolean(document.querySelector('.quick-access-item[data-testid^="home-quick-"]'))`,
      10000,
      '首页异步数据与快捷入口初始化',
    )
    check('登录后进入 Cordys 普通工作台首页', true)

    const sectionTexts = ['数据概览', '快捷入口', '我的计划', '我的待办', '消息通知']
    const missingSections = []
    for (const text of sectionTexts) {
      if (!(await cdp.evaluate(textIncludes(text)))) missingSections.push(text)
    }
    check('首页五个核心区域完整渲染', missingSections.length === 0, missingSections.join('、'))

    await cdp.evaluate(`document.querySelector('[data-testid="home-overview-settings"]')?.click()`)
    await cdp.waitFor(textIncludes('统计维度'), 5000, '统计设置 Popover')
    check(
      '统计设置 Popover 可交互并包含 Cordys 维度配置',
      await cdp.evaluate(textIncludes('创建人维度仅展示统计值')),
    )
    await cdp.evaluate(`document.querySelector('[data-testid="home-overview-settings"]')?.click()`)

    await cdp.evaluate(`document.querySelector('[data-testid="home-quick-settings"]')?.click()`)
    await cdp.waitFor(textIncludes('自定义快捷入口'), 5000, '快捷入口设置对话框')
    const quickConfigText = await cdp.evaluate(`
      (() => {
        const dialog = [...document.querySelectorAll('.el-dialog')].find((item) =>
          item.innerText.includes('自定义快捷入口'),
        )
        return dialog?.innerText ?? ''
      })()
    `)
    check(
      '快捷入口设置限制 1～5 个并使用真实可选功能',
      quickConfigText.includes('至少选择 1 个，最多选择 5 个。'),
    )
    await cdp.evaluate(`
      (() => {
        const dialog = [...document.querySelectorAll('.el-dialog')].find((item) =>
          item.innerText.includes('自定义快捷入口'),
        )
        const cancel = dialog && [...dialog.querySelectorAll('button')].find((item) => item.innerText.trim() === '取消')
        cancel?.click()
      })()
    `)

    const quickEntry = await cdp.evaluate(`
      (() => {
        const item = document.querySelector('.quick-access-item[data-testid^="home-quick-"]')
        return item ? { testId: item.getAttribute('data-testid'), text: item.innerText.trim() } : null
      })()
    `)
    check('首页存在按模块开关与权限过滤后的真实快捷入口', Boolean(quickEntry?.testId))
    if (quickEntry?.testId) {
      const key = quickEntry.testId.replace('home-quick-', '')
      const routeCases = {
        customer: ['/customers', '新建客户'],
        contact: ['/contacts', '新建联系人'],
        lead: ['/leads', '新建线索'],
        opportunity: ['/opportunities', '新建商机'],
        contract: ['/contracts', '新建合同'],
        order: ['/orders', '新建订单'],
      }
      await cdp.evaluate(
        `document.querySelector(${JSON.stringify(`[data-testid="${quickEntry.testId}"]`)})?.click()`,
      )
      if (routeCases[key]) {
        const [path, title] = routeCases[key]
        await cdp.waitFor(`location.pathname === ${JSON.stringify(path)}`, 5000, '快捷入口跨页跳转')
        await cdp.waitFor(textIncludes(title), 5000, '真实新增表单')
      } else {
        const dialogTitles = {
          invoice: '新建发票',
          followRecord: '选择跟进对象',
          followPlan: '新建跟进计划',
        }
        const title = dialogTitles[key]
        if (!title) throw new Error(`未知快捷入口：${key}`)
        await cdp.waitFor(textIncludes(title), 5000, '首页真实新增对话框')
      }
      check(`快捷入口“${quickEntry.text}”打开真实新增能力`, true)
      await cdp.navigate('/dashboard')
      await cdp.waitFor(
        `Boolean(document.querySelector('[data-testid="home-page"]'))`,
        10000,
        '返回首页',
      )
    }

    const approvalExists = await cdp.evaluate(
      `Boolean(document.querySelector('[data-testid="home-approval-pending"]'))`,
    )
    check('首页审批待办入口按权限渲染', approvalExists)
    if (approvalExists) {
      await cdp.evaluate(`document.querySelector('[data-testid="home-approval-pending"]')?.click()`)
      await cdp.waitFor(`location.pathname === '/approvals'`, 5000, '审批待办跳转')
      check('审批待办点击进入真实审批页面', true)
      await cdp.navigate('/dashboard')
      await cdp.waitFor(
        `Boolean(document.querySelector('[data-testid="home-page"]'))`,
        10000,
        '返回首页',
      )
    }

    await cdp.evaluate(`
      (() => {
        const card = document.querySelector('.plan-card')
        const button = card && [...card.querySelectorAll('button')].find((item) => item.innerText.includes('查看更多'))
        button?.click()
        return Boolean(button)
      })()
    `)
    await cdp.waitFor(`location.pathname === '/follow-plans'`, 5000, '我的计划跳转')
    check('我的计划“查看更多”进入真实计划页面', true)
    await cdp.navigate('/dashboard')
    await cdp.waitFor(
      `Boolean(document.querySelector('[data-testid="home-page"]'))`,
      10000,
      '返回首页',
    )

    await cdp.evaluate(`
      (() => {
        const card = document.querySelector('.notification-card')
        const button = card && [...card.querySelectorAll('button')].find((item) => item.innerText.includes('查看更多'))
        button?.click()
        return Boolean(button)
      })()
    `)
    await cdp.waitFor(`location.pathname === '/notifications'`, 5000, '消息通知跳转')
    check('消息通知“查看更多”进入真实通知页面', true)

    check(
      '浏览器运行期间无未捕获 Runtime 异常',
      cdp.exceptions.length === 0,
      cdp.exceptions.join('; '),
    )
  } finally {
    cdp.close()
  }

  console.log(`\nW3.4.1 Browser Smoke：${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
