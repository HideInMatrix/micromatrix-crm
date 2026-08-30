const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let accessToken = ''

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`)
  return data
}

async function loadPageTarget() {
  for (let i = 0; i < 80; i += 1) {
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
    this.requestMethods = new Map()
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
      if (msg.method === 'Runtime.exceptionThrown') {
        const details = msg.params.exceptionDetails
        this.exceptions.push(
          details?.exception?.description ??
            details?.exception?.value ??
            details?.text ??
            'Runtime exception',
        )
      }
      if (msg.method === 'Network.requestWillBeSent') {
        const request = msg.params.request
        this.requestMethods.set(msg.params.requestId, request.method)
        this.requests.push({ method: request.method, url: request.url, postData: request.postData ?? '' })
      }
      if (msg.method === 'Network.responseReceived') {
        this.responses.push({
          method: this.requestMethods.get(msg.params.requestId) ?? '',
          status: msg.params.response.status,
          url: msg.params.response.url,
        })
      }
    })
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable')])
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

  async waitFor(expression, timeoutMs, label) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }

  async setViewport(width, height, mobile) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile,
    })
  }

  async navigate(path) {
    const targetUrl = `${webBase}${path}`
    const marker = `db021-${Date.now()}-${Math.random()}`
    await this.evaluate(`document.documentElement.dataset.db021Marker=${JSON.stringify(marker)}`)
    await this.send('Page.navigate', { url: targetUrl })
    await this.waitFor(
      `location.href===${JSON.stringify(targetUrl)} && document.readyState!=='loading' && document.documentElement.dataset.db021Marker!==${JSON.stringify(marker)}`,
      15000,
      `页面加载 ${path}`,
    )
  }

  async click(expression) {
    return this.evaluate(`(() => { const el=${expression}; if (!el) return false; el.click(); return true })()`)
  }

  async input(expression, value) {
    return this.evaluate(`(() => {
      const el=${expression}
      if (!el) return false
      const proto=el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set
      setter?.call(el,${JSON.stringify(value)})
      el.dispatchEvent(new Event('input',{bubbles:true}))
      el.dispatchEvent(new Event('change',{bubbles:true}))
      return true
    })()`)
  }

  async waitForResponse(pathname, method, start, timeoutMs = 10000) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const matched = this.responses.slice(start).find((item) => {
        try {
          return new URL(item.url).pathname === pathname && item.method === method && item.status < 400
        } catch { return false }
      })
      if (matched) return matched
      await sleep(100)
    }
    return null
  }

  close() { this.socket.close() }
}

function pcDynamicInput(label) {
  return `(() => {
    const root=document.querySelector('[data-testid="follow-plan-dynamic-fields"]')
    const item=[...(root?.querySelectorAll('.el-form-item')??[])].find((node)=>node.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)})
    return item?.querySelector('input,textarea') ?? null
  })()`
}

function mobilePlanCell(content) {
  return `(() => [...document.querySelectorAll('.van-cell-group')].find((node)=>node.textContent?.includes(${JSON.stringify(content)}))?.querySelector('.van-cell') ?? null)()`
}

function visibleButton(text) {
  return `(() => [...document.querySelectorAll('button')].find((node)=>node.getBoundingClientRect().width>0 && node.textContent?.trim()===${JSON.stringify(text)}) ?? null)()`
}

function mobileDynamicInput(label) {
  return `(() => {
    const root=document.querySelector('[data-testid="mobile-follow-plan-dynamic-fields"]')
    const field=[...(root?.querySelectorAll('.van-field')??[])].find((node)=>node.querySelector('.van-field__label')?.textContent?.trim()===${JSON.stringify(label)})
    return field?.querySelector('input,textarea') ?? null
  })()`
}

async function main() {
  console.log('\nDB-021 FollowPlan PC/Mobile Browser Smoke')
  let fieldId = ''
  const fieldIds = []
  let planId = ''
  let customerId = ''
  let cdp
  const suffix = String(Date.now()).slice(-8)
  const fieldLabel = `DB021 UI ${suffix}`
  const complexFieldSpecs = [
    { label: `DB021 MEMBER ${suffix}`, type: 'member' },
    { label: `DB021 DEPT ${suffix}`, type: 'dept' },
    {
      label: `DB021 MULTI ${suffix}`,
      type: 'multiselect',
      options: [{ label: '选项A', value: 'A' }, { label: '选项B', value: 'B' }],
    },
    {
      label: `DB021 CHECK ${suffix}`,
      type: 'checkbox',
      options: [{ label: '选项X', value: 'X' }, { label: '选项Y', value: 'Y' }],
    },
    { label: `DB021 DATETIME ${suffix}`, type: 'datetime' },
  ]
  const planContent = `DB021-BROWSER-${suffix}`
  const customerName = `DB021-CUSTOMER-${suffix}`

  try {
    const loginResponse = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.com', password: 'admin123' }),
    })
    const login = await loginResponse.json()
    if (!loginResponse.ok || !login?.accessToken || !login?.refreshToken) {
      throw new Error(`管理员登录失败: ${loginResponse.status}`)
    }
    accessToken = login.accessToken

    const customer = await api('/account/add', { method: 'POST', body: { name: customerName } })
    customerId = customer.id
    check('临时客户创建成功', Boolean(customerId))

    const field = await api('/metadata/followPlan/fields', {
      method: 'POST',
      body: { label: fieldLabel, type: 'text', span: 24, showInList: false },
    })
    fieldId = field.id
    fieldIds.push(fieldId)
    check('临时 FollowPlan 自定义字段创建成功', Boolean(fieldId))

    for (const spec of complexFieldSpecs) {
      const created = await api('/metadata/followPlan/fields', {
        method: 'POST',
        body: { ...spec, span: 24, showInList: false },
      })
      fieldIds.push(created.id)
    }
    check('FollowPlan 复杂动态字段创建成功', fieldIds.length === 6)

    const formConfig = await api('/follow-up-plans/module/form')
    check('FollowPlan module/form 暴露动态字段', formConfig.fields?.some((item) => item.id === fieldId))
    check(
      'FollowPlan module/form 暴露五类复杂字段',
      complexFieldSpecs.every((spec) => formConfig.fields?.some((item) => item.label === spec.label && item.type === spec.type)),
    )

    const plan = await api('/follow-up-plans', {
      method: 'POST',
      body: {
        targetType: 'customer',
        targetId: customerId,
        content: planContent,
        method: '电话',
        moduleFields: [{ fieldId, fieldValue: 'seed-value' }],
      },
    })
    planId = plan.id
    check('临时 FollowPlan 创建成功', Boolean(planId))

    const target = await loadPageTarget()
    cdp = new CdpClient(target.webSocketDebuggerUrl)
    await cdp.connect()
    await cdp.setViewport(1440, 1000, false)
    await cdp.navigate('/login')
    await cdp.evaluate(`(() => {
      localStorage.setItem('mmx_access_token', ${JSON.stringify(login.accessToken)})
      localStorage.setItem('mmx_refresh_token', ${JSON.stringify(login.refreshToken)})
      return true
    })()`)

    const pcBefore = cdp.responses.length
    await cdp.navigate(`/follow-plans?id=${encodeURIComponent(planId)}`)
    await cdp.waitFor(`document.querySelector('[data-testid="follow-plan-dialog"]')?.getBoundingClientRect().width>0`, 10000, 'PC 编辑弹窗')
    await cdp.waitFor(`document.querySelector('[data-testid="follow-plan-dynamic-fields"]')?.textContent?.includes(${JSON.stringify(fieldLabel)})===true`, 10000, 'PC 动态字段')
    check('PC module/form 请求 200', Boolean(await cdp.waitForResponse('/api/follow-up-plans/module/form', 'GET', pcBefore)))
    check(
      'PC 五类复杂动态字段均渲染',
      await cdp.evaluate(`(() => { const text=document.querySelector('[data-testid="follow-plan-dynamic-fields"]')?.textContent??''; return ${JSON.stringify(complexFieldSpecs.map((item) => item.label))}.every((label)=>text.includes(label)) })()`),
    )
    check('PC 编辑动态字段回填', await cdp.evaluate(`${pcDynamicInput(fieldLabel)}?.value==='seed-value'`))
    check('PC 动态字段可编辑', await cdp.input(pcDynamicInput(fieldLabel), 'pc-edited'))
    const pcSaveBefore = cdp.responses.length
    check('PC 保存按钮可点击', await cdp.click(`document.querySelector('[data-testid="follow-plan-save"]')`))
    check('PC PATCH 保存成功', Boolean(await cdp.waitForResponse(`/api/follow-up-plans/${planId}`, 'PATCH', pcSaveBefore)))
    await cdp.waitFor(`!document.querySelector('[data-testid="follow-plan-dialog"]') || document.querySelector('[data-testid="follow-plan-dialog"]')?.getBoundingClientRect().width===0`, 10000, 'PC 编辑弹窗关闭')
    const afterPc = await api(`/follow-up-plans/${planId}`)
    check('PC 保存后 Field 值真实读回', afterPc.moduleFields?.some((item) => item.fieldId === fieldId && item.fieldValue === 'pc-edited'))

    await cdp.setViewport(390, 844, true)
    const mobileBefore = cdp.responses.length
    await cdp.navigate(`/follow-plans?db021Mobile=${suffix}`)
    await cdp.waitFor(`document.querySelector('.van-list') && document.body?.innerText.includes(${JSON.stringify(planContent)})`, 10000, 'Mobile 跟进计划列表')
    check('Mobile 路由使用移动端视图', await cdp.evaluate(`Boolean(document.querySelector('.van-list')) && !document.querySelector('.el-table')`))
    check('Mobile 计划操作可打开', await cdp.click(mobilePlanCell(planContent)))
    await cdp.waitFor(`document.body?.innerText.includes('计划操作')===true`, 5000, 'Mobile 计划操作')
    check('Mobile 编辑入口可点击', await cdp.click(visibleButton('编辑')))
    await cdp.waitFor(`document.querySelector('[data-testid="mobile-follow-plan-form"]')?.getBoundingClientRect().height>0`, 10000, 'Mobile 编辑表单')
    await cdp.waitFor(`document.querySelector('[data-testid="mobile-follow-plan-dynamic-fields"]')?.textContent?.includes(${JSON.stringify(fieldLabel)})===true`, 10000, 'Mobile 动态字段')
    check('Mobile module/form 请求 200', Boolean(await cdp.waitForResponse('/api/follow-up-plans/module/form', 'GET', mobileBefore)))
    check(
      'Mobile 五类复杂动态字段均渲染',
      await cdp.evaluate(`(() => { const text=document.querySelector('[data-testid="mobile-follow-plan-dynamic-fields"]')?.textContent??''; return ${JSON.stringify(complexFieldSpecs.map((item) => item.label))}.every((label)=>text.includes(label)) })()`),
    )
    check('Mobile 编辑动态字段回填', await cdp.evaluate(`${mobileDynamicInput(fieldLabel)}?.value==='pc-edited'`))
    check('Mobile 动态字段可编辑', await cdp.input(mobileDynamicInput(fieldLabel), 'mobile-edited'))
    const mobileSaveBefore = cdp.responses.length
    check('Mobile 保存按钮可点击', await cdp.click(`document.querySelector('[data-testid="mobile-follow-plan-save"]')`))
    check('Mobile PATCH 保存成功', Boolean(await cdp.waitForResponse(`/api/follow-up-plans/${planId}`, 'PATCH', mobileSaveBefore)))
    const afterMobile = await api(`/follow-up-plans/${planId}`)
    check('Mobile 保存后 Field 值真实读回', afterMobile.moduleFields?.some((item) => item.fieldId === fieldId && item.fieldValue === 'mobile-edited'))

    const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
    check('DB-021 Browser API 5xx = 0', api5xx.length === 0, JSON.stringify(api5xx))
    check('DB-021 Browser Runtime exception = 0', cdp.exceptions.length === 0, JSON.stringify(cdp.exceptions))
  } finally {
    cdp?.close()
    if (planId) {
      try { await api(`/follow-up-plans/${planId}`, { method: 'DELETE' }) } catch (error) { console.error(`清理 FollowPlan 失败: ${error.message}`) }
    }
    for (const id of [...fieldIds].reverse()) {
      try { await api(`/metadata/fields/${id}`, { method: 'DELETE' }) } catch (error) { console.error(`清理 FollowPlan 字段 ${id} 失败: ${error.message}`) }
    }
    if (customerId) {
      try { await api('/account/batch/delete', { method: 'POST', body: [customerId] }) } catch (error) { console.error(`清理临时客户失败: ${error.message}`) }
    }
  }

  console.log(`\nDB-021 FollowPlan Browser Smoke: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

await main()
