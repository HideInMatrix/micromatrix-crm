const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let createdPoolId = ''
let createdCapacityId = ''
let createdReasonId = ''

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
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
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
    await this.waitFor(`document.readyState === 'complete'`, 10000, `页面加载 ${path}`)
  }
  async waitFor(expression, timeoutMs, label) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }
  resetNetwork() {
    this.requests = []
    this.responses = []
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
const visibleText = (text) =>
  `[...document.querySelectorAll('*')].some((el) => el.textContent?.trim() === ${JSON.stringify(text)} && el.getBoundingClientRect().width > 0)`

async function clickText(cdp, text, selector = 'button') {
  return cdp.evaluate(
    `(() => { const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0); el?.click(); return Boolean(el) })()`,
  )
}

async function fillInput(cdp, selector, value) {
  const focused = await cdp.evaluate(
    `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return false; el.focus(); el.select?.(); return true })()`,
  )
  if (!focused) return false
  await cdp.send('Input.insertText', { text: value })
  await sleep(100)
  return true
}

async function chooseFirstSelectForLabel(cdp, label) {
  const dropdownId = await cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.el-form-item')].find((x)=>x.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)});
    const wrapper=item?.querySelector('.el-select__wrapper');
    const input=item?.querySelector('.el-select__input');
    wrapper?.click();
    return input?.getAttribute('aria-controls') || ''
  })()`)
  if (!dropdownId) throw new Error(`无法打开 ${label} 选择器`)
  await cdp.waitFor(
    `[...document.getElementById(${JSON.stringify(dropdownId)})?.querySelectorAll('.el-select-dropdown__item') ?? []].some((x)=>x.getBoundingClientRect().width>0 && !x.classList.contains('is-disabled'))`,
    5000,
    `${label} 选项`,
  )
  await cdp.evaluate(
    `(() => { const root=document.getElementById(${JSON.stringify(dropdownId)}); const x=[...(root?.querySelectorAll('.el-select-dropdown__item')??[])].find((e)=>e.getBoundingClientRect().width>0 && !e.classList.contains('is-disabled')); x?.click(); return Boolean(x) })()`,
  )
  await sleep(100)
  await cdp.evaluate(
    `(() => { const item=[...document.querySelectorAll('.el-form-item')].find((x)=>x.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)}); item?.querySelector('.el-select__wrapper')?.click(); return true })()`,
  )
  await sleep(150)
}

async function selectedCountForLabel(cdp, label) {
  return cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.el-form-item')].find((x)=>x.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)});
    return item?.querySelectorAll('.el-tag').length ?? 0
  })()`)
}

async function chooseFirstSelectIn(cdp, testId) {
  const dropdownId = await cdp.evaluate(`(() => {
    const root=document.querySelector('[data-testid=${JSON.stringify(testId)}]');
    const wrapper=root?.querySelector('.el-select__wrapper');
    const input=root?.querySelector('.el-select__input');
    wrapper?.click();
    return input?.getAttribute('aria-controls') || ''
  })()`)
  if (!dropdownId) throw new Error(`无法打开 ${testId} 内选择器`)
  await cdp.waitFor(
    `[...document.getElementById(${JSON.stringify(dropdownId)})?.querySelectorAll('.el-select-dropdown__item') ?? []].some((x)=>x.getBoundingClientRect().width>0 && !x.classList.contains('is-disabled'))`,
    5000,
    `${testId} 选项`,
  )
  await cdp.evaluate(
    `(() => { const root=document.getElementById(${JSON.stringify(dropdownId)}); const x=[...(root?.querySelectorAll('.el-select-dropdown__item')??[])].find((e)=>e.getBoundingClientRect().width>0 && !e.classList.contains('is-disabled')); x?.click(); return Boolean(x) })()`,
  )
  await sleep(100)
  await cdp.evaluate(
    `document.querySelector('[data-testid=${JSON.stringify(testId)}]')?.querySelector('.el-select__wrapper')?.click()`,
  )
  await sleep(150)
}

async function confirmMessageBox(cdp) {
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-message-box')].some((x)=>x.getBoundingClientRect().width>0)`,
    5000,
    '确认弹窗',
  )
  return cdp.evaluate(
    `(() => { const box=[...document.querySelectorAll('.el-message-box')].find((x)=>x.getBoundingClientRect().width>0); const btn=[...(box?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='确定') ?? box?.querySelector('.el-message-box__btns .el-button--primary'); btn?.click(); return Boolean(btn) })()`,
  )
}

async function main() {
  console.log('\nW3.4.2 线索模块设置 Browser Smoke')
  const login = await apiRequest('POST', '/auth/login', {
    email: 'admin@demo.com',
    password: 'admin123',
  })
  if (!login.response.ok || !login.data?.accessToken)
    throw new Error(`演示管理员登录失败: ${login.response.status}`)
  token = login.data.accessToken
  const suffix = Date.now().toString(36)
  const poolName = `Browser 模块池 ${suffix}`
  const reasonName = `Browser 移池原因 ${suffix}`

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
    await cdp.evaluate(`
      (() => {
        const button = [...document.querySelectorAll('button')].find((item) =>
          item.textContent?.replace(/\\s/g, '').includes('登录'),
        )
        button?.click()
        return Boolean(button)
      })()
    `)
    await cdp.waitFor(`location.pathname === '/dashboard'`, 10000, '登录成功')
    await cdp.navigate('/system/modules')
    await cdp.waitFor(textIncludes('线索池设置'), 10000, '模块设置页面')

    check(
      '线索卡片线索池/库容入口与更多菜单均可点击',
      await cdp.evaluate(`(() => {
      const buttons=[...document.querySelectorAll('button')].filter((x)=>x.getBoundingClientRect().width>0).map((x)=>x.textContent?.trim());
      return buttons.includes('线索池设置') && buttons.includes('线索库容设置') && buttons.includes('更多')
    })()`),
    )

    await clickText(cdp, '线索池设置')
    await cdp.waitFor(
      `document.querySelector('[data-testid="lead-pool-settings-drawer"]') !== null`,
      5000,
      '线索池设置 Drawer',
    )
    check('模块设置直接打开线索池全屏 Drawer', await cdp.evaluate(textIncludes('添加线索池')))
    await clickText(cdp, '添加线索池')
    await cdp.waitFor(
      `document.querySelector('[data-testid="lead-pool-config-drawer"]') !== null`,
      5000,
      '添加线索池 Drawer',
    )
    check(
      '新增线索池表单包含管理员/成员/领取/回收/列设置',
      await cdp.evaluate(
        `['线索池管理员','成员','线索领取规则','线索回收规则','列设置'].every((x)=>document.body.innerText.includes(x))`,
      ),
    )
    await fillInput(cdp, '[data-testid="lead-pool-config-drawer"] input[maxlength="255"]', poolName)
    await chooseFirstSelectForLabel(cdp, '线索池管理员')
    await chooseFirstSelectForLabel(cdp, '成员')
    check('新增线索池管理员选择已写入表单', (await selectedCountForLabel(cdp, '线索池管理员')) > 0)
    check('新增线索池成员选择已写入表单', (await selectedCountForLabel(cdp, '成员')) > 0)
    cdp.resetNetwork()
    const saveClicked = await clickText(cdp, '确定')
    check('新增线索池确定按钮可触发', saveClicked)
    const requestStartedAt = Date.now()
    while (
      Date.now() - requestStartedAt < 5000 &&
      cdp.requestCount('/api/lead-pool/add', 'POST') === 0
    )
      await sleep(100)
    check(
      '新增线索池从 Drawer 发出真实 /lead-pool/add',
      cdp.requestCount('/api/lead-pool/add', 'POST') === 1,
    )
    if (cdp.requestCount('/api/lead-pool/add', 'POST') === 0) {
      const warning = await cdp.evaluate(
        `[...document.querySelectorAll('.el-message')].filter((x)=>x.getBoundingClientRect().width>0).map((x)=>x.textContent?.trim()).filter(Boolean).join(' | ')`,
      )
      throw new Error(`线索池保存未发出请求${warning ? `：${warning}` : ''}`)
    }
    await cdp.waitFor(textIncludes(poolName), 10000, '新池出现在列表')
    const page = await apiRequest('POST', '/lead-pool/page', {
      current: 1,
      pageSize: 200,
      keyword: poolName,
    })
    createdPoolId = page.data?.list?.find((x) => x.name === poolName)?.id ?? ''
    check('可从模块设置真实创建线索池', Boolean(createdPoolId))

    const deletedClicked = await cdp.evaluate(`(() => {
      const row=[...document.querySelectorAll('tr')].find((x)=>x.innerText.includes(${JSON.stringify(poolName)}));
      const btn=[...(row?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='删除'); btn?.click(); return Boolean(btn)
    })()`)
    check('线索池列表提供删除动作', deletedClicked)
    await confirmMessageBox(cdp)
    await cdp.waitFor(
      `!document.body.innerText.includes(${JSON.stringify(poolName)})`,
      10000,
      '删除线索池',
    )
    createdPoolId = ''
    check('空线索池可从模块设置删除', true)
    await cdp.evaluate(
      `document.querySelector('[data-testid="lead-pool-settings-drawer"] .el-drawer__close-btn')?.click()`,
    )

    await clickText(cdp, '线索库容设置')
    await cdp.waitFor(
      `document.querySelector('[data-testid="lead-capacity-settings-drawer"]') !== null`,
      5000,
      '线索库容 Drawer',
    )
    check(
      '库容 Drawer 显示部门/成员范围与不限制语义',
      await cdp.evaluate(textIncludes('同一实际成员只能命中一条库容规则')),
    )
    const capacityExisting = (await apiRequest('GET', '/lead-capacity/get')).data ?? []
    await chooseFirstSelectIn(cdp, 'lead-capacity-settings-drawer')
    await clickText(cdp, '添加')
    await sleep(700)
    const capacityAfter = (await apiRequest('GET', '/lead-capacity/get')).data ?? []
    const oldIds = new Set(capacityExisting.map((x) => x.id))
    createdCapacityId = capacityAfter.find((x) => !oldIds.has(x.id))?.id ?? ''
    check('可从模块设置添加线索库容', Boolean(createdCapacityId))
    if (createdCapacityId) {
      const rowIndex = capacityAfter.findIndex((x) => x.id === createdCapacityId)
      const clicked = await cdp.evaluate(
        `(() => { const rows=[...document.querySelectorAll('[data-testid="lead-capacity-settings-drawer"] tbody tr')]; const row=rows[${rowIndex}]; const btn=[...(row?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='删除'); btn?.click(); return Boolean(btn) })()`,
      )
      if (clicked) {
        await confirmMessageBox(cdp)
        await sleep(500)
        createdCapacityId = ''
      }
    }
    check(
      '库容规则提供编辑与删除',
      await cdp.evaluate(
        `document.querySelector('[data-testid="lead-capacity-settings-drawer"]')?.innerText.includes('编辑') === true`,
      ),
    )
    await cdp.evaluate(
      `document.querySelector('[data-testid="lead-capacity-settings-drawer"] .el-drawer__close-btn')?.click()`,
    )

    const more = await cdp.evaluate(
      `(() => { const btn=[...document.querySelectorAll('button')].find((x)=>x.textContent?.trim()==='更多' && x.getBoundingClientRect().width>0); if(!btn)return false; btn.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); return true })()`,
    )
    if (!more) throw new Error('无法打开更多菜单')
    await cdp.waitFor(visibleText('移入线索池原因设置'), 5000, '移池原因菜单')
    await cdp.evaluate(
      `(() => { const x=[...document.querySelectorAll('.el-dropdown-menu__item')].find((e)=>e.textContent?.trim()==='移入线索池原因设置' && e.getBoundingClientRect().width>0); x?.click(); return Boolean(x) })()`,
    )
    await cdp.waitFor(
      `document.querySelector('[data-testid="lead-pool-reason-settings-drawer"]') !== null`,
      5000,
      '移池原因 Drawer',
    )
    check(
      '移池原因 Drawer 提供开关、添加与拖拽说明',
      await cdp.evaluate(
        `document.body.innerText.includes('最多 50 条') && document.body.innerText.includes('添加')`,
      ),
    )
    await fillInput(
      cdp,
      '[data-testid="lead-pool-reason-settings-drawer"] input[placeholder="请输入原因"]',
      reasonName,
    )
    await clickText(cdp, '添加')
    await cdp.waitFor(textIncludes(reasonName), 5000, '新增原因')
    const reasonList = await apiRequest('GET', '/dict/get/CLUE_POOL_RS')
    createdReasonId = reasonList.data?.find((x) => x.name === reasonName)?.id ?? ''
    check('可从模块设置真实新增移池原因', Boolean(createdReasonId))
    const reasonDelete = await cdp.evaluate(
      `(() => { const row=[...document.querySelectorAll('[data-testid="lead-pool-reason-settings-drawer"] .rounded')].find((x)=>x.innerText.includes(${JSON.stringify(reasonName)})); const btn=[...(row?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='删除'); btn?.click(); return Boolean(btn) })()`,
    )
    if (reasonDelete) {
      await confirmMessageBox(cdp)
      await cdp.waitFor(
        `!document.querySelector('[data-testid="lead-pool-reason-settings-drawer"]')?.innerText.includes(${JSON.stringify(reasonName)})`,
        5000,
        '删除原因',
      )
      createdReasonId = ''
    }
    check('移池原因可从 Drawer 删除', reasonDelete)

    check(
      '模块设置 Browser 无未捕获 Runtime 异常',
      cdp.exceptions.length === 0,
      cdp.exceptions.join(' | '),
    )
  } finally {
    cdp.close()
  }
}

try {
  await main()
} finally {
  if (token && createdReasonId)
    await apiRequest('GET', `/dict/delete/${createdReasonId}`).catch(() => {})
  if (token && createdCapacityId)
    await apiRequest('GET', `/lead-capacity/delete/${createdCapacityId}`).catch(() => {})
  if (token && createdPoolId)
    await apiRequest('GET', `/lead-pool/delete/${createdPoolId}`).catch(() => {})
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed) process.exitCode = 1
