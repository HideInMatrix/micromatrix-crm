import { approvalFlowWriteFromDetail, explicitApprovalFlowRequest } from './helpers/approval-flow-graph.mjs'

const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let userViewId = ''
let productId = ''
let opportunityId = ''
let quotationId = ''
let quotationFlowId = ''
let contractFlowId = ''
let createdContractIds = []
let quotationFlowCreated = false
let contractFlowCreated = false
let quotationFlowRestore = null
let contractFlowRestore = null

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

async function apiRequest(method, path, body, allowed = []) {
  body = explicitApprovalFlowRequest(path, method, body)
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const raw = await response.text()
  let data
  try { data = raw ? JSON.parse(raw) : null } catch { data = raw }
  if (!response.ok && !allowed.includes(response.status)) {
    throw new Error(`${method} ${path} -> ${response.status} ${raw}`)
  }
  return { response, data, raw }
}

async function loadPageTarget() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((r) => r.json())
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
        this.exceptions.push(msg.params.exceptionDetails?.text ?? 'Runtime exception')
      }
      if (msg.method === 'Network.requestWillBeSent') {
        this.requests.push({
          method: msg.params.request.method,
          url: msg.params.request.url,
          postData: msg.params.request.postData,
        })
      }
      if (msg.method === 'Network.responseReceived') {
        this.responses.push({ status: msg.params.response.status, url: msg.params.response.url })
      }
    })
    const rejectPending = (reason) => {
      for (const pending of this.pending.values()) pending.reject(new Error(reason))
      this.pending.clear()
    }
    this.socket.addEventListener('close', () => rejectPending('Chrome DevTools WebSocket 已关闭'))
    this.socket.addEventListener('error', () => rejectPending('Chrome DevTools WebSocket 发生错误'))
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable')])
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
    const targetUrl = `${webBase}${path}`
    const marker = `w363-${Date.now()}-${Math.random()}`
    await this.evaluate(`window.__w363NavigationMarker=${JSON.stringify(marker)};true`)
    await this.send('Page.navigate', { url: targetUrl })
    await this.waitFor(
      `location.href===${JSON.stringify(targetUrl)} && window.__w363NavigationMarker!==${JSON.stringify(marker)} && document.readyState!=='loading' && document.body!==null`,
      10000,
      `页面加载 ${path}`,
    )
  }

  async waitFor(expression, timeoutMs, label) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`${label} 超时`)
  }

  requestCount(pathname, method, start = 0) {
    return this.requests.slice(start).filter((item) => {
      try {
        return new URL(item.url).pathname === pathname && (!method || item.method === method)
      } catch { return false }
    }).length
  }

  lastRequest(pathname, method) {
    return [...this.requests].reverse().find((item) => {
      try {
        return new URL(item.url).pathname === pathname && (!method || item.method === method)
      } catch { return false }
    })
  }

  close() { this.socket.close() }
}

const textIncludes = (text) => `document.body?.innerText.includes(${JSON.stringify(text)})===true`

async function clickExact(cdp, text, selector = 'button,label') {
  return cdp.evaluate(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find((x)=>x.textContent?.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0)
    el?.click(); return Boolean(el)
  })()`)
}

async function clickRowAction(cdp, rowName, action) {
  return cdp.evaluate(`(() => {
    const row=[...document.querySelectorAll('.el-table__row')].find((el)=>el.textContent?.includes(${JSON.stringify(rowName)}))
    const button=[...(row?.querySelectorAll('button')??[])].find((el)=>el.textContent?.trim()===${JSON.stringify(action)})
    button?.click(); return Boolean(button)
  })()`)
}

async function setDrawerInput(cdp, label, value) {
  return cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.el-drawer .el-form-item')].find((el)=>el.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)})
    const input=item?.querySelector('input')
    if(!input) return false
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set
    setter?.call(input,${JSON.stringify(value)})
    input.dispatchEvent(new Event('input',{bubbles:true}))
    input.dispatchEvent(new Event('change',{bubbles:true}))
    return true
  })()`)
}

async function selectDrawerFirstOption(cdp, label) {
  const opened = await cdp.evaluate(`(() => {
    const item=[...document.querySelectorAll('.el-drawer .el-form-item')].find((el)=>el.querySelector('.el-form-item__label')?.textContent?.trim()===${JSON.stringify(label)})
    const wrapper=item?.querySelector('.el-select__wrapper')
    wrapper?.click(); return Boolean(wrapper)
  })()`)
  if (!opened) return false
  await sleep(100)
  return cdp.evaluate(`(() => {
    const option=[...document.querySelectorAll('.el-select-dropdown__item')].find((el)=>el.getBoundingClientRect().width>0 && !el.classList.contains('is-disabled'))
    option?.click(); return Boolean(option)
  })()`)
}

async function setPromptValue(cdp, value) {
  return cdp.evaluate(`(() => {
    const input=document.querySelector('.el-message-box input')
    if(!input) return false
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set
    setter?.call(input,${JSON.stringify(value)})
    input.dispatchEvent(new Event('input',{bubbles:true}))
    return true
  })()`)
}

async function setFlowEnabled(id, enabled) {
  return apiRequest('PATCH', `/approvals/flows/${id}/enabled`, { enabled })
}

async function waitContract(id, predicate, timeoutMs = 10000) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    const result = await apiRequest('GET', `/contract/get/${id}`, undefined, [404])
    last = result.data
    if (result.response.ok && predicate(last)) return last
    await sleep(100)
  }
  return last
}

function flowUpdateBody(detail) {
  return approvalFlowWriteFromDetail(detail)
}

async function prepareFlow(formType, body) {
  const items = (await apiRequest('GET', `/approvals/flows?formType=${formType}`)).data.items ?? []
  if (!items.length) {
    const created = (await apiRequest('POST', '/approvals/flows', { formType, ...body })).data
    return { id: created.id, created: true, restore: null }
  }
  const id = items[0].id
  const detail = (await apiRequest('GET', `/approvals/flows/${id}`)).data
  const restore = flowUpdateBody(detail)
  await apiRequest('PUT', `/approvals/flows/${id}`, body)
  return { id, created: false, restore }
}

async function restoreFlow(id, created, restore) {
  if (!id) return
  if (created) {
    await apiRequest('DELETE', `/approvals/flows/${id}`, undefined, [404])
    return
  }
  if (restore) await apiRequest('PUT', `/approvals/flows/${id}`, restore)
}

async function repairInterruptedContractFixture(userId) {
  const items = (await apiRequest('GET', '/approvals/flows?formType=contract')).data.items ?? []
  const stale = items.find((item) => item.name?.startsWith('W363 Browser '))
  if (!stale) return
  await apiRequest('PUT', `/approvals/flows/${stale.id}`, {
    name: '大额合同审批',
    description: null,
    enabled: true,
    createExecute: true,
    updateExecute: false,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: false,
    allowAddSign: false,
    duplicateApproverRule: 'FIRST_ONLY',
    requireComment: false,
    condition: { amountGte: 80000 },
    createNodes: [
      { name: '直属上级审批', approverType: 'DIRECT_LEADER', approverIds: [], ccUserIds: [], mode: 'ANY' },
      { name: '管理员终审', approverType: 'USER', approverIds: [userId], ccUserIds: [], mode: 'ANY' },
    ],
  })
}

async function main() {
  console.log('\nW3.6.3 合同 Browser Smoke')
  const login = await apiRequest('POST', '/auth/login', {
    email: 'admin@demo.com',
    password: 'admin123',
  })
  if (!login.response.ok || !login.data?.accessToken) throw new Error(`管理员登录失败: ${login.response.status}`)
  token = login.data.accessToken
  const userId = login.data.user.id
  const suffix = Date.now().toString(36)
  const prefix = `W363 Browser ${suffix}`
  const baseName = `${prefix} Base`
  const unrelatedName = `W363 Other ${suffix}`
  const uiName = `${prefix} UI Create`
  const editedName = `${prefix} UI Edited`
  const viewName = `${prefix} View`
  const quoteName = `${prefix} Quote`
  const approvalName = `${prefix} Approval`
  const voidReason = `${prefix} Void Reason`

  const form = (await apiRequest('GET', '/contract/module/form')).data
  const customers = (await apiRequest('POST', '/account/page', { current: 1, pageSize: 20 })).data
  const customer = customers.list?.[0]
  if (!customer?.id) throw new Error('Browser Smoke 缺少可用客户种子数据')
  const stageData = (await apiRequest('GET', '/contract/stage/get')).data
  const stages = stageData.stageConfigList ?? []
  const firstStage = stages[0]
  const secondStage = stages[1]
  const voidStage = stages.find((item) => item.name === '作废')
  if (!firstStage || !secondStage || !voidStage) throw new Error('合同默认阶段未初始化完整')

  const flowBase = {
    createExecute: true,
    updateExecute: true,
    deleteExecute: true,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: false,
    allowAddSign: false,
    duplicateApproverRule: 'FIRST_ONLY',
    requireComment: false,
    condition: null,
    createNodes: [{
      name: '管理员审批', approverType: 'USER', approverIds: [userId], ccUserIds: [], mode: 'ANY',
    }],
  }
  await repairInterruptedContractFixture(userId)
  const contractFixture = await prepareFlow('contract', {
    name: `${prefix} Contract Flow`, enabled: false, ...flowBase,
  })
  contractFlowId = contractFixture.id
  contractFlowCreated = contractFixture.created
  contractFlowRestore = contractFixture.restore
  const quotationFixture = await prepareFlow('quotation', {
    name: `${prefix} Quote Flow`, enabled: true, ...flowBase,
  })
  quotationFlowId = quotationFixture.id
  quotationFlowCreated = quotationFixture.created
  quotationFlowRestore = quotationFixture.restore

  const baseContract = (await apiRequest('POST', '/contract/add', {
    name: baseName,
    customerId: customer.id,
    owner: userId,
    amount: 200,
    moduleFields: [],
    moduleFormConfigDTO: form,
    products: [],
  })).data
  createdContractIds.push(baseContract.id)
  const unrelatedContract = (await apiRequest('POST', '/contract/add', {
    name: unrelatedName,
    customerId: customer.id,
    owner: userId,
    amount: 1,
    moduleFields: [],
    moduleFormConfigDTO: form,
    products: [],
  })).data
  createdContractIds.push(unrelatedContract.id)

  const view = (await apiRequest('POST', '/contract/view/add', {
    name: viewName,
    searchMode: 'AND',
    conditions: [{ name: 'name', operator: 'contains', value: prefix, type: 'text' }],
  })).data
  userViewId = view.id
  await apiRequest('GET', `/contract/view/fixed/${userViewId}`)

  const product = (await apiRequest('POST', '/product/add', {
    name: `${prefix} Product`,
    price: 88.8,
    status: '1',
  })).data
  productId = product.id
  const opportunity = (await apiRequest('POST', '/opportunity/add', {
    name: `${prefix} Opportunity`,
    customerId: customer.id,
    amount: 888,
    owner: userId,
    products: [productId],
  })).data
  opportunityId = opportunity.id

  const quoteForm = (await apiRequest('GET', '/opportunity/quotation/module/form')).data
  const quotation = (await apiRequest('POST', '/opportunity/quotation/add', {
    name: quoteName,
    opportunityId,
    untilTime: Date.now() + 7 * 86_400_000,
    amount: 99.9,
    moduleFields: [],
    moduleFormConfigDTO: quoteForm,
    products: [{ product: productId, productAmount: 88.8, discount: 100, tax: 0, amount: 99.9 }],
  })).data
  quotationId = quotation.id
  await apiRequest('POST', '/opportunity/quotation/approve', {
    id: quotationId,
    approvalStatus: 'APPROVED',
  })
  await setFlowEnabled(quotationFlowId, false)

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
    check('登录按钮可点击', await cdp.evaluate(`(() => {
      const button=[...document.querySelectorAll('button')].find((item)=>item.textContent?.replace(/\\s/g,'').includes('登录'))
      button?.click(); return Boolean(button)
    })()`))
    await cdp.waitFor(`location.pathname==='/dashboard'`, 10000, '管理员登录')

    const initialRequestStart = cdp.requests.length
    await cdp.navigate('/contracts')
    await cdp.waitFor(textIncludes('新建合同'), 10000, '合同页面')
    await cdp.waitFor(textIncludes(baseName), 10000, '合同首屏列表')
    await sleep(600)
    check(
      '合同首屏只请求一次 POST /contract/page',
      cdp.requestCount('/api/contract/page', 'POST', initialRequestStart) === 1,
      `actual=${cdp.requestCount('/api/contract/page', 'POST', initialRequestStart)}`,
    )
    check('合同页读取 direct module form', cdp.requestCount('/api/contract/module/form', 'GET', initialRequestStart) >= 1)
    check('合同页读取真实阶段配置', cdp.requestCount('/api/contract/stage/get', 'GET', initialRequestStart) >= 1)
    check('合同 Saved View 使用 /contract/view/list', cdp.requestCount('/api/contract/view/list', 'GET', initialRequestStart) >= 1)
    check('合同列表展示 direct number', await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(baseContract.number)})`))

    const viewPageBefore = cdp.requestCount('/api/contract/page', 'POST')
    check('固定合同视图按钮可点击', await clickExact(cdp, viewName))
    const viewReloadStart = Date.now()
    while (
      Date.now() - viewReloadStart < 10000 &&
      cdp.requestCount('/api/contract/page', 'POST') <= viewPageBefore
    ) {
      await sleep(100)
    }
    check('切换 Saved View 重新加载 page', cdp.requestCount('/api/contract/page', 'POST') > viewPageBefore)
    await cdp.waitFor(
      `(() => {
        const rows=[...document.querySelectorAll('.el-table__row')].filter((el)=>el.getBoundingClientRect().width>0).map((el)=>el.textContent??'')
        return rows.some((text)=>text.includes(${JSON.stringify(baseName)})) && !rows.some((text)=>text.includes(${JSON.stringify(unrelatedName)}))
      })()`,
      10000,
      '合同 Saved View 过滤',
    )
    const viewPageRequest = cdp.lastRequest('/api/contract/page', 'POST')
    let viewPageBody = {}
    try {
      viewPageBody = JSON.parse(viewPageRequest?.postData ?? '{}')
    } catch {
      viewPageBody = {}
    }
    check('Saved View id 交给后端 page 求交', viewPageBody.viewId === userViewId, JSON.stringify(viewPageBody))

    check('新建合同按钮可打开 Drawer', await clickExact(cdp, '新建合同'))
    await cdp.waitFor(
      `[...document.querySelectorAll('.el-drawer')].some((el)=>el.textContent?.includes('新建合同') && el.getBoundingClientRect().width>0)`,
      5000,
      '新建合同 Drawer',
    )
    check('新建合同可填写名称', await setDrawerInput(cdp, '合同名称', uiName))
    check('新建合同可选择客户', await selectDrawerFirstOption(cdp, '客户'))
    const addBefore = cdp.requestCount('/api/contract/add', 'POST')
    check('新建合同可保存', await clickExact(cdp, '保存'))
    await cdp.waitFor(
      `![...document.querySelectorAll('.el-drawer')].some((el)=>el.textContent?.includes('新建合同') && el.getBoundingClientRect().width>0)`,
      10000,
      '新建合同 Drawer 关闭',
    )
    check('新建合同调用 POST /contract/add', cdp.requestCount('/api/contract/add', 'POST') > addBefore)
    await cdp.waitFor(textIncludes(uiName), 10000, '新建合同列表刷新')
    const uiPage = (await apiRequest('POST', '/contract/page', { current: 1, pageSize: 20, keyword: uiName })).data
    const uiContract = uiPage.list?.find((item) => item.name === uiName)
    check('UI 新建合同可由 direct page 查询', Boolean(uiContract?.id))
    if (!uiContract?.id) throw new Error('UI 新建合同未找到 id')
    createdContractIds.push(uiContract.id)

    check('合同列表编辑动作可点击', await clickRowAction(cdp, uiName, '编辑'))
    await cdp.waitFor(
      `[...document.querySelectorAll('.el-drawer')].some((el)=>el.textContent?.includes('编辑合同') && el.getBoundingClientRect().width>0)`,
      5000,
      '编辑合同 Drawer',
    )
    check('编辑合同可修改名称', await setDrawerInput(cdp, '合同名称', editedName))
    const updateBefore = cdp.requestCount('/api/contract/update', 'POST')
    check('编辑合同可提交保存', await clickExact(cdp, '保存'))
    await cdp.waitFor(textIncludes(editedName), 10000, '编辑合同列表刷新')
    check('编辑合同调用 POST /contract/update', cdp.requestCount('/api/contract/update', 'POST') > updateBefore)

    const detailStart = cdp.requests.length
    await cdp.navigate(`/contracts?id=${uiContract.id}`)
    await cdp.waitFor(textIncludes('合同冻结快照'), 10000, '合同详情快照')
    check(
      '合同深链打开真实详情 Drawer',
      await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(editedName)}) && document.body.innerText.includes('合同明细')`),
    )
    check('详情读取 GET /contract/get/:id', cdp.requestCount(`/api/contract/get/${uiContract.id}`, 'GET', detailStart) >= 1)
    check('详情读取业务冻结快照', cdp.requestCount(`/api/contract/get/snapshot/${uiContract.id}`, 'GET', detailStart) >= 1)
    check('详情读取表单配置快照', cdp.requestCount(`/api/contract/module/form/snapshot/${uiContract.id}`, 'GET', detailStart) >= 1)

    await cdp.navigate('/contracts')
    await cdp.waitFor(textIncludes(baseName), 10000, '合同列表重载')
    check('看板模式可点击', await clickExact(cdp, '看板'))
    await cdp.waitFor(
      `[...document.querySelectorAll('section')].some((el)=>el.getBoundingClientRect().width>0 && el.querySelector('strong')?.textContent?.trim()===${JSON.stringify(secondStage.name)})`,
      5000,
      '合同阶段看板',
    )
    await cdp.waitFor(
      `![...document.querySelectorAll('.el-loading-mask')].some((el)=>el.getBoundingClientRect().width>0 && getComputedStyle(el).display!=='none')`,
      10000,
      '合同看板加载完成',
    )
    const stageBefore = cdp.requestCount('/api/contract/update/stage', 'POST')
    const dragDiagnostic = await cdp.evaluate(`(() => {
      const target=[...document.querySelectorAll('section')].find((el)=>el.getBoundingClientRect().width>0 && el.querySelector('strong')?.textContent?.trim()===${JSON.stringify(secondStage.name)})
      const card=[...document.querySelectorAll('article')].find((el)=>el.textContent?.includes(${JSON.stringify(baseName)}))
      if(!target||!card) return { ready:false, card:Boolean(card), target:Boolean(target), transferred:'' }
      const transfer=new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}))
      target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:transfer}))
      target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}))
      const transferred=transfer.getData('text/plain')
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))
      card.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:transfer}))
      return { ready:true, card:true, target:true, transferred }
    })()`)
    check(
      '看板合同可拖拽到下一阶段',
      dragDiagnostic?.ready === true && dragDiagnostic?.transferred === baseContract.id,
      JSON.stringify(dragDiagnostic),
    )
    await cdp.waitFor(
      `true`,
      300,
      '看板阶段提交',
    )
    const stageWaitStart = Date.now()
    while (Date.now() - stageWaitStart < 10000 && cdp.requestCount('/api/contract/update/stage', 'POST') <= stageBefore) {
      await sleep(100)
    }
    check('看板拖拽调用 POST /contract/update/stage', cdp.requestCount('/api/contract/update/stage', 'POST') > stageBefore)
    const afterBoard = await waitContract(baseContract.id, (item) => item?.stage === secondStage.id)
    check('看板拖拽持久化真实 stage id', afterBoard.stage === secondStage.id, `stage=${afterBoard.stage}`)

    check('列表模式可切回', await clickExact(cdp, '列表'))
    await cdp.waitFor(
      `[...document.querySelectorAll('.el-table__row')].some((el)=>el.textContent?.includes(${JSON.stringify(baseName)}))`,
      5000,
      '合同列表模式',
    )
    const openedStage = await cdp.evaluate(`(() => {
      const row=[...document.querySelectorAll('.el-table__row')].find((el)=>el.textContent?.includes(${JSON.stringify(baseName)}))
      const wrapper=row?.querySelector('.el-select__wrapper')
      wrapper?.click(); return Boolean(wrapper)
    })()`)
    check('合同阶段下拉可打开', openedStage)
    await sleep(100)
    const selectedVoid = await cdp.evaluate(`(() => {
      const option=[...document.querySelectorAll('.el-select-dropdown__item')].find((el)=>el.getBoundingClientRect().width>0 && el.textContent?.trim()===${JSON.stringify(voidStage.name)})
      option?.click(); return Boolean(option)
    })()`)
    check('合同可选择作废阶段', selectedVoid)
    await cdp.waitFor(textIncludes('合同作废'), 5000, '合同作废原因提示')
    check('作废原因可填写', await setPromptValue(cdp, voidReason))
    check('作废原因可确认', await clickExact(cdp, '确定'))
    await cdp.waitFor(textIncludes(`合同已流转到「${voidStage.name}」`), 10000, '合同作废完成')
    const voided = await waitContract(
      baseContract.id,
      (item) => item?.stage === voidStage.id && item?.voidReason === voidReason,
    )
    check('作废阶段持久化', voided.stage === voidStage.id)
    check('作废原因持久化', voided.voidReason === voidReason, `voidReason=${voided.voidReason}`)

    const quoteRouteStart = cdp.requests.length
    await cdp.evaluate(`(() => {
      history.pushState({},'',${JSON.stringify(`/contracts?fromQuote=${quotationId}`)})
      window.dispatchEvent(new PopStateEvent('popstate'))
      return true
    })()`)
    await cdp.waitFor(
      `location.pathname==='/contracts' && new URLSearchParams(location.search).get('fromQuote')===${JSON.stringify(quotationId)}`,
      5000,
      '报价到合同路由',
    )
    try {
      await cdp.waitFor(
        `[...document.querySelectorAll('.el-drawer')].some((el)=>el.textContent?.includes('新建合同') && el.getBoundingClientRect().width>0)`,
        10000,
        '报价到合同新建 Drawer',
      )
    } catch (error) {
      const quoteState = await apiRequest('GET', `/opportunity/quotation/get/${quotationId}`, undefined, [404])
      console.error('  fromQuote 诊断 quote:', quoteState.status, quoteState.raw)
      console.error('  fromQuote 诊断 href:', await cdp.evaluate('location.href'))
      console.error('  fromQuote 诊断 body:', (await cdp.evaluate('document.body?.innerText ?? ""')).slice(0, 4000))
      console.error(
        '  fromQuote 诊断 responses:',
        cdp.responses.filter((item) => item.url.includes('/api/opportunity/quotation/') || item.url.includes(`/api/opportunity/get/${opportunityId}`)).slice(-30),
      )
      throw error
    }
    const quoteContractName = `${quoteName}-合同`
    check('fromQuote 深链预填合同名称', await cdp.evaluate(`[...document.querySelectorAll('.el-drawer input')].some((el)=>el.value===${JSON.stringify(quoteContractName)})`))
    check('fromQuote 深链预填产品', await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(product.name)})`))
    check('fromQuote 读取报价详情', cdp.requestCount(`/api/opportunity/quotation/get/${quotationId}`, 'GET', quoteRouteStart) >= 1)
    check('fromQuote 读取报价冻结快照', cdp.requestCount(`/api/opportunity/quotation/get/snapshot/${quotationId}`, 'GET', quoteRouteStart) >= 1)
    check('fromQuote 读取商机上下文', cdp.requestCount(`/api/opportunity/get/${opportunityId}`, 'GET', quoteRouteStart) >= 1)
    const quoteContractAddBefore = cdp.requestCount('/api/contract/add', 'POST')
    check('fromQuote 预填合同可直接保存', await clickExact(cdp, '保存'))
    await cdp.waitFor(
      `![...document.querySelectorAll('.el-drawer')].some((el)=>el.textContent?.includes('新建合同') && el.getBoundingClientRect().width>0)`,
      10000,
      'fromQuote 合同保存',
    )
    check('fromQuote 保存调用 direct POST /contract/add', cdp.requestCount('/api/contract/add', 'POST') > quoteContractAddBefore)

    const quoteContractPage = (await apiRequest('POST', '/contract/page', {
      current: 1,
      pageSize: 20,
      keyword: quoteContractName,
    })).data
    const quoteContract = quoteContractPage.list?.find((item) => item.name === quoteContractName)
    check('fromQuote 创建结果可由 direct page 查询', Boolean(quoteContract?.id))
    if (!quoteContract?.id) throw new Error('fromQuote 创建合同未找到')
    createdContractIds.push(quoteContract.id)
    const quoteContractDetail = (await apiRequest('GET', `/contract/get/${quoteContract.id}`)).data
    check('fromQuote 不持久化 quotationId', !Object.prototype.hasOwnProperty.call(quoteContractDetail, 'quotationId'))
    check('fromQuote 不持久化 opportunityId', !Object.prototype.hasOwnProperty.call(quoteContractDetail, 'opportunityId'))
    check('fromQuote 保留报价产品到 direct SUB_TABLE', quoteContractDetail.products?.some((item) => item.productId === productId))

    await setFlowEnabled(contractFlowId, true)
    const approvalContract = (await apiRequest('POST', '/contract/add', {
      name: approvalName,
      customerId: customer.id,
      owner: userId,
      amount: 66,
      moduleFields: [],
      moduleFormConfigDTO: form,
      products: [],
    })).data
    createdContractIds.push(approvalContract.id)
    check('CREATE 审批合同准备为 APPROVING', approvalContract.approvalStatus === 'APPROVING')

    const approvalViewPage = (await apiRequest('POST', '/contract/page', {
      current: 1,
      pageSize: 20,
      viewId: userViewId,
    })).data
    check(
      '审批合同命中合同 Saved View',
      approvalViewPage.list?.some((item) => item.id === approvalContract.id),
    )
    const approvalReloadBefore = cdp.requestCount('/api/contract/page', 'POST')
    check('审批合同列表可通过 Saved View 刷新', await clickExact(cdp, viewName))
    const approvalReloadStart = Date.now()
    while (
      Date.now() - approvalReloadStart < 10000 &&
      cdp.requestCount('/api/contract/page', 'POST') <= approvalReloadBefore
    ) {
      await sleep(100)
    }
    check(
      '审批合同刷新重新请求 POST /contract/page',
      cdp.requestCount('/api/contract/page', 'POST') > approvalReloadBefore,
    )
    try {
      await cdp.waitFor(
        `[...document.querySelectorAll('.el-table__row')].some((el)=>el.textContent?.includes(${JSON.stringify(approvalName)}))`,
        10000,
        '审批合同表格行',
      )
    } catch (error) {
      console.error(
        '  审批表格行诊断:',
        await cdp.evaluate(`[...document.querySelectorAll('.el-table__row')].map((el)=>el.textContent ?? '')`),
      )
      console.error('  审批页面正文诊断:', (await cdp.evaluate('document.body?.innerText ?? ""')).slice(0, 4000))
      throw error
    }
    const approvalRowDiagnostic = await cdp.evaluate(`(() => {
      const row=[...document.querySelectorAll('.el-table__row')].find((el)=>el.textContent?.includes(${JSON.stringify(approvalName)}))
      return row ? {
        text: row.textContent ?? '',
        buttons: [...row.querySelectorAll('button')].map((button)=>button.textContent?.trim() ?? ''),
      } : null
    })()`)
    const approvalActionsVisible = Boolean(
      approvalRowDiagnostic && ['通过','驳回','撤回'].every((x)=>approvalRowDiagnostic.text.includes(x)),
    )
    if (!approvalActionsVisible) console.error('  审批行诊断:', approvalRowDiagnostic)
    check('审批中合同展示通过/驳回/撤回动作', approvalActionsVisible)
    const approvalBefore = cdp.requestCount('/api/contract/approval', 'POST')
    check('合同审批通过动作可点击', await clickRowAction(cdp, approvalName, '通过'))
    const approvalWaitStart = Date.now()
    while (Date.now() - approvalWaitStart < 10000 && cdp.requestCount('/api/contract/approval', 'POST') <= approvalBefore) {
      await sleep(100)
    }
    check('合同审批调用 POST /contract/approval', cdp.requestCount('/api/contract/approval', 'POST') > approvalBefore)
    await cdp.waitFor(textIncludes('审批已通过'), 10000, '合同审批完成')
    const approvedContract = (await apiRequest('GET', `/contract/get/${approvalContract.id}`)).data
    check('审批通过后 approvalStatus=APPROVED', approvedContract.approvalStatus === 'APPROVED')
    check('审批通过后 approved=true', approvedContract.approved === true)
    await setFlowEnabled(contractFlowId, false)

    const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
    check('合同 Browser Smoke 无 API 5xx', api5xx.length === 0, api5xx.map((item) => `${item.status} ${item.url}`).join(', '))
    check('合同 Browser Smoke 无 Runtime exception', cdp.exceptions.length === 0, cdp.exceptions.join(', '))
  } finally {
    cdp.close()
  }

  console.log(`\n结果：${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

try {
  await main()
} finally {
  if (contractFlowId) await setFlowEnabled(contractFlowId, false).catch(() => undefined)
  if (quotationFlowId) await setFlowEnabled(quotationFlowId, false).catch(() => undefined)
  for (const id of [...new Set(createdContractIds)].reverse()) {
    await apiRequest('GET', `/contract/delete/${id}`, undefined, [404]).catch(() => undefined)
  }
  if (userViewId) await apiRequest('GET', `/contract/view/delete/${userViewId}`, undefined, [404]).catch(() => undefined)
  if (quotationId) await apiRequest('GET', `/opportunity/quotation/delete/${quotationId}`, undefined, [404]).catch(() => undefined)
  if (opportunityId) await apiRequest('GET', `/opportunity/delete/${opportunityId}`, undefined, [404]).catch(() => undefined)
  if (productId) await apiRequest('GET', `/product/delete/${productId}`, undefined, [404]).catch(() => undefined)
  await restoreFlow(contractFlowId, contractFlowCreated, contractFlowRestore).catch(() => undefined)
  await restoreFlow(quotationFlowId, quotationFlowCreated, quotationFlowRestore).catch(() => undefined)
}
