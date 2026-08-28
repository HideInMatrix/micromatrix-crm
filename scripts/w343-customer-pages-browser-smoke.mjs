const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5174'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let tempReasonId = ''
const cleanupNormalIds = []
const cleanupPoolIds = []

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
          details?.exception?.description ??
            `${details?.text ?? 'Runtime exception'} @ ${details?.url ?? 'unknown'}:${details?.lineNumber ?? 0}`,
        )
      }
      if (message.method === 'Network.requestWillBeSent') {
        this.requests.push({ method: message.params.request.method, url: message.params.request.url })
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '浏览器表达式执行失败')
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

async function fillInput(cdp, selector, value) {
  return cdp.evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el) return false;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    setter?.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return true
  })()`)
}

async function searchCustomerTable(cdp, keyword) {
  await cdp.waitFor(
    `document.querySelector('input[placeholder="搜索名称 / 电话 / 邮箱"]')?.getBoundingClientRect().width > 0`,
    10000,
    '客户搜索输入框',
  )
  await fillInput(cdp, 'input[placeholder="搜索名称 / 电话 / 邮箱"]', keyword)
  await clickText(cdp, '搜索')
  await cdp.waitFor(
    `[...document.querySelectorAll('.el-table__body-wrapper tbody tr')].some((row)=>row.innerText.includes(${JSON.stringify(keyword)}))`,
    10000,
    `搜索 ${keyword}`,
  )
}

async function navigateAndWait(cdp, path, expression, label) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await cdp.navigate(path)
    try {
      await cdp.waitFor(expression, 10000, label)
      return
    } catch (error) {
      lastError = error
      await sleep(300)
    }
  }
  throw lastError
}

async function selectRowsContaining(cdp, names) {
  return cdp.evaluate(`(() => {
    const names=${JSON.stringify(names)};
    let count=0;
    for(const row of document.querySelectorAll('.el-table__body-wrapper tbody tr')){
      if(!names.some((name)=>row.innerText.includes(name))) continue;
      const box=row.querySelector('.el-checkbox');
      if(box && !box.querySelector('.el-checkbox__input')?.classList.contains('is-checked')){
        box.click();
      }
      count++;
    }
    return count;
  })()`)
}

async function openRowMoreAction(cdp, rowName, action) {
  const opened = await cdp.evaluate(`(() => {
    const row=[...document.querySelectorAll('.el-table__body-wrapper tbody tr')].find((x)=>x.innerText.includes(${JSON.stringify(rowName)}));
    const btn=[...(row?.querySelectorAll('button')??[])].find((x)=>x.textContent?.trim()==='更多');
    btn?.click();
    return Boolean(btn);
  })()`)
  if (!opened) return false
  await cdp.waitFor(visibleText(action), 5000, `${action} 菜单`)
  return cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.el-dropdown-menu__item')].find((x)=>x.textContent?.trim()===${JSON.stringify(action)} && x.getBoundingClientRect().width>0);
    item?.click();
    return Boolean(item);
  })()`)
}

async function seed() {
  const login = await apiRequest('POST', '/auth/login', {
    email: 'admin@demo.com',
    password: 'admin123',
  })
  if (!login.response.ok || !login.data?.accessToken) {
    throw new Error(`演示管理员登录失败: ${login.response.status}`)
  }
  token = login.data.accessToken

  const pools = await apiRequest('POST', '/account-pool/page', { current: 1, pageSize: 200 })
  const pool =
    pools.data?.list?.find((item) => item.name === '重点客户公海') ??
    pools.data?.list?.find((item) => item.hiddenFieldIds?.length > 0) ??
    pools.data?.list?.[0]
  if (!pool?.id) throw new Error('没有可用于 Browser Smoke 的客户公海')

  const reasonConfig = await apiRequest('GET', '/dict/config/CUSTOMER_POOL_RS')
  let reasonId = reasonConfig.data?.dictList?.find((item) => item.id !== 'system')?.id
  if (reasonConfig.data?.enable && !reasonId) {
    const added = await apiRequest('POST', '/dict/add', {
      module: 'CUSTOMER_POOL_RS',
      name: `Browser 临时原因 ${Date.now().toString(36)}`,
    })
    if (!added.response.ok) throw new Error(`创建临时移入原因失败: ${added.raw}`)
    tempReasonId = added.data.id
    reasonId = tempReasonId
  }

  const suffix = Date.now().toString(36)
  const names = {
    normal1: `Browser普通客户A-${suffix}`,
    normal2: `Browser普通客户B-${suffix}`,
    pool1: `Browser公海客户A-${suffix}`,
    pool2: `Browser公海客户B-${suffix}`,
  }
  const created = {}
  for (const [key, name] of Object.entries(names)) {
    const result = await apiRequest('POST', '/account/add', { name })
    if (!result.response.ok) throw new Error(`创建 ${name} 失败: ${result.raw}`)
    created[key] = result.data.id
  }
  cleanupNormalIds.push(created.normal1, created.normal2)

  for (const key of ['pool1', 'pool2']) {
    const moved = await apiRequest('POST', '/account/to-pool', {
      id: created[key],
      poolId: pool.id,
      reasonId: reasonConfig.data?.enable ? reasonId : undefined,
    })
    if (!moved.response.ok) throw new Error(`移入公海失败: ${moved.raw}`)
    cleanupPoolIds.push(created[key])
  }
  return { pool, names, created, reasonEnabled: reasonConfig.data?.enable === true }
}

async function cleanup() {
  for (const id of cleanupPoolIds) {
    await apiRequest('GET', `/pool/account/delete/${id}`).catch(() => {})
  }
  for (const id of cleanupNormalIds) {
    await apiRequest('GET', `/account/delete/${id}`).catch(() => {})
  }
  if (tempReasonId) await apiRequest('GET', `/dict/delete/${tempReasonId}`).catch(() => {})
}

async function main() {
  console.log('\nW3.4.3 task 4.6 客户域页面 Browser Smoke')
  const { pool, names, created, reasonEnabled } = await seed()
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
      return Boolean(button);
    })()`)
    await cdp.waitFor(`location.pathname === '/dashboard'`, 10000, '登录成功')

    await cdp.navigate('/customers')
    await cdp.waitFor(textIncludes('客户'), 10000, '客户页面')
    await searchCustomerTable(cdp, 'Browser普通客户')
    check('客户列表可搜索临时客户', await cdp.evaluate(textIncludes(names.normal1)))
    check(
      '客户列表可选中两条数据',
      (await selectRowsContaining(cdp, [names.normal1, names.normal2])) === 2,
    )
    await sleep(200)
    check(
      '客户批量动作包含转移/移入公海/修改/合并/删除',
      await cdp.evaluate(
        `['批量转移','批量移入公海','批量修改','合并客户','批量删除'].every((x)=>document.body.innerText.includes(x))`,
      ),
    )

    cdp.resetNetwork()
    check('客户单条更多菜单可打开移入公海', await openRowMoreAction(cdp, names.normal1, '移入公海'))
    await cdp.waitFor(
      `document.querySelector('[data-testid="customer-move-to-pool-dialog"]') !== null`,
      5000,
      '移入客户公海 Dialog',
    )
    check(
      '移入公海 Dialog 提供目标公海选择',
      await cdp.evaluate(
        `document.querySelector('[data-testid="customer-move-to-pool-dialog"]')?.innerText.includes('客户公海') === true`,
      ),
    )
    check(
      '启用原因时移入公海 Dialog 提供原因选择',
      !reasonEnabled ||
        (await cdp.evaluate(
          `document.querySelector('[data-testid="customer-move-to-pool-dialog"]')?.innerText.includes('移入原因') === true`,
        )),
    )
    await sleep(300)
    check(
      '移入公海 Dialog 各配置只请求一次',
      cdp.requestCount('/api/pool/account/options', 'GET') === 1 &&
        cdp.requestCount('/api/dict/config/CUSTOMER_POOL_RS', 'GET') === 1,
      `pool=${cdp.requestCount('/api/pool/account/options', 'GET')}, reason=${cdp.requestCount('/api/dict/config/CUSTOMER_POOL_RS', 'GET')}`,
    )
    await clickText(cdp, '取消')
    await sleep(300)

    await navigateAndWait(
      cdp,
      `/customers?id=${encodeURIComponent(created.normal1)}`,
      textIncludes('客户 360'),
      '普通客户 360',
    )
    check(
      '客户 query 深链直接打开客户 360',
      await cdp.evaluate(textIncludes(names.normal1)),
    )
    check(
      '普通客户 360 保留联系人/计划/关系等业务 Tab',
      await cdp.evaluate(
        `['联系人','跟进计划','负责人记录','客户关系'].every((x)=>document.querySelector('.customer-overview-drawer')?.innerText.includes(x))`,
      ),
    )

    await navigateAndWait(
      cdp,
      `/customers/open-sea?poolId=${encodeURIComponent(pool.id)}&id=${encodeURIComponent(created.pool1)}`,
      textIncludes('公海客户详情'),
      '公海客户详情',
    )
    check(
      '公海 query 深链直接打开独立详情',
      await cdp.evaluate(textIncludes(names.pool1)),
    )
    check(
      '公海详情只保留跟进记录与负责人记录',
      await cdp.evaluate(`(() => {
        const root=document.querySelector('.customer-overview-drawer');
        const text=root?.innerText ?? '';
        return text.includes('跟进记录') && text.includes('负责人记录') && !text.includes('联系人') && !text.includes('跟进计划') && !text.includes('客户关系');
      })()`),
    )
    check(
      '公海详情应用 Pool 隐藏字段',
      !pool.hiddenFieldIds?.length ||
        (await cdp.evaluate(
          `!document.querySelector('.customer-overview-drawer')?.innerText.includes('邮箱')`,
        )),
    )
    check(
      '公海详情提供领取/分配/删除动作',
      await cdp.evaluate(`(() => {
        const text=document.querySelector('.customer-overview-drawer')?.innerText ?? '';
        return ['领取','分配','删除'].every((x)=>text.includes(x));
      })()`),
    )
    await cdp.navigate(`/customers/open-sea?poolId=${encodeURIComponent(pool.id)}`)
    await cdp.waitFor(
      `[...document.querySelectorAll('.el-select__selected-item')].some((x)=>x.textContent?.trim()===${JSON.stringify(pool.name)} && x.getBoundingClientRect().width>0)`,
      10000,
      '客户公海选择完成',
    )
    await cdp.waitFor(
      `document.querySelector('.el-table__body-wrapper') !== null`,
      10000,
      '客户公海列表初始化',
    )
    await searchCustomerTable(cdp, 'Browser公海客户')
    check(
      '公海列表可选中两条数据',
      (await selectRowsContaining(cdp, [names.pool1, names.pool2])) === 2,
    )
    await cdp.waitFor(
      `['批量领取','批量分配','批量修改','批量删除'].every((x)=>document.body.innerText.includes(x))`,
      5000,
      '公海批量动作渲染',
    )
    check(
      '公海批量动作包含领取/分配/修改/删除',
      await cdp.evaluate(
        `['批量领取','批量分配','批量修改','批量删除'].every((x)=>document.body.innerText.includes(x))`,
      ),
    )

    await navigateAndWait(
      cdp,
      `/contacts?id=${encodeURIComponent(created.normal1)}`,
      textIncludes('客户 360'),
      '联系人页普通客户深链',
    )
    check('联系人页普通客户 query 打开客户 360', await cdp.evaluate(textIncludes(names.normal1)))

    await navigateAndWait(
      cdp,
      `/contacts?id=${encodeURIComponent(created.pool1)}&inSharedPool=true&poolId=${encodeURIComponent(pool.id)}`,
      textIncludes('公海客户详情'),
      '联系人页公海客户深链',
    )
    check('联系人页公海 query 打开公海详情', await cdp.evaluate(textIncludes(names.pool1)))
    check(
      '联系人页公海深链继续应用隐藏字段',
      !pool.hiddenFieldIds?.length ||
        (await cdp.evaluate(
          `!document.querySelector('.customer-overview-drawer')?.innerText.includes('邮箱')`,
        )),
    )

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    })
    await cdp.navigate('/customers')
    await cdp.waitFor(
      `document.querySelector('.customer-module-tabs') !== null`,
      10000,
      'Mobile 客户模块页',
    )
    check(
      'Mobile 客户域保留客户/联系人/客户公海三个真实入口',
      await cdp.evaluate(
        `['客户','联系人','客户公海'].every((x)=>[...document.querySelectorAll('.van-tab')].some((tab)=>tab.textContent?.trim()===x))`,
      ),
    )
    await cdp.evaluate(`(() => {
      const tab=[...document.querySelectorAll('.van-tab')].find((x)=>x.textContent?.trim()==='客户公海');
      tab?.click();
      return Boolean(tab);
    })()`)
    await cdp.waitFor(
      `document.querySelector('input[placeholder="搜索客户名称 / 电话 / 邮箱"]') !== null`,
      10000,
      'Mobile 客户公海 Pane',
    )
    await cdp.waitFor(
      `document.body.innerText.includes(${JSON.stringify(pool.name)})`,
      10000,
      'Mobile 客户公海 Pool options',
    )
    check(
      'Mobile 客户公海不是静态空壳并加载真实 Pool 入口',
      await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(pool.name)})`),
    )

    check(
      '客户域页面 Browser 无未捕获 Runtime 异常',
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
  await cleanup()
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed) process.exitCode = 1
