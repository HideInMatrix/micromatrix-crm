const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let adminToken = ''
const cleanupDashboardIds = new Set()
const cleanupModuleIds = new Set()

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
    // ignore non-json response
  }
  return { response, data, raw }
}

async function mustApi(method, path, body, token = adminToken) {
  const result = await apiRequest(method, path, body, token)
  if (!result.response.ok) {
    throw new Error(`${method} ${path} -> ${result.response.status}: ${result.raw}`)
  }
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
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push(
          message.params.args.map((item) => item.value ?? item.description ?? '').join(' '),
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

async function fillInput(cdp, selector, value) {
  return cdp.evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el) return false;
    const proto=el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    setter?.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
}

async function clickExact(cdp, text, selector = 'button') {
  return cdp.evaluate(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find((x)=>x.textContent?.replace(/\\s+/g,' ').trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0);
    el?.click();
    return Boolean(el);
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

async function clickTreeNode(cdp, name) {
  return cdp.evaluate(`(() => {
    const label=[...document.querySelectorAll('.el-tree-node__content span')].find((el)=>el.textContent?.trim()===${JSON.stringify(name)} && el.getBoundingClientRect().width>0);
    const row=label?.closest('.el-tree-node__content');
    row?.click();
    return Boolean(row);
  })()`)
}

async function dragTreeNode(cdp, sourceName, targetName) {
  return cdp.evaluate(`(() => {
    const find=(name)=>{
      const label=[...document.querySelectorAll('.el-tree-node__content span')]
        .find((el)=>el.textContent?.trim()===name && el.getBoundingClientRect().width>0);
      const node=label?.closest('.el-tree-node');
      const content=node?.querySelector(':scope > .el-tree-node__content');
      return node && content ? {node,content} : null;
    };
    const source=find(${JSON.stringify(sourceName)});
    const target=find(${JSON.stringify(targetName)});
    if(!source || !target) return false;
    const dataTransfer=new DataTransfer();
    const targetRect=target.content.getBoundingClientRect();
    const common={bubbles:true,cancelable:true,dataTransfer,clientX:targetRect.left+targetRect.width/2,clientY:targetRect.top+targetRect.height/2};
    source.node.dispatchEvent(new DragEvent('dragstart',{...common,clientX:source.content.getBoundingClientRect().left+20,clientY:source.content.getBoundingClientRect().top+10}));
    target.node.dispatchEvent(new DragEvent('dragenter',common));
    target.node.dispatchEvent(new DragEvent('dragover',common));
    target.node.dispatchEvent(new DragEvent('drop',common));
    source.node.dispatchEvent(new DragEvent('dragend',common));
    return true;
  })()`)
}

async function clickRowFavorite(cdp, name) {
  return cdp.evaluate(`(() => {
    const row=[...document.querySelectorAll('.el-table__body-wrapper tbody tr')].find((el)=>el.innerText.includes(${JSON.stringify(name)}));
    const button=row?.querySelector('button');
    button?.click();
    return Boolean(button);
  })()`)
}

async function openRowMore(cdp, name, action) {
  const opened = await cdp.evaluate(`(() => {
    const row=[...document.querySelectorAll('.el-table__body-wrapper tbody tr')].find((el)=>el.innerText.includes(${JSON.stringify(name)}));
    const button=[...(row?.querySelectorAll('button')??[])].find((el)=>el.textContent?.replace(/\\s+/g,'').includes('更多'));
    button?.click();
    return Boolean(button);
  })()`)
  if (!opened) return false
  await cdp.waitFor(visibleText(action), 5000, `${action} 菜单`)
  return cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.el-dropdown-menu__item')].find((el)=>el.textContent?.trim()===${JSON.stringify(action)} && el.getBoundingClientRect().width>0);
    item?.click();
    return Boolean(item);
  })()`)
}

async function seed() {
  const login = await apiRequest(
    'POST',
    '/auth/login',
    {
      email: 'admin@demo.com',
      password: 'admin123',
    },
    '',
  )
  if (!login.response.ok || !login.data?.accessToken) throw new Error('管理员登录失败')
  adminToken = login.data.accessToken

  const stamp = Date.now()
  const moduleName = `Browser仪表板目录-${stamp}`
  const targetModuleName = `Browser仪表板目标目录-${stamp}`
  const dashboardName = `Browser仪表板-${stamp}`
  const module = await mustApi('POST', '/dashboard/module/add', {
    name: moduleName,
    parentId: 'NONE',
  })
  cleanupModuleIds.add(module.id)
  const targetModule = await mustApi('POST', '/dashboard/module/add', {
    name: targetModuleName,
    parentId: 'NONE',
  })
  cleanupModuleIds.add(targetModule.id)
  const dashboard = await mustApi('POST', '/dashboard/add', {
    name: dashboardName,
    resourceUrl: `https://example.com/dashboard-browser-${stamp}`,
    dashboardModuleId: module.id,
    scopeIds: [],
    description: 'Dashboard Browser Smoke',
  })
  cleanupDashboardIds.add(dashboard.id)
  return { stamp, module, targetModule, dashboard, moduleName, targetModuleName, dashboardName }
}

async function cleanup() {
  for (const id of [...cleanupDashboardIds]) {
    await apiRequest('GET', `/dashboard/delete/${id}`)
  }
  for (const id of [...cleanupModuleIds]) {
    await apiRequest('POST', '/dashboard/module/delete', [id])
  }
}

console.log('\nW3.4.4 Dashboard Browser Smoke')

let cdp
try {
  const fixture = await seed()
  const target = await loadPageTarget()
  cdp = new CdpClient(target.webSocketDebuggerUrl)
  await cdp.connect()

  await loginBrowser(cdp, 'admin@demo.com', 'admin123')
  cdp.resetNetwork()
  await cdp.navigate('/reports')
  await cdp.waitFor(
    `document.querySelector('[data-testid="dashboard-page"]') !== null`,
    10000,
    '仪表板页面',
  )
  await cdp.waitFor(textIncludes(fixture.dashboardName), 10000, '仪表板列表加载')

  check('旧固定销售报表页面已移除', !(await cdp.evaluate(textIncludes('近 6 个月业绩趋势'))))
  check(
    '左侧固定“全部 / 我的收藏”入口存在',
    (await cdp.evaluate(`document.querySelector('[data-testid="dashboard-all-node"]') !== null`)) &&
      (await cdp.evaluate(
        `document.querySelector('[data-testid="dashboard-favorite-node"]') !== null`,
      )),
  )
  check(
    'Cordys 多级目录树展示真实 DashboardModule',
    await cdp.evaluate(textIncludes(fixture.moduleName)),
  )
  check('默认全部列表展示真实 Dashboard', await cdp.evaluate(textIncludes(fixture.dashboardName)))
  check(
    '首次进入 Dashboard page 请求不重复',
    cdp.requestCount('/api/dashboard/page', 'POST') === 1,
    `实际 ${cdp.requestCount('/api/dashboard/page', 'POST')} 次`,
  )
  check(
    '首次进入目录 tree/count 各请求一次',
    cdp.requestCount('/api/dashboard/module/tree', 'GET') === 1 &&
      cdp.requestCount('/api/dashboard/module/count', 'GET') === 1,
  )

  const clickedFavorite = await clickRowFavorite(cdp, fixture.dashboardName)
  check('列表星标可触发收藏', clickedFavorite)
  await cdp.waitFor(
    `fetch(${JSON.stringify(`${apiBase}/dashboard/collect/page`)},{method:'POST',headers:{Authorization:'Bearer ${adminToken}','Content-Type':'application/json'},body:JSON.stringify({current:1,pageSize:100,keyword:${JSON.stringify(fixture.dashboardName)}})}).then(r=>r.json()).then(x=>x.list?.some(i=>i.id===${JSON.stringify(fixture.dashboard.id)}))`,
    10000,
    '收藏写入',
  )

  await cdp.evaluate(`document.querySelector('[data-testid="dashboard-favorite-node"]')?.click()`)
  await cdp.waitFor(textIncludes(fixture.dashboardName), 10000, '我的收藏列表')
  check('“我的收藏”只走收藏分页契约', cdp.requestCount('/api/dashboard/collect/page', 'POST') >= 1)

  await cdp.evaluate(`document.querySelector('[data-testid="dashboard-all-node"]')?.click()`)
  await cdp.waitFor(textIncludes(fixture.dashboardName), 10000, '返回全部列表')

  const selectedModule = await clickTreeNode(cdp, fixture.moduleName)
  check('点击文件夹切换右侧资源表格', selectedModule)
  await cdp.waitFor(textIncludes(fixture.dashboardName), 10000, '目录资源列表')
  const createOpened = await clickExact(cdp, '新建仪表板')
  check('文件夹上下文可打开新建仪表板表单', createOpened)
  await cdp.waitFor(
    `document.querySelector('[data-testid="dashboard-form-dialog"]') !== null`,
    5000,
    'Dashboard 表单',
  )
  check(
    'Dashboard 表单包含名称/URL/文件夹/成员范围/描述',
    (await cdp.evaluate(textIncludes('仪表板名称'))) &&
      (await cdp.evaluate(textIncludes('仪表板 URL'))) &&
      (await cdp.evaluate(textIncludes('成员范围'))) &&
      (await cdp.evaluate(textIncludes('描述'))),
  )

  const uiName = `BrowserUI仪表板-${fixture.stamp}`
  const dialogInputs = await cdp.evaluate(`(() => {
    const dialog=document.querySelector('[data-testid="dashboard-form-dialog"]');
    const inputs=[...(dialog?.querySelectorAll('input')??[])].filter((el)=>!el.readOnly && el.getBoundingClientRect().width>0);
    return inputs.map((el)=>el.getAttribute('placeholder')||'');
  })()`)
  check(
    '新建表单已自动带入当前文件夹',
    await cdp.evaluate(`(() => {
    const dialog=document.querySelector('[data-testid="dashboard-form-dialog"]');
    return [...(dialog?.querySelectorAll('.el-select__selected-item')??[])].some((el)=>el.textContent?.includes(${JSON.stringify(fixture.moduleName)}));
  })()`),
    JSON.stringify(dialogInputs),
  )
  await fillInput(cdp, '[data-testid="dashboard-form-dialog"] input[maxlength="255"]', uiName)
  await fillInput(
    cdp,
    '[data-testid="dashboard-form-dialog"] input[placeholder="https://example.com/dashboard"]',
    `https://example.com/ui-${fixture.stamp}`,
  )
  await clickExact(cdp, '保存')
  await cdp.waitFor(
    `document.querySelector('[data-testid="dashboard-form-dialog"]') === null`,
    10000,
    '表单保存关闭',
  )
  await cdp.waitFor(textIncludes(uiName), 10000, 'UI 新建资源刷新')
  const uiCreated = await mustApi('POST', '/dashboard/page', {
    current: 1,
    pageSize: 20,
    keyword: uiName,
  })
  const uiDashboard = uiCreated.list?.[0]
  check('UI 新建真实调用 Dashboard API 并落库', Boolean(uiDashboard?.id))
  if (uiDashboard?.id) cleanupDashboardIds.add(uiDashboard.id)

  const selectedDashboard = await clickTreeNode(cdp, fixture.dashboardName)
  check('点击 Dashboard 节点进入右侧预览', selectedDashboard)
  await cdp.waitFor(
    `document.querySelector('[data-testid="dashboard-preview"]') !== null`,
    5000,
    'Dashboard Preview',
  )
  await cdp.waitFor(
    `document.querySelector('[data-testid="dashboard-iframe"]') !== null`,
    10000,
    'Dashboard iframe',
  )
  check(
    '预览只通过 embed policy 使用安全 URL',
    cdp.requestCount(`/api/dashboard/embed/policy/${fixture.dashboard.id}`, 'GET') === 1 &&
      (await cdp.evaluate(
        `document.querySelector('[data-testid="dashboard-iframe"]')?.getAttribute('src')?.startsWith('https://example.com/') === true`,
      )),
  )
  check(
    'iframe 安全属性不含通配 origin',
    await cdp.evaluate(`(() => {
    const frame=document.querySelector('[data-testid="dashboard-iframe"]');
    return !frame?.getAttribute('csp')?.includes('*') && Boolean(frame?.getAttribute('sandbox'));
  })()`),
  )
  check(
    '预览提供收藏/编辑/新窗口/全屏操作',
    (await cdp.evaluate(textIncludes('编辑'))) &&
      (await cdp.evaluate(textIncludes('新窗口'))) &&
      (await cdp.evaluate(textIncludes('全屏'))),
  )

  const previewEdit = await clickExact(cdp, '编辑')
  check('预览编辑打开真实编辑表单', previewEdit)
  await cdp.waitFor(
    `document.querySelector('[data-testid="dashboard-form-dialog"]') !== null`,
    5000,
    '编辑表单',
  )
  check(
    '编辑表单加载 Dashboard detail',
    cdp.requestCount(`/api/dashboard/detail/${fixture.dashboard.id}`, 'GET') >= 1,
  )
  await clickExact(cdp, '取消')

  cdp.resetNetwork()
  const dragToTargetStarted = await dragTreeNode(
    cdp,
    fixture.dashboardName,
    fixture.targetModuleName,
  )
  check('Dashboard 树节点可拖入另一个文件夹', dragToTargetStarted)
  await cdp.waitFor(
    `fetch(${JSON.stringify(`${apiBase}/dashboard/detail/${fixture.dashboard.id}`)},{headers:{Authorization:'Bearer ${adminToken}'}}).then(r=>r.json()).then(x=>x.dashboardModuleId===${JSON.stringify(fixture.targetModule.id)})`,
    10000,
    'Dashboard UI 拖拽到目标文件夹',
  )
  check(
    'Dashboard UI 拖拽真实调用资源移动契约',
    cdp.requestCount('/api/dashboard/edit/pos', 'POST') >= 1,
  )
  const dragBackStarted = await dragTreeNode(cdp, fixture.dashboardName, fixture.moduleName)
  check('Dashboard 可通过 UI 拖回原文件夹', dragBackStarted)
  await cdp.waitFor(
    `fetch(${JSON.stringify(`${apiBase}/dashboard/detail/${fixture.dashboard.id}`)},{headers:{Authorization:'Bearer ${adminToken}'}}).then(r=>r.json()).then(x=>x.dashboardModuleId===${JSON.stringify(fixture.module.id)})`,
    10000,
    'Dashboard UI 拖回原文件夹',
  )

  await cdp.evaluate(`document.querySelector('[data-testid="dashboard-all-node"]')?.click()`)
  await cdp.waitFor(textIncludes(uiName), 10000, '回到全部列表准备删除')
  const deleteOpened = await openRowMore(cdp, uiName, '删除')
  check('资源表格提供删除操作', deleteOpened)
  await cdp.waitFor(visibleText('删除'), 5000, '删除确认框')
  await cdp.evaluate(`(() => {
    const buttons=[...document.querySelectorAll('.el-message-box button')].filter((el)=>el.getBoundingClientRect().width>0);
    const button=buttons.find((el)=>el.textContent?.trim()==='删除');
    button?.click();
    return Boolean(button);
  })()`)
  if (uiDashboard?.id) {
    await cdp.waitFor(
      `fetch(${JSON.stringify(`${apiBase}/dashboard/detail/${uiDashboard.id}`)},{headers:{Authorization:'Bearer ${adminToken}'}}).then(r=>r.status===404)`,
      10000,
      'UI 删除落库',
    )
    cleanupDashboardIds.delete(uiDashboard.id)
  }
  check(
    'UI 删除后资源从当前列表移除',
    await cdp.evaluate(`(() => {
      const name=${JSON.stringify(uiName)};
      const tableHas=[...document.querySelectorAll('.el-table__body-wrapper tbody tr')]
        .some((row)=>row.getBoundingClientRect().width>0 && row.innerText.includes(name));
      const treeHas=[...document.querySelectorAll('.el-tree-node__content')]
        .some((node)=>node.getBoundingClientRect().width>0 && node.textContent?.includes(name));
      return !tableHas && !treeHas;
    })()`),
  )

  await loginBrowser(cdp, 'lina@demo.com', 'demo123')
  await cdp.navigate('/reports')
  await cdp.waitFor(
    `document.querySelector('[data-testid="dashboard-page"]') !== null`,
    10000,
    '只读用户仪表板页面',
  )
  await cdp.waitFor(textIncludes(fixture.dashboardName), 10000, '只读用户可见空 Scope 仪表板')
  check(
    'dashboard:read 用户不显示新建/编辑/删除管理动作',
    !(await cdp.evaluate(visibleText('新建仪表板'))) &&
      !(await cdp.evaluate(visibleText('编辑'))) &&
      !(await cdp.evaluate(visibleText('删除'))),
  )
  check(
    '只读用户仍可使用收藏入口',
    await cdp.evaluate(
      `document.querySelector('[data-testid="dashboard-favorite-node"]') !== null`,
    ),
  )

  const relevantConsoleErrors = cdp.consoleErrors.filter(
    (item) => !item.includes('Failed to load resource') && !item.includes('favicon'),
  )
  check(
    'Dashboard 页面无 Runtime exception',
    cdp.exceptions.length === 0,
    cdp.exceptions.join(' | '),
  )
  check(
    'Dashboard 页面无业务 Console error',
    relevantConsoleErrors.length === 0,
    relevantConsoleErrors.join(' | '),
  )
} catch (error) {
  failed += 1
  console.error(
    `  ✗ Browser Smoke 执行异常：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  )
} finally {
  cdp?.close()
  await cleanup().catch((error) => console.error(`  ! 清理失败：${error}`))
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exitCode = 1
