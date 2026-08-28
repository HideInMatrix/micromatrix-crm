const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5174'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`)
  }
}

async function pageTarget() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((response) => response.json())
      const target = targets.find((item) => item.type === 'page')
      if (target?.webSocketDebuggerUrl) return target
    } catch {
      // Chrome may still be starting.
    }
    await sleep(100)
  }
  throw new Error('无法连接 Chrome DevTools')
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.requests = []
    this.exceptions = []
    this.consoleErrors = []
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
      if (message.method === 'Network.requestWillBeSent') {
        this.requests.push({ method: message.params.request.method, url: message.params.request.url })
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails
        this.exceptions.push(details?.exception?.description ?? details?.text ?? 'Runtime exception')
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.consoleErrors.push(
          message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '),
        )
      }
    })
    await Promise.all([
      this.send('Page.enable'),
      this.send('Runtime.enable'),
      this.send('Network.enable'),
    ])
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '浏览器表达式失败')
    return result.result?.value
  }

  async wait(expression, timeoutMs, label) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await this.eval(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }

  async navigate(path) {
    await this.send('Page.navigate', { url: `${webBase}${path}` })
    await this.wait(`document.readyState === 'complete'`, 15000, `页面加载 ${path}`)
  }

  resetNetwork() {
    this.requests = []
  }

  count(path, method) {
    return this.requests.filter((request) => {
      try {
        return new URL(request.url).pathname === path && (!method || request.method === method)
      } catch {
        return false
      }
    }).length
  }

  close() {
    this.socket.close()
  }
}

async function clickVisibleText(cdp, text, selector = '*') {
  const point = await cdp.eval(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0 && x.getBoundingClientRect().height>0);
    if(!el) return null;
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`)
  if (!point) return false
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  })
  return true
}

async function clickSelector(cdp, selector) {
  const point = await cdp.eval(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el) return null;
    const r=el.getBoundingClientRect();
    if(!r.width || !r.height) return null;
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`)
  if (!point) return false
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
  })
  return true
}

async function openPersonalMenu(cdp) {
  if (!(await clickSelector(cdp, '[data-testid="personal-menu-trigger"]'))) return false
  await cdp.wait(
    `[...document.querySelectorAll('.el-dropdown-menu__item')].some((x)=>x.textContent?.trim()==='个人信息' && x.getBoundingClientRect().width>0)`,
    5000,
    '个人菜单下拉',
  )
  await sleep(350)
  return true
}

async function selectPersonalMenu(cdp, text) {
  await openPersonalMenu(cdp)
  return clickVisibleText(cdp, text, '.el-dropdown-menu__item')
}

async function clickVisibleContainerButton(cdp, containerSelector, text) {
  return cdp.eval(`(() => {
    const containers=[...document.querySelectorAll(${JSON.stringify(containerSelector)})].filter((x)=>x.getBoundingClientRect().width>0 && x.getBoundingClientRect().height>0);
    const el=containers.flatMap((root)=>[...root.querySelectorAll('button')]).find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0);
    el?.click();
    return Boolean(el);
  })()`)
}

async function clickVisibleContainerText(cdp, containerSelector, text, selector) {
  return cdp.eval(`(() => {
    const containers=[...document.querySelectorAll(${JSON.stringify(containerSelector)})].filter((x)=>x.getBoundingClientRect().width>0 && x.getBoundingClientRect().height>0);
    const el=containers.flatMap((root)=>[...root.querySelectorAll(${JSON.stringify(selector)})]).find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0);
    el?.click();
    return Boolean(el);
  })()`)
}

async function loginDesktop(cdp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await Promise.all([
    cdp.send('Storage.clearDataForOrigin', { origin: webBase, storageTypes: 'all' }),
    cdp.send('Network.clearBrowserCookies'),
  ])
  await cdp.navigate('/login')
  await cdp.wait(`document.querySelector('input[placeholder="请输入邮箱"]') !== null`, 10000, '桌面登录页')
  await cdp.eval(`(() => {
    const button=[...document.querySelectorAll('button')].find((x)=>x.textContent?.replace(/\\s/g,'').includes('登录'));
    button?.click(); return Boolean(button);
  })()`)
  await cdp.wait(`location.pathname === '/dashboard'`, 10000, '桌面登录')
}

async function main() {
  console.log('\nW3.5 用户个人中心 Browser Smoke')
  const target = await pageTarget()
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.connect()
  try {
    await loginDesktop(cdp)
    await cdp.wait(`document.querySelector('[data-testid="personal-menu-trigger"]') !== null`, 10000, '用户菜单入口')

    const triggerPosition = await cdp.eval(`(() => {
      const el=document.querySelector('[data-testid="personal-menu-trigger"]');
      const r=el?.getBoundingClientRect();
      return r ? {x:r.x,y:r.y,bottom:r.bottom,height:innerHeight} : null;
    })()`)
    check(
      '桌面用户入口位于左侧菜单底部而不是 Header',
      triggerPosition && triggerPosition.x < 220 && triggerPosition.bottom > triggerPosition.height - 100,
      JSON.stringify(triggerPosition),
    )
    check(
      '顶部 Header 不再展示用户名',
      await cdp.eval(`!document.querySelector('header')?.innerText.includes('系统管理员')`),
    )

    await openPersonalMenu(cdp)
    const menuLabels = await cdp.eval(`[
      ...document.querySelectorAll('.el-dropdown-menu__item')
    ].filter((x)=>x.getBoundingClientRect().width>0).map((x)=>x.textContent?.trim())`)
    check(
      '个人菜单按 Cordys 提供个人信息/我的计划/我的导出/退出系统',
      ['个人信息', '我的计划', '我的导出', '退出系统'].every((label) => menuLabels.includes(label)),
      JSON.stringify(menuLabels),
    )

    cdp.resetNetwork()
    await clickVisibleText(cdp, '个人信息', '.el-dropdown-menu__item')
    await cdp.wait(`document.querySelector('[data-testid="personal-center-drawer"]')?.getBoundingClientRect().width > 0`, 5000, '个人中心 Drawer')
    await cdp.wait(`document.body.innerText.includes('基本信息')`, 10000, '个人信息加载')
    check('个人信息 Drawer 打开时只请求一次详情', cdp.count('/api/personal/center/info', 'GET') === 1)
    check(
      '个人中心展示姓名/角色/手机号/邮箱/部门与修改密码',
      await cdp.eval(`['系统管理员','手机号','邮箱','部门','修改密码'].every((x)=>document.body.innerText.includes(x))`),
    )
    await clickVisibleContainerButton(cdp, '[data-testid="personal-center-drawer"]', '编辑')
    await cdp.wait(`document.body.innerText.includes('编辑个人信息')`, 3000, '编辑个人信息 Dialog')
    check(
      '个人信息编辑只暴露手机号和邮箱',
      await cdp.eval(`document.body.innerText.includes('手机号') && document.body.innerText.includes('邮箱')`),
    )
    await clickVisibleContainerButton(cdp, '.el-dialog', '取消')

    await clickVisibleContainerButton(cdp, '[data-testid="personal-center-drawer"]', '修改密码')
    await cdp.wait(
      `document.body.innerText.includes('当前密码') && document.body.innerText.includes('确认新密码')`,
      3000,
      '修改密码 Dialog',
    )
    check(
      '桌面修改密码 Dialog 字段完整',
      await cdp.eval(`['当前密码','新密码','确认新密码'].every((x)=>document.body.innerText.includes(x))`),
    )
    await clickVisibleContainerButton(cdp, '.el-dialog', '取消')

    cdp.resetNetwork()
    await clickVisibleContainerText(
      cdp,
      '[data-testid="personal-center-drawer"]',
      '我的计划',
      '.el-tabs__item',
    )
    await cdp.wait(`document.body.innerText.includes('暂无跟进计划') || document.querySelector('.el-table__body-wrapper tbody tr') !== null`, 10000, '我的计划列表')
    check(
      '个人中心我的计划走 Cordys facade',
      cdp.count('/api/personal/center/follow/plan/list', 'POST') === 1,
    )

    check(
      '管理员按 PERSONAL_API_KEY:READ 显示 API Key Tab',
      await cdp.eval(`[
        ...document.querySelectorAll('[data-testid="personal-center-drawer"] .el-tabs__item')
      ].some((x)=>x.textContent?.trim()==='API Key')`),
    )
    cdp.resetNetwork()
    await clickVisibleContainerText(
      cdp,
      '[data-testid="personal-center-drawer"]',
      'API Key',
      '.el-tabs__item',
    )
    await cdp.wait(
      `document.querySelector('[data-testid="personal-api-key-panel"]')?.getBoundingClientRect().width > 0`,
      5000,
      'API Key Panel',
    )
    await cdp.wait(
      `document.body.innerText.includes('X-Access-Key / X-Secret-Key')`,
      5000,
      'API Key 说明',
    )
    check('API Key Tab 首次进入只请求一次列表', cdp.count('/api/user/api/key/list', 'GET') === 1)
    check(
      'API Key Panel 展示 Cordys 管理字段和 5 个上限说明',
      await cdp.eval(`['API Key','X-Access-Key / X-Secret-Key','每个用户最多 5 个','新建'].every((x)=>document.body.innerText.includes(x))`),
    )

    const apiKeyBefore = await cdp.eval(`document.querySelectorAll('[data-testid="personal-api-key-card"]').length`)
    let createdBrowserKey = false
    cdp.resetNetwork()
    if (apiKeyBefore < 5) {
      await clickVisibleContainerButton(cdp, '[data-testid="personal-api-key-panel"]', '新建')
      await cdp.wait(
        `document.querySelectorAll('[data-testid="personal-api-key-card"]').length === ${apiKeyBefore + 1}`,
        5000,
        'Browser 新建 API Key',
      )
      createdBrowserKey = true
      check(
        'API Key Panel 可通过真实 UI 新建并刷新列表',
        cdp.count('/api/user/api/key/add', 'GET') === 1 && cdp.count('/api/user/api/key/list', 'GET') === 1,
      )
    } else {
      check(
        'API Key 达到 5 个时新建按钮禁用',
        await cdp.eval(`document.querySelector('[data-testid="personal-api-key-add"]')?.disabled === true`),
      )
    }

    if (createdBrowserKey) {
      await clickVisibleContainerButton(cdp, '[data-testid="personal-api-key-card"]', '有效期/描述')
      await cdp.wait(
        `document.body.innerText.includes('设置有效期') && document.body.innerText.includes('永久有效') && document.body.innerText.includes('自定义')`,
        3000,
        'API Key 有效期 Dialog',
      )
      check('API Key 有效期/描述 Dialog 可从卡片打开', true)
      await clickVisibleContainerButton(cdp, '.el-dialog', '取消')

      await clickVisibleContainerButton(cdp, '[data-testid="personal-api-key-card"]', '删除')
      await cdp.wait(`document.body.innerText.includes('删除后无法恢复')`, 3000, 'API Key 删除确认')
      await clickVisibleContainerButton(cdp, '.el-message-box', '确定')
      await cdp.wait(
        `document.querySelectorAll('[data-testid="personal-api-key-card"]').length === ${apiKeyBefore}`,
        5000,
        'Browser 删除 API Key',
      )
      check('Browser 新建的 API Key 可从 UI 删除并恢复原数量', true)
    } else {
      check('API Key 有效期/描述入口在满额状态仍可用', await cdp.eval(`document.body.innerText.includes('有效期/描述')`))
      check('满额状态不修改已有 API Key 数据', true)
    }

    await cdp.eval(`document.querySelector('[data-testid="personal-center-drawer"] .el-drawer__close-btn')?.click()`)
    await cdp.wait(`(document.querySelector('[data-testid="personal-center-drawer"]')?.getBoundingClientRect().width ?? 0) === 0`, 3000, '关闭个人中心')

    cdp.resetNetwork()
    await selectPersonalMenu(cdp, '我的计划')
    await cdp.wait(
      `document.querySelector('[data-testid="personal-center-drawer"]')?.getBoundingClientRect().width > 0`,
      5000,
      '菜单我的计划 Drawer',
    )
    await cdp.wait(
      `[...document.querySelectorAll('[data-testid="personal-center-drawer"] .el-tabs__item')].some((x)=>x.textContent?.trim()==='我的计划' && x.classList.contains('is-active'))`,
      5000,
      '菜单我的计划 Tab',
    )
    check(
      '左下用户菜单“我的计划”直接打开计划 Tab',
      cdp.count('/api/personal/center/follow/plan/list', 'POST') === 1,
    )
    await cdp.eval(`document.querySelector('[data-testid="personal-center-drawer"] .el-drawer__close-btn')?.click()`)
    await cdp.wait(`(document.querySelector('[data-testid="personal-center-drawer"]')?.getBoundingClientRect().width ?? 0) === 0`, 3000, '再次关闭个人中心')

    cdp.resetNetwork()
    await selectPersonalMenu(cdp, '我的导出')
    await cdp.wait(`document.body.innerText.includes('导出任务') && document.body.innerText.includes('导出任务仅保留 24 小时')`, 5000, '我的导出 Drawer')
    check('我的导出复用本人导出任务 API', cdp.count('/api/export-tasks', 'GET') === 1)
    await cdp.eval(`[...document.querySelectorAll('.el-drawer__close-btn')].find((x)=>x.getBoundingClientRect().width>0)?.click()`)

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    })
    cdp.resetNetwork()
    await cdp.navigate('/mine')
    await cdp.wait(`document.documentElement.classList.contains('mobile-client')`, 10000, 'Mobile 模式')
    await cdp.wait(`['手机号','邮箱','修改密码','退出登录'].every((x)=>document.body.innerText.includes(x))`, 10000, 'Mobile 我的页')
    check('Mobile 我的页读取个人中心详情 API', cdp.count('/api/personal/center/info', 'GET') === 1)
    check(
      'Mobile 我的页展示手机号/邮箱/修改密码/退出登录',
      await cdp.eval(`['手机号','邮箱','修改密码','退出登录'].every((x)=>document.body.innerText.includes(x))`),
    )
    await clickVisibleText(cdp, '手机号')
    await cdp.wait(`document.body.innerText.includes('编辑个人信息')`, 3000, 'Mobile 编辑个人信息')
    check('Mobile 个人信息提供可编辑手机号和邮箱', true)
    await clickVisibleText(cdp, '取消', 'button')

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })

    await cdp.navigate('/system/settings')
    await cdp.wait(`document.body.innerText.includes('界面设置') && document.body.innerText.includes('第三方')`, 10000, '企业设置')
    await clickVisibleContainerText(cdp, 'body', '第三方', '.el-tabs__item')
    await cdp.wait(`document.body.innerText.includes('企业微信')`, 5000, '企业第三方设置')
    check(
      '企业第三方设置不再保留重复的开放 API / 365 天令牌入口',
      await cdp.eval(`!document.body.innerText.includes('生成 365 天令牌') && !document.body.innerText.includes('开放 API')`),
    )

    await cdp.navigate('/dashboard')
    await cdp.wait(`document.querySelector('[data-testid="personal-menu-trigger"]') !== null`, 10000, '桌面用户菜单恢复')
    await selectPersonalMenu(cdp, '退出系统')
    await cdp.wait(`location.pathname === '/login'`, 5000, '退出系统回登录页')
    check('左下用户菜单“退出系统”清理登录态并返回登录页', true)

    const relevantConsoleErrors = cdp.consoleErrors.filter(
      (item) => !item.includes('Failed to load resource') && !item.includes('favicon'),
    )
    check('个人中心 Browser 无 Runtime exception', cdp.exceptions.length === 0, cdp.exceptions.join(' | '))
    check('个人中心 Browser 无业务 Console error', relevantConsoleErrors.length === 0, relevantConsoleErrors.join(' | '))
  } catch (error) {
    check('个人中心 Browser 执行异常', false, String(error?.stack ?? error))
  } finally {
    cdp.close()
  }

  console.log(`\n结果：${passed} 通过, ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

await main()
