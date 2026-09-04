const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'
const topMenuOnly = process.env.UI001_TOP_MENU_ONLY === '1'
const TOP_MENU_COMPLETE = 'UI001_TOP_MENU_COMPLETE'

let passed = 0
let failed = 0
let adminToken = ''
let managerToken = ''
const cleanup = {
  leadIds: new Set(),
  poolLeadIds: new Set(),
  opportunityIds: new Set(),
  planIds: new Set(),
  customerIds: new Set(),
}

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

async function apiRequest(method, path, body, token = adminToken) {
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
    // ignore non-json
  }
  return { response, data, raw }
}

async function mustApi(method, path, body, token = adminToken) {
  const result = await apiRequest(method, path, body, token)
  if (!result.response.ok) {
    throw new Error(`${method} ${path} => ${result.response.status} ${result.raw}`)
  }
  return result.data
}

async function loginApi(email, password) {
  const result = await apiRequest('POST', '/auth/login', { email, password }, '')
  if (!result.response.ok || !result.data?.accessToken) throw new Error(`API 登录失败: ${email}`)
  return result.data
}

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
    this.consoleErrors = []
    this.failedRequests = []
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
      if (message.method === 'Network.loadingFailed') {
        this.failedRequests.push(message.params.errorText ?? 'Network loading failed')
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
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.text ?? '浏览器表达式执行失败')
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

const textIncludes = (text) => `document.body?.innerText.includes(${JSON.stringify(text)}) === true`
const visibleText = (text) =>
  `[...document.querySelectorAll('*')].some((el)=>el.textContent?.trim()===${JSON.stringify(text)} && el.getBoundingClientRect().width>0)`

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

async function loginBrowser(cdp, email, password) {
  await Promise.all([
    cdp.send('Storage.clearDataForOrigin', { origin: webBase, storageTypes: 'all' }),
    cdp.send('Network.clearBrowserCookies'),
  ])
  await cdp.navigate('/login')
  await cdp.waitFor(
    `document.querySelector('input[placeholder="请输入邮箱"]') !== null`,
    10000,
    '登录表单',
  )
  await fillInput(cdp, 'input[placeholder="请输入邮箱"]', email)
  await fillInput(cdp, 'input[placeholder="请输入密码"]', password)
  await cdp.evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find((item)=>item.textContent?.replace(/\\s/g,'').includes('登录'));
    button?.click();
    return Boolean(button);
  })()`)
  await cdp.waitFor(`location.pathname === '/dashboard'`, 10000, `登录 ${email}`)
}

async function clickTopMenu(cdp, label) {
  return cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('[data-testid="pc-top-menu"] [data-top-menu-path]')].find((el)=>el.textContent?.trim()===${JSON.stringify(label)} && el.getBoundingClientRect().width>0);
    item?.click();
    return Boolean(item);
  })()`)
}

async function clickButtonContaining(cdp, selector, text) {
  return cdp.evaluate(`(() => {
    const root=document.querySelector(${JSON.stringify(selector)});
    const button=[...(root?.querySelectorAll('button')??[])].find((el)=>el.innerText.includes(${JSON.stringify(text)}) && el.getBoundingClientRect().width>0);
    button?.click();
    return Boolean(button);
  })()`)
}

async function activeMenuText(cdp) {
  return cdp.evaluate(
    `document.querySelector('.el-menu-item.is-active')?.textContent?.trim() ?? ''`,
  )
}

async function topMenuLabels(cdp) {
  return cdp.evaluate(`[
    ...document.querySelectorAll('[data-testid="pc-top-menu"] [data-top-menu-path]')
  ].filter((el)=>el.getBoundingClientRect().width>0).map((el)=>el.textContent?.trim())`)
}

async function runTopMenuAudit(cdp, moduleConfigs) {
  const enabled = (moduleKey) =>
    moduleConfigs.some((item) => item.moduleKey === moduleKey && item.enabled)

  async function expectGroup(path, labels, sidebarLabel, moduleKey) {
    await cdp.navigate(path)
    await cdp.waitFor(
      `document.querySelector('[data-testid="pc-top-menu"]') !== null`,
      10000,
      `${sidebarLabel} Top Menu`,
    )
    if (enabled(moduleKey)) {
      await cdp.waitFor(
        `[...document.querySelectorAll('.el-menu > .el-menu-item')].some((el)=>el.textContent?.trim()===${JSON.stringify(sidebarLabel)} && el.getBoundingClientRect().width>0)`,
        10000,
        `${sidebarLabel} Sidebar 稳定态`,
      )
    } else {
      await sleep(300)
    }
    const actual = await topMenuLabels(cdp)
    check(
      `${sidebarLabel}模块 Header Top Menu 与路由声明一致`,
      JSON.stringify(actual) === JSON.stringify(labels),
      JSON.stringify(actual),
    )
    check(
      `${sidebarLabel}模块级导航不进入业务 Card`,
      await cdp.evaluate(
        `document.querySelector('.crm-layout-header [data-testid="pc-top-menu"]') !== null && document.querySelector('.crm-page-main [data-testid="pc-top-menu"]') === null`,
      ),
    )
    const sidebarVisible = await cdp.evaluate(
      `[...document.querySelectorAll('.el-menu > .el-menu-item')].some((el)=>el.textContent?.trim()===${JSON.stringify(sidebarLabel)} && el.getBoundingClientRect().width>0)`,
    )
    check(
      `${sidebarLabel} Sidebar 遵守模块配置开关`,
      enabled(moduleKey) ? sidebarVisible : !sidebarVisible,
    )
    if (enabled(moduleKey)) {
      check(
        `${sidebarLabel} 一级菜单在模块根路由保持高亮`,
        (await activeMenuText(cdp)).includes(sidebarLabel),
        await activeMenuText(cdp),
      )
    }
  }

  await expectGroup('/leads', ['线索', '线索池'], '线索', 'lead')
  await clickTopMenu(cdp, '线索池')
  await cdp.waitFor(`location.pathname === '/leads/pool'`, 10000, '线索池 Top Menu')
  check('线索池通过 Header Top Menu 切换', true)
  if (enabled('lead'))
    check('线索池切换后左侧“线索”保持高亮', (await activeMenuText(cdp)).includes('线索'))

  await expectGroup('/customers', ['客户', '联系人', '客户公海'], '客户', 'customer')
  await clickTopMenu(cdp, '联系人')
  await cdp.waitFor(`location.pathname === '/contacts'`, 10000, '联系人 Top Menu')
  check('联系人通过 Header Top Menu 切换', true)
  if (enabled('customer'))
    check('联系人切换后左侧“客户”保持高亮', (await activeMenuText(cdp)).includes('客户'))
  await clickTopMenu(cdp, '客户公海')
  await cdp.waitFor(`location.pathname === '/customers/open-sea'`, 10000, '客户公海 Top Menu')
  check('客户公海通过 Header Top Menu 切换', true)
  if (enabled('customer'))
    check('客户公海切换后左侧“客户”保持高亮', (await activeMenuText(cdp)).includes('客户'))

  await expectGroup('/opportunities', ['商机', '报价'], '商机', 'opportunity')
  await clickTopMenu(cdp, '报价')
  await cdp.waitFor(`location.pathname === '/quotes'`, 10000, '报价 Top Menu')
  check('报价通过 Header Top Menu 切换', true)
  if (enabled('opportunity'))
    check('报价切换后左侧“商机”保持高亮', (await activeMenuText(cdp)).includes('商机'))

  await expectGroup('/products', ['产品', '价格表'], '产品', 'product')
  check(
    '产品业务 Card 已移除产品/价格表模块 Tabs',
    !(await cdp.evaluate(`Boolean(document.querySelector('.product-page-card .crm-tabs'))`)),
  )
  await cdp.waitFor(`document.body.innerText.includes('新建产品')`, 10000, '产品页面')
  check(
    '产品路由不再预加载价格表列表',
    !(await cdp.evaluate(
      `performance.getEntriesByType('resource').some((entry)=>entry.name.includes('/api/price/page'))`,
    )),
  )
  await clickTopMenu(cdp, '价格表')
  await cdp.waitFor(`location.pathname === '/products/prices'`, 10000, '价格表 Top Menu')
  await cdp.waitFor(`document.body.innerText.includes('新建价格表')`, 10000, '价格表页面')
  check('价格表使用独立路由语义', true)
  if (enabled('product'))
    check('价格表切换后左侧“产品”保持高亮', (await activeMenuText(cdp)).includes('产品'))

  await expectGroup('/contracts', ['合同', '发票', '工商抬头'], '合同', 'contract')
  const contractSidebarShape = await cdp.evaluate(`(() => ({
    top:[...document.querySelectorAll('.el-menu > .el-menu-item')].some((el)=>el.textContent?.trim()==='合同' && el.getBoundingClientRect().width>0),
    sub:[...document.querySelectorAll('.el-menu > .el-sub-menu > .el-sub-menu__title')].some((el)=>el.textContent?.trim()==='合同' && el.getBoundingClientRect().width>0)
  }))()`)
  check(
    '合同 Sidebar 不再使用二级 SubMenu',
    !contractSidebarShape.sub &&
      (enabled('contract') ? contractSidebarShape.top : !contractSidebarShape.top),
    JSON.stringify(contractSidebarShape),
  )
  await clickTopMenu(cdp, '发票')
  await cdp.waitFor(`location.pathname === '/contract/contractInvoice'`, 10000, '发票 Top Menu')
  check('发票通过 Header Top Menu 切换', true)
  if (enabled('contract'))
    check('发票切换后左侧“合同”保持高亮', (await activeMenuText(cdp)).includes('合同'))
  await clickTopMenu(cdp, '工商抬头')
  await cdp.waitFor(
    `location.pathname === '/contract/contractBusinessName'`,
    10000,
    '工商抬头 Top Menu',
  )
  check('工商抬头通过 Header Top Menu 切换', true)
  if (enabled('contract'))
    check('工商抬头切换后左侧“合同”保持高亮', (await activeMenuText(cdp)).includes('合同'))
}

async function seed() {
  const [admin, manager] = await Promise.all([
    loginApi('admin@demo.com', 'admin123'),
    loginApi('zhangwei@demo.com', 'admin123'),
  ])
  adminToken = admin.accessToken
  managerToken = manager.accessToken
  const stamp = Date.now()

  const customer = await mustApi('POST', '/account/add', {
    name: `W345导航客户-${stamp}`,
    owner: manager.user.id,
  })
  cleanup.customerIds.add(customer.id)

  const lead = await mustApi('POST', '/lead/add', {
    name: `W345导航线索-${stamp}`,
    owner: manager.user.id,
  })
  cleanup.leadIds.add(lead.id)

  const poolOptions = await mustApi('GET', '/pool/lead/options')
  const pool = poolOptions[0]
  if (!pool?.id) throw new Error('没有可用于 W3.4.5 导航验收的线索池')
  const poolLead = await mustApi('POST', '/lead/add', { name: `W345导航池线索-${stamp}` })
  cleanup.poolLeadIds.add(poolLead.id)
  const reasonConfig = await mustApi('GET', '/dict/config/CLUE_POOL_RS')
  const reasonId = reasonConfig?.enable
    ? reasonConfig.dictList?.find((item) => item.id !== 'system')?.id
    : undefined
  await mustApi('POST', '/lead/to-pool', {
    id: poolLead.id,
    poolId: pool.id,
    ...(reasonId ? { reasonId } : {}),
  })

  const plan = await mustApi('POST', '/follow-up-plans', {
    targetType: 'customer',
    targetId: customer.id,
    content: `W345导航计划-${stamp}`,
    method: '电话',
    ownerId: admin.user.id,
  })
  cleanup.planIds.add(plan.id)

  const opportunity = await mustApi('POST', '/opportunity/add', {
    name: `W345导航商机-${stamp}`,
    customerId: customer.id,
    owner: manager.user.id,
  })
  cleanup.opportunityIds.add(opportunity.id)

  const managerNotifications = await mustApi(
    'GET',
    '/notifications?page=1&pageSize=20',
    undefined,
    managerToken,
  )
  const leadNotice = managerNotifications.items?.find((item) => item.content?.includes(lead.name))
  const opportunityNotice = managerNotifications.items?.find((item) =>
    item.content?.includes(opportunity.name),
  )

  return {
    admin,
    manager,
    customer,
    lead,
    pool,
    poolLead,
    plan,
    opportunity,
    leadNotice,
    opportunityNotice,
  }
}

async function cleanupFixtures() {
  for (const id of cleanup.planIds) await apiRequest('DELETE', `/follow-up-plans/${id}`)
  for (const id of cleanup.opportunityIds) await apiRequest('GET', `/opportunity/delete/${id}`)
  for (const id of cleanup.poolLeadIds) await apiRequest('GET', `/pool/lead/delete/${id}`)
  for (const id of cleanup.leadIds) await apiRequest('GET', `/lead/delete/${id}`)
  for (const id of cleanup.customerIds) await apiRequest('GET', `/account/delete/${id}`)
}

console.log('\nW3.4.5 全图导航 Browser Smoke')

let cdp
try {
  const fixture = await seed()
  check(
    '线索通知生成可消费的资源 ID 链接',
    fixture.leadNotice?.link === `/leads?id=${fixture.lead.id}`,
    fixture.leadNotice?.link,
  )
  check(
    '商机通知生成可消费的资源 ID 链接',
    fixture.opportunityNotice?.link === `/opportunities?id=${fixture.opportunity.id}`,
    fixture.opportunityNotice?.link,
  )

  const target = await loadPageTarget()
  cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()

  await loginBrowser(cdp, 'admin@demo.com', 'admin123')
  await cdp.waitFor(`document.querySelector('.el-menu') !== null`, 10000, '主菜单')
  const moduleConfigs = await mustApi('GET', '/module-configs')
  const enabledLabels = new Map([
    ['home', '首页'],
    ['lead', '线索'],
    ['customer', '客户'],
    ['opportunity', '商机'],
    ['product', '产品'],
    ['dashboard', '仪表板'],
    ['contract', '合同'],
    ['customForm', '自定义表单'],
    ['bidding', '标讯'],
    ['order', '订单'],
    ['system', '系统'],
  ])
  const expectedTopMenus = moduleConfigs
    .filter((item) => item.enabled && enabledLabels.has(item.moduleKey))
    .sort((a, b) => a.sort - b.sort)
    .map((item) => enabledLabels.get(item.moduleKey))
  const browserTopMenus =
    await cdp.evaluate(`(() => [...document.querySelectorAll('.el-menu > .el-menu-item, .el-menu > .el-sub-menu > .el-sub-menu__title')]
    .filter((el)=>el.getBoundingClientRect().width>0)
    .map((el)=>el.textContent?.trim()))()`)
  if (JSON.stringify(browserTopMenus) !== JSON.stringify(expectedTopMenus)) {
    await cdp.waitFor(
      `JSON.stringify([...document.querySelectorAll('.el-menu > .el-menu-item, .el-menu > .el-sub-menu > .el-sub-menu__title')]
      .filter((el)=>el.getBoundingClientRect().width>0)
      .map((el)=>el.textContent?.trim())) === ${JSON.stringify(JSON.stringify(expectedTopMenus))}`,
      10000,
      '模块配置异步加载',
    )
  }
  const settledTopMenus =
    await cdp.evaluate(`(() => [...document.querySelectorAll('.el-menu > .el-menu-item, .el-menu > .el-sub-menu > .el-sub-menu__title')]
    .filter((el)=>el.getBoundingClientRect().width>0)
    .map((el)=>el.textContent?.trim()))()`)
  check(
    '左侧主菜单严格跟随模块配置开关与排序',
    JSON.stringify(settledTopMenus) === JSON.stringify(expectedTopMenus),
    `${JSON.stringify(settledTopMenus)} != ${JSON.stringify(expectedTopMenus)}`,
  )

  if (topMenuOnly) {
    await runTopMenuAudit(cdp, moduleConfigs)
    throw new Error(TOP_MENU_COMPLETE)
  }

  await cdp.navigate(`/leads?id=${fixture.lead.id}`)
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-drawer')].some((el)=>el.innerText.includes(${JSON.stringify(fixture.lead.name)}) && el.getBoundingClientRect().width>0)`,
    10000,
    '普通线索深链 Drawer',
  )
  check('普通线索 ?id 深链直接打开目标 Overview', true)
  check('普通线索深链保持左侧“线索”高亮', (await activeMenuText(cdp)).includes('线索'))
  await cdp.navigate(`/leads?id=${fixture.lead.id}`)
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-drawer')].some((el)=>el.innerText.includes(${JSON.stringify(fixture.lead.name)}) && el.getBoundingClientRect().width>0)`,
    10000,
    '普通线索刷新深链',
  )
  check('普通线索刷新后仍可按资源 ID 恢复 Overview', true)

  await cdp.navigate(`/leads/pool?id=${fixture.poolLead.id}&poolId=${fixture.pool.id}`)
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-drawer')].some((el)=>el.innerText.includes(${JSON.stringify(fixture.poolLead.name)}) && el.getBoundingClientRect().width>0)`,
    10000,
    '线索池深链 Drawer',
  )
  check('线索池 ?id&poolId 深链直接打开目标 Overview', true)
  check('线索池子页继续高亮左侧“线索”', (await activeMenuText(cdp)).includes('线索'))
  check(
    '线索模块使用 Header Top Menu 而不是 Card 内 Tabs',
    await cdp.evaluate(
      `document.querySelector('.crm-layout-header [data-testid="pc-top-menu"]') !== null && document.querySelector('.crm-page-main > .el-card [data-testid="pc-top-menu"]') === null`,
    ),
  )

  await cdp.navigate('/customers')
  await cdp.waitFor(visibleText('客户公海'), 10000, '客户模块导航')
  check(
    '管理员客户模块 Header 展示客户/联系人/客户公海顶部菜单',
    (await cdp.evaluate(visibleText('客户'))) &&
      (await cdp.evaluate(visibleText('联系人'))) &&
      (await cdp.evaluate(visibleText('客户公海'))) &&
      (await cdp.evaluate(
        `document.querySelector('.crm-layout-header [data-testid="pc-top-menu"]') !== null`,
      )),
  )
  check(
    '客户业务卡片内部不再保留客户模块 Tabs',
    await cdp.evaluate(
      `document.querySelector('.crm-page-main > .el-card [data-testid="pc-top-menu"]') === null`,
    ),
  )
  await clickTopMenu(cdp, '联系人')
  await cdp.waitFor(`location.pathname === '/contacts'`, 10000, '联系人顶部菜单导航')
  check('联系人作为客户子页保持左侧“客户”高亮', (await activeMenuText(cdp)).includes('客户'))
  await clickTopMenu(cdp, '客户公海')
  await cdp.waitFor(`location.pathname === '/customers/open-sea'`, 10000, '客户公海顶部菜单导航')
  check('客户公海作为客户子页保持左侧“客户”高亮', (await activeMenuText(cdp)).includes('客户'))

  await cdp.navigate('/opportunities')
  await cdp.waitFor(
    `[...document.querySelectorAll('[data-testid="pc-top-menu"] [data-top-menu-path]')].some((el)=>el.textContent?.trim()==='报价')`,
    10000,
    '商机模块顶部菜单',
  )
  check(
    '商机/报价使用通用 Header Top Menu',
    await cdp.evaluate(
      `['商机','报价'].every((label)=>[...document.querySelectorAll('[data-testid="pc-top-menu"] [data-top-menu-path]')].some((el)=>el.textContent?.trim()===label))`,
    ),
  )
  await clickTopMenu(cdp, '报价')
  await cdp.waitFor(`location.pathname === '/quotes'`, 10000, '报价顶部菜单导航')
  const opportunityModuleEnabled = moduleConfigs.some(
    (item) => item.moduleKey === 'opportunity' && item.enabled,
  )
  check(
    '报价子页遵守商机模块 Sidebar 启用状态',
    opportunityModuleEnabled
      ? (await activeMenuText(cdp)).includes('商机')
      : !(await cdp.evaluate(
          `[...document.querySelectorAll('.el-menu > .el-menu-item')].some((el)=>el.textContent?.trim()==='商机' && el.getBoundingClientRect().width>0)`,
        )),
  )

  await cdp.navigate('/products')
  await cdp.waitFor(
    `[...document.querySelectorAll('[data-testid="pc-top-menu"] [data-top-menu-path]')].some((el)=>el.textContent?.trim()==='价格表')`,
    10000,
    '产品模块顶部菜单',
  )
  check(
    '产品/价格表使用通用 Header Top Menu 且移除页面模块 Tabs',
    await cdp.evaluate(
      `['产品','价格表'].every((label)=>[...document.querySelectorAll('[data-testid="pc-top-menu"] [data-top-menu-path]')].some((el)=>el.textContent?.trim()===label)) && document.querySelector('.product-page-card > .el-card__body > .crm-tabs') === null`,
    ),
  )
  await clickTopMenu(cdp, '价格表')
  await cdp.waitFor(`location.pathname === '/products/prices'`, 10000, '价格表顶部菜单导航')
  const productModuleEnabled = moduleConfigs.some(
    (item) => item.moduleKey === 'product' && item.enabled,
  )
  check(
    '价格表子页遵守产品模块 Sidebar 启用状态',
    productModuleEnabled
      ? (await activeMenuText(cdp)).includes('产品')
      : !(await cdp.evaluate(
          `[...document.querySelectorAll('.el-menu > .el-menu-item')].some((el)=>el.textContent?.trim()==='产品' && el.getBoundingClientRect().width>0)`,
        )),
  )

  await cdp.navigate('/contracts')
  await cdp.waitFor(
    `[...document.querySelectorAll('[data-testid="pc-top-menu"] [data-top-menu-path]')].some((el)=>el.textContent?.trim()==='发票')`,
    10000,
    '合同模块顶部菜单',
  )
  check(
    '合同/发票/工商抬头使用通用 Header Top Menu',
    await cdp.evaluate(
      `['合同','发票','工商抬头'].every((label)=>[...document.querySelectorAll('[data-testid="pc-top-menu"] [data-top-menu-path]')].some((el)=>el.textContent?.trim()===label))`,
    ),
  )
  const contractModuleEnabled = moduleConfigs.some(
    (item) => item.moduleKey === 'contract' && item.enabled,
  )
  const contractSidebarShape = await cdp.evaluate(`(() => ({
    top:[...document.querySelectorAll('.el-menu > .el-menu-item')].some((el)=>el.textContent?.trim()==='合同' && el.getBoundingClientRect().width>0),
    sub:[...document.querySelectorAll('.el-menu > .el-sub-menu > .el-sub-menu__title')].some((el)=>el.textContent?.trim()==='合同' && el.getBoundingClientRect().width>0)
  }))()`)
  check(
    '合同 Sidebar 按模块配置保持单一级入口',
    contractModuleEnabled
      ? contractSidebarShape.top && !contractSidebarShape.sub
      : !contractSidebarShape.top && !contractSidebarShape.sub,
    JSON.stringify(contractSidebarShape),
  )
  await clickTopMenu(cdp, '发票')
  await cdp.waitFor(`location.pathname === '/contract/contractInvoice'`, 10000, '发票顶部菜单导航')
  check(
    '发票子页遵守合同模块 Sidebar 启用状态',
    contractModuleEnabled
      ? (await activeMenuText(cdp)).includes('合同')
      : !(await cdp.evaluate(
          `[...document.querySelectorAll('.el-menu > .el-menu-item')].some((el)=>el.textContent?.trim()==='合同' && el.getBoundingClientRect().width>0)`,
        )),
  )
  await clickTopMenu(cdp, '工商抬头')
  await cdp.waitFor(
    `location.pathname === '/contract/contractBusinessName'`,
    10000,
    '工商抬头顶部菜单导航',
  )
  check(
    '工商抬头子页遵守合同模块 Sidebar 启用状态',
    contractModuleEnabled
      ? (await activeMenuText(cdp)).includes('合同')
      : !(await cdp.evaluate(
          `[...document.querySelectorAll('.el-menu > .el-menu-item')].some((el)=>el.textContent?.trim()==='合同' && el.getBoundingClientRect().width>0)`,
        )),
  )

  const topActionMetrics = await cdp.evaluate(`(() => {
    const buttons=[...document.querySelectorAll('[data-testid="top-navigation-actions"] button')]
      .filter((el)=>el.getBoundingClientRect().width>0)
      .map((el)=>{ const r=el.getBoundingClientRect(); return {x:r.x,width:r.width,height:r.height}; });
    return {buttons,gap:buttons.length>1 ? Math.round(buttons[1].x-(buttons[0].x+buttons[0].width)) : null};
  })()`)
  check(
    'PC Header 右侧动作按 Cordys 使用 32px 点击区',
    topActionMetrics.buttons.length > 0 &&
      topActionMetrics.buttons.every((item) => item.width === 32 && item.height === 32),
    JSON.stringify(topActionMetrics),
  )
  check(
    'PC Header 右侧动作间距为 8px',
    topActionMetrics.gap === null || topActionMetrics.gap === 8,
    JSON.stringify(topActionMetrics),
  )

  await cdp.navigate(`/customers/${fixture.customer.id}`)
  await cdp.waitFor(textIncludes(fixture.customer.name), 10000, '客户 360 深链')
  check('客户资源 ID 路由直接打开 Customer 360', true)
  check('Customer 360 详情页保持左侧“客户”高亮', (await activeMenuText(cdp)).includes('客户'))
  await cdp.evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find((el)=>el.textContent?.trim()==='←' && el.getBoundingClientRect().width>0);
    button?.click();
    return Boolean(button);
  })()`)
  await cdp.waitFor(`location.pathname === '/customers'`, 5000, '客户 360 返回')
  check('Customer 360 返回路径回到客户列表', true)

  if (topMenuOnly) throw new Error(TOP_MENU_COMPLETE)

  await cdp.navigate(`/follow-plans?id=${fixture.plan.id}&mine=1`)
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-dialog')].some((el)=>el.getBoundingClientRect().width>0 && el.querySelector('textarea')?.value === ${JSON.stringify(fixture.plan.content)})`,
    10000,
    '计划深链 Dialog',
  )
  check('跟进计划 ?id 深链加载目标计划', true)
  await cdp.navigate(`/follow-plans?id=${fixture.plan.id}&mine=1`)
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-dialog')].some((el)=>el.getBoundingClientRect().width>0 && el.querySelector('textarea')?.value === ${JSON.stringify(fixture.plan.content)})`,
    10000,
    '计划刷新深链',
  )
  check('跟进计划刷新保持目标资源 Dialog', true)

  await cdp.navigate('/dashboard')
  await cdp.waitFor(textIncludes(fixture.plan.content), 10000, '首页我的计划夹具')
  const clickedPlan = await clickButtonContaining(cdp, '.plan-card', fixture.plan.content)
  check('首页单条计划可点击', clickedPlan)
  await cdp.waitFor(
    `location.pathname === '/follow-plans' && new URLSearchParams(location.search).get('id') === ${JSON.stringify(fixture.plan.id)}`,
    5000,
    '首页计划资源 ID 跳转',
  )
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-dialog')].some((el)=>el.getBoundingClientRect().width>0 && el.querySelector('textarea')?.value === ${JSON.stringify(fixture.plan.content)})`,
    10000,
    '首页计划目标 Dialog',
  )
  check('首页计划携带资源 ID 并打开同一目标计划', true)

  await cdp.navigate('/dashboard')
  await cdp.waitFor(
    `document.querySelector('.overview-table .overview-row:nth-child(2) .metric-value.is-clickable') !== null`,
    10000,
    '首页线索统计',
  )
  await cdp.evaluate(
    `document.querySelector('.overview-table .overview-row:nth-child(2) .metric-value.is-clickable')?.click()`,
  )
  await cdp.waitFor(`location.pathname === '/leads'`, 5000, '首页统计跳转线索')
  await cdp.waitFor(textIncludes('来自首页：'), 10000, '首页统计筛选消费')
  check('首页统计跨页筛选被线索页真实消费', true)
  check(
    'homeFilter token 消费后从 URL 移除',
    !String(await cdp.evaluate('location.search')).includes('homeFilter'),
  )

  await cdp.navigate('/dashboard')
  await cdp.waitFor(
    `document.querySelector('[data-testid="home-approval-pending"]') !== null`,
    10000,
    '首页审批入口',
  )
  await cdp.evaluate(`document.querySelector('[data-testid="home-approval-pending"]')?.click()`)
  await cdp.waitFor(
    `location.pathname === '/approvals' && new URLSearchParams(location.search).get('tab') === 'pending'`,
    5000,
    '审批 tab 跳转',
  )
  check(
    '首页审批入口携带并消费 pending tab',
    await cdp.evaluate(
      `document.querySelector('.el-tabs__item.is-active')?.textContent?.includes('待我审批') === true`,
    ),
  )

  await loginBrowser(cdp, 'zhangwei@demo.com', 'admin123')
  await cdp.navigate('/dashboard')
  await cdp.waitFor(textIncludes(fixture.lead.name), 10000, '主管线索通知')
  const clickedLeadNotice = await clickButtonContaining(
    cdp,
    '.notification-card',
    fixture.lead.name,
  )
  check('首页通知可点击目标线索', clickedLeadNotice)
  await cdp.waitFor(`location.pathname === '/leads'`, 5000, '通知跳转线索')
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-drawer')].some((el)=>el.innerText.includes(${JSON.stringify(fixture.lead.name)}) && el.getBoundingClientRect().width>0)`,
    10000,
    '通知目标线索 Overview',
  )
  check('线索通知携带资源 ID 并打开目标 Overview', true)

  await cdp.navigate('/dashboard')
  await cdp.waitFor(textIncludes(fixture.opportunity.name), 10000, '主管商机通知')
  const clickedOpportunityNotice = await clickButtonContaining(
    cdp,
    '.notification-card',
    fixture.opportunity.name,
  )
  check('首页通知可点击目标商机', clickedOpportunityNotice)
  await cdp.waitFor(
    `location.pathname === '/opportunities' && new URLSearchParams(location.search).get('id') === ${JSON.stringify(fixture.opportunity.id)}`,
    5000,
    '通知跳转商机',
  )
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-drawer')].some((el)=>el.innerText.includes(${JSON.stringify(fixture.opportunity.name)}) && el.getBoundingClientRect().width>0)`,
    10000,
    '通知目标商机 Drawer',
  )
  check('商机通知不再跳不存在的 /opportunities/:id', true)

  await loginBrowser(cdp, 'lina@demo.com', 'demo123')
  await cdp.navigate('/customers')
  await cdp.waitFor(visibleText('联系人'), 10000, '销售专员客户页')
  check(
    '无 customerPool:read 用户不展示客户公海页签',
    !(await cdp.evaluate(visibleText('客户公海'))),
  )
  await cdp.navigate('/customers/open-sea')
  await cdp.waitFor(`location.pathname === '/dashboard'`, 5000, '客户公海权限路由拒绝')
  check('无 customerPool:read 用户手工直达公海被路由拒绝', true)

  const relevantConsoleErrors = cdp.consoleErrors.filter(
    (item) => !item.includes('Failed to load resource') && !item.includes('favicon'),
  )
  check(
    '全图导航 Browser 无 Runtime exception',
    cdp.exceptions.length === 0,
    cdp.exceptions.join(' | '),
  )
  check(
    '全图导航 Browser 无业务 Console error',
    relevantConsoleErrors.length === 0,
    relevantConsoleErrors.join(' | '),
  )
} catch (error) {
  if (!(topMenuOnly && error instanceof Error && error.message === TOP_MENU_COMPLETE)) {
    check('全图导航 Browser 执行异常', false, String(error?.stack ?? error))
  }
} finally {
  cdp?.close()
  await cleanupFixtures().catch((error) => console.error('cleanup:', error))
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exitCode = 1
