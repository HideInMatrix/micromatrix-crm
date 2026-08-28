const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5174'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let createdPoolId = ''
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
    // ignore non-json
  }
  return { response, data, raw }
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
    this.requests = []
    this.responses = []
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
        this.requests.push({ method: message.params.request.method, url: message.params.request.url })
      }
      if (message.method === 'Network.responseReceived') {
        this.responses.push({ status: message.params.response.status, url: message.params.response.url })
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
  return cdp.evaluate(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0);
    el?.click();
    return Boolean(el)
  })()`)
}

async function clickTextIn(cdp, rootSelector, text, selector = 'button') {
  return cdp.evaluate(`(() => {
    const root=document.querySelector(${JSON.stringify(rootSelector)});
    const el=[...(root?.querySelectorAll(${JSON.stringify(selector)}) ?? [])].find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0);
    el?.click();
    return Boolean(el)
  })()`)
}

async function fillInput(cdp, selector, value) {
  const focused = await cdp.evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el) return false;
    el.focus();
    el.select?.();
    return true
  })()`)
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
  await cdp.evaluate(`(() => {
    const root=document.getElementById(${JSON.stringify(dropdownId)});
    const item=[...(root?.querySelectorAll('.el-select-dropdown__item')??[])].find((x)=>x.getBoundingClientRect().width>0 && !x.classList.contains('is-disabled'));
    item?.click();
    return Boolean(item)
  })()`)
  await sleep(100)
  await cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.el-form-item')].find((x)=>x.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)});
    item?.querySelector('.el-select__wrapper')?.click();
    return true
  })()`)
  await sleep(150)
}

async function selectedCountForLabel(cdp, label) {
  return cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.el-form-item')].find((x)=>x.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)});
    return item?.querySelectorAll('.el-tag').length ?? 0
  })()`)
}

async function confirmMessageBox(cdp) {
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-message-box')].some((x)=>x.getBoundingClientRect().width>0)`,
    5000,
    '确认弹窗',
  )
  return cdp.evaluate(`(() => {
    const box=[...document.querySelectorAll('.el-message-box')].find((x)=>x.getBoundingClientRect().width>0);
    const btn=box?.querySelector('.el-message-box__btns .el-button--primary');
    btn?.click();
    return Boolean(btn)
  })()`)
}

async function main() {
  console.log('\nW3.4.3 客户模块设置 Browser Smoke')
  const login = await apiRequest('POST', '/auth/login', {
    email: 'admin@demo.com',
    password: 'admin123',
  })
  if (!login.response.ok || !login.data?.accessToken) {
    throw new Error(`演示管理员登录失败: ${login.response.status}`)
  }
  token = login.data.accessToken
  const suffix = Date.now().toString(36)
  const poolName = `Browser 客户公海 ${suffix}`
  const reasonName = `Browser 移入公海原因 ${suffix}`

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
    await cdp.evaluate(`(() => {
      const button=[...document.querySelectorAll('button')].find((item)=>item.textContent?.replace(/\\s/g,'').includes('登录'));
      button?.click();
      return Boolean(button)
    })()`)
    await cdp.waitFor(`location.pathname === '/dashboard'`, 10000, '登录成功')
    await cdp.navigate('/system/modules')
    await cdp.waitFor(`document.querySelector('[data-module-config-key="customer"]') !== null`, 10000, '客户模块设置卡片')

    check(
      '客户卡片公海入口和更多菜单可点击',
      await cdp.evaluate(`(() => {
        const root=document.querySelector('[data-module-config-key="customer"]');
        const buttons=[...(root?.querySelectorAll('button')??[])].filter((x)=>x.getBoundingClientRect().width>0).map((x)=>x.textContent?.trim());
        return buttons.includes('公海设置') && buttons.includes('更多');
      })()`),
    )

    await clickTextIn(cdp, '[data-module-config-key="customer"]', '公海设置')
    await cdp.waitFor(
      `document.querySelector('[data-testid="customer-pool-settings-drawer"]') !== null`,
      5000,
      '客户公海设置 Drawer',
    )
    check('模块设置直接打开客户公海全屏 Drawer', await cdp.evaluate(textIncludes('添加公海')))
    await clickTextIn(cdp, '[data-testid="customer-pool-settings-drawer"]', '添加公海')
    await cdp.waitFor(
      `document.querySelector('[data-testid="customer-pool-config-drawer"]') !== null`,
      5000,
      '添加客户公海 Drawer',
    )
    check(
      '新增客户公海表单包含管理员/成员/领取/回收/列设置',
      await cdp.evaluate(
        `['公海管理员','成员','客户领取规则','客户回收规则','列设置'].every((x)=>document.body.innerText.includes(x))`,
      ),
    )
    await fillInput(
      cdp,
      '[data-testid="customer-pool-config-drawer"] input[maxlength="255"]',
      poolName,
    )
    await chooseFirstSelectForLabel(cdp, '公海管理员')
    await chooseFirstSelectForLabel(cdp, '成员')
    check('新增客户公海管理员已写入表单', (await selectedCountForLabel(cdp, '公海管理员')) > 0)
    check('新增客户公海成员已写入表单', (await selectedCountForLabel(cdp, '成员')) > 0)
    cdp.resetNetwork()
    const saveClicked = await clickTextIn(cdp, '[data-testid="customer-pool-config-drawer"]', '确定')
    check('新增客户公海确定按钮可触发', saveClicked)
    const requestStartedAt = Date.now()
    while (
      Date.now() - requestStartedAt < 5000 &&
      cdp.requestCount('/api/account-pool/add', 'POST') === 0
    ) {
      await sleep(100)
    }
    check(
      '新增客户公海从 Drawer 发出真实 /account-pool/add',
      cdp.requestCount('/api/account-pool/add', 'POST') === 1,
    )
    await cdp.waitFor(textIncludes(poolName), 10000, '新客户公海出现在列表')
    const page = await apiRequest('POST', '/account-pool/page', {
      current: 1,
      pageSize: 200,
      keyword: poolName,
    })
    createdPoolId = page.data?.list?.find((item) => item.name === poolName)?.id ?? ''
    check('可从模块设置真实创建客户公海', Boolean(createdPoolId))

    const deletedClicked = await cdp.evaluate(`(() => {
      const row=[...document.querySelectorAll('[data-testid="customer-pool-settings-drawer"] tr')].find((x)=>x.innerText.includes(${JSON.stringify(poolName)}));
      const btn=[...(row?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='删除');
      btn?.click();
      return Boolean(btn)
    })()`)
    check('客户公海列表提供删除动作', deletedClicked)
    if (deletedClicked) {
      await confirmMessageBox(cdp)
      await cdp.waitFor(
        `!document.querySelector('[data-testid="customer-pool-settings-drawer"]')?.innerText.includes(${JSON.stringify(poolName)})`,
        10000,
        '删除客户公海',
      )
      createdPoolId = ''
    }
    check('空客户公海可从模块设置删除', deletedClicked)
    await cdp.evaluate(
      `document.querySelector('[data-testid="customer-pool-settings-drawer"] .el-drawer__close-btn')?.click()`,
    )

    const moreOpened = await cdp.evaluate(`(() => {
      const root=document.querySelector('[data-module-config-key="customer"]');
      const btn=[...(root?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='更多' && x.getBoundingClientRect().width>0);
      if(!btn) return false;
      btn.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      return true;
    })()`)
    if (!moreOpened) throw new Error('无法打开客户更多菜单')
    await cdp.waitFor(visibleText('客户库容设置'), 5000, '客户库容菜单')
    cdp.resetNetwork()
    await cdp.evaluate(`(() => {
      const item=[...document.querySelectorAll('.el-dropdown-menu__item')].find((x)=>x.textContent?.trim()==='客户库容设置' && x.getBoundingClientRect().width>0);
      item?.click();
      return Boolean(item)
    })()`)
    await cdp.waitFor(
      `document.querySelector('[data-testid="customer-capacity-settings-drawer"]') !== null`,
      5000,
      '客户库容 Drawer',
    )
    await cdp.waitFor(textIncludes('同一实际成员只能命中一条客户库容规则'), 5000, '客户库容说明')
    check(
      '客户库容 Drawer 包含库容与商机阶段排除控件',
      await cdp.evaluate(
        `(() => {
          const root=document.querySelector('[data-testid="customer-capacity-settings-drawer"]');
          return Boolean(root?.querySelector('.el-input-number')) && (root?.querySelectorAll('.el-select__wrapper').length ?? 0) >= 4;
        })()`,
      ),
    )
    const capacityStartedAt = Date.now()
    while (
      Date.now() - capacityStartedAt < 5000 &&
      cdp.requestCount('/api/account-capacity/get', 'GET') === 0
    ) {
      await sleep(100)
    }
    check(
      '客户库容 Drawer 读取真实 /account-capacity/get',
      cdp.requestCount('/api/account-capacity/get', 'GET') === 1,
    )
    check(
      '客户库容 Drawer 同时加载商机阶段选项',
      cdp.requestCount('/api/opportunities/stages', 'GET') === 1,
    )
    await cdp.evaluate(
      `document.querySelector('[data-testid="customer-capacity-settings-drawer"] .el-drawer__close-btn')?.click()`,
    )

    await cdp.evaluate(`(() => {
      const root=document.querySelector('[data-module-config-key="customer"]');
      const btn=[...(root?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='更多' && x.getBoundingClientRect().width>0);
      btn?.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
      return Boolean(btn)
    })()`)
    await cdp.waitFor(visibleText('移入公海原因设置'), 5000, '移入公海原因菜单')
    await cdp.evaluate(`(() => {
      const item=[...document.querySelectorAll('.el-dropdown-menu__item')].find((x)=>x.textContent?.trim()==='移入公海原因设置' && x.getBoundingClientRect().width>0);
      item?.click();
      return Boolean(item)
    })()`)
    await cdp.waitFor(
      `document.querySelector('[data-testid="customer-pool-reason-settings-drawer"]') !== null`,
      5000,
      '移入公海原因 Drawer',
    )
    check(
      '移入公海原因 Drawer 提供开关、添加与拖拽说明',
      await cdp.evaluate(
        `document.querySelector('[data-testid="customer-pool-reason-settings-drawer"]')?.innerText.includes('最多 50 条') === true`,
      ),
    )
    await fillInput(
      cdp,
      '[data-testid="customer-pool-reason-settings-drawer"] input[placeholder="请输入原因"]',
      reasonName,
    )
    await clickTextIn(cdp, '[data-testid="customer-pool-reason-settings-drawer"]', '添加')
    await cdp.waitFor(textIncludes(reasonName), 5000, '新增客户移池原因')
    const reasonList = await apiRequest('GET', '/dict/get/CUSTOMER_POOL_RS')
    createdReasonId = reasonList.data?.find((item) => item.name === reasonName)?.id ?? ''
    check('可从模块设置真实新增移入公海原因', Boolean(createdReasonId))
    const reasonDelete = await cdp.evaluate(`(() => {
      const root=document.querySelector('[data-testid="customer-pool-reason-settings-drawer"]');
      const row=[...root.querySelectorAll('.rounded')].find((x)=>x.innerText.includes(${JSON.stringify(reasonName)}));
      const btn=[...(row?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='删除');
      btn?.click();
      return Boolean(btn)
    })()`)
    if (reasonDelete) {
      await confirmMessageBox(cdp)
      await cdp.waitFor(
        `!document.querySelector('[data-testid="customer-pool-reason-settings-drawer"]')?.innerText.includes(${JSON.stringify(reasonName)})`,
        5000,
        '删除客户移池原因',
      )
      createdReasonId = ''
    }
    check('移入公海原因可从 Drawer 删除', reasonDelete)

    check(
      '客户模块设置 Browser 无未捕获 Runtime 异常',
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
  if (token && createdReasonId) {
    await apiRequest('GET', `/dict/delete/${createdReasonId}`).catch(() => {})
  }
  if (token && createdPoolId) {
    await apiRequest('GET', `/account-pool/delete/${createdPoolId}`).catch(() => {})
  }
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed) process.exitCode = 1
