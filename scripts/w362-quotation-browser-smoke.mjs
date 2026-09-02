import { explicitApprovalFlowRequest } from './helpers/approval-flow-graph.mjs'

const webBase = process.env.WEB_BASE ?? 'http://127.0.0.1:5173'
const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:3000/api'
const debugBase = process.env.CHROME_DEBUG_URL ?? 'http://127.0.0.1:9223'

let passed = 0
let failed = 0
let token = ''
let flowId = ''
let opportunityId = ''
let productId = ''
let quotationId = ''

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
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = raw
  }
  return { response, data, raw }
}

async function loadPageTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const targets = await fetch(`${debugBase}/json/list`).then((r) => r.json())
      const page = targets.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // Chrome may be starting.
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
        this.responses.push({
          status: msg.params.response.status,
          url: msg.params.response.url,
          requestId: msg.params.requestId,
        })
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
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? '浏览器表达式执行失败')
    }
    return result.result?.value
  }

  async navigate(path) {
    const targetUrl = `${webBase}${path}`
    const marker = `w362-${Date.now()}-${Math.random()}`
    await this.evaluate(`window.__w362NavigationMarker = ${JSON.stringify(marker)}; true`)
    await this.send('Page.navigate', { url: targetUrl })
    await this.waitFor(
      `location.href === ${JSON.stringify(targetUrl)} && window.__w362NavigationMarker !== ${JSON.stringify(marker)} && document.readyState !== 'loading' && document.body !== null`,
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

async function clickText(cdp, text, selector = 'button') {
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

async function main() {
  console.log('\nW3.6.2 报价 Browser Smoke')
  const login = await apiRequest('POST', '/auth/login', {
    email: 'admin@demo.com',
    password: 'admin123',
  })
  if (!login.response.ok || !login.data?.accessToken) {
    throw new Error(`管理员登录失败: ${login.response.status}`)
  }
  token = login.data.accessToken
  const userId = login.data.user.id
  const suffix = Date.now().toString(36)
  const prefix = `W362 Browser ${suffix}`
  const quoteName = `${prefix} Quote`
  const editedName = `${prefix} Edited`

  const flowBody = {
    formType: 'quotation',
    name: `${prefix} Flow`,
    enabled: true,
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
    createNodes: [
      {
        name: '管理员审批',
        approverType: 'USER',
        approverIds: [userId],
        ccUserIds: [],
        mode: 'ANY',
      },
    ],
  }
  const flow = await apiRequest('POST', '/approvals/flows', flowBody)
  if (!flow.response.ok || !flow.data?.id) {
    throw new Error(`创建报价审批流失败: ${flow.response.status} ${flow.raw}`)
  }
  flowId = flow.data.id

  const product = await apiRequest('POST', '/product/add', {
    name: `${prefix} Product`,
    price: 88.8,
    status: '1',
  })
  if (!product.response.ok || !product.data?.id) {
    throw new Error(`创建产品失败: ${product.response.status} ${product.raw}`)
  }
  productId = product.data.id

  const opportunity = await apiRequest('POST', '/opportunity/add', {
    name: `${prefix} Opportunity`,
    amount: 888,
    owner: userId,
    products: [productId],
  })
  if (!opportunity.response.ok || !opportunity.data?.id) {
    throw new Error(`创建商机失败: ${opportunity.response.status} ${opportunity.raw}`)
  }
  opportunityId = opportunity.data.id

  const form = await apiRequest('GET', '/opportunity/quotation/module/form')
  if (!form.response.ok) throw new Error(`读取报价表单失败: ${form.response.status}`)
  const quote = await apiRequest('POST', '/opportunity/quotation/add', {
    name: quoteName,
    opportunityId,
    untilTime: Date.now() + 7 * 86_400_000,
    amount: 99.9,
    moduleFields: [],
    moduleFormConfigDTO: form.data,
    products: [
      {
        product: productId,
        productAmount: 88.8,
        discount: 100,
        tax: 6,
        amount: 99.9,
      },
    ],
  })
  if (!quote.response.ok || !quote.data?.id) {
    throw new Error(`创建报价失败: ${quote.response.status} ${quote.raw}`)
  }
  quotationId = quote.data.id
  check('CREATE 审批报价准备为 APPROVING', quote.data.approvalStatus === 'APPROVING')

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
      const button=[...document.querySelectorAll('button')].find((item)=>item.textContent?.replace(/\\s/g,'').includes('登录'))
      button?.click(); return Boolean(button)
    })()`)
    await cdp.waitFor(`location.pathname === '/dashboard'`, 10000, '登录成功')

    await cdp.navigate('/quotes')
    await cdp.waitFor(textIncludes('新建报价'), 10000, '报价页面')
    await cdp.waitFor(textIncludes(quoteName), 10000, '报价列表')
    check(
      '报价列表使用 Cordys POST /opportunity/quotation/page',
      cdp.requestCount('/api/opportunity/quotation/page', 'POST') >= 1,
    )
    check(
      '报价 User View 使用 Cordys /opportunity/quotation/view/list',
      cdp.requestCount('/api/opportunity/quotation/view/list', 'GET') >= 1,
    )
    check(
      '列表展示审批状态与作废状态',
      await cdp.evaluate(`document.body.innerText.includes('审批中') && document.body.innerText.includes('正常')`),
    )
    check(
      '审批中报价展示通过/驳回/撤回动作',
      await cdp.evaluate(`['通过','驳回','撤回'].every((x)=>document.body.innerText.includes(x))`),
    )

    await cdp.navigate(`/quotes?id=${quotationId}`)
    try {
      await cdp.waitFor(textIncludes('审批冻结快照'), 10000, '报价详情深链')
    } catch (error) {
      console.error('  深链诊断 body:', (await cdp.evaluate('document.body?.innerText ?? ""')).slice(0, 3000))
      console.error(
        '  深链诊断 responses:',
        cdp.responses
          .filter((item) => item.url.includes('/api/opportunity/quotation/'))
          .slice(-20),
      )
      throw error
    }
    check(
      '报价深链打开真实详情 Drawer',
      await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(quoteName)}) && document.body.innerText.includes('产品信息')`),
    )
    check(
      '详情读取 GET /opportunity/quotation/get/:id',
      cdp.requestCount(`/api/opportunity/quotation/get/${quotationId}`, 'GET') >= 1,
    )
    check(
      '详情读取审批冻结快照',
      cdp.requestCount(`/api/opportunity/quotation/get/snapshot/${quotationId}`, 'GET') >= 1,
    )

    await cdp.navigate('/quotes')
    await cdp.waitFor(textIncludes(quoteName), 10000, '报价列表重载')
    check('UI 可直接审批报价', await clickRowAction(cdp, quoteName, '通过'))
    await cdp.waitFor(textIncludes('审批通过'), 10000, '审批通过刷新')
    check('审批通过后展示编辑动作', await clickRowAction(cdp, quoteName, '编辑'))
    await cdp.waitFor(textIncludes('编辑报价'), 5000, '编辑报价 Drawer')
    const changed = await cdp.evaluate(`(() => {
      const drawer=[...document.querySelectorAll('.el-drawer')].find((el)=>el.textContent?.includes('编辑报价'))
      const input=drawer?.querySelector('input')
      if(!input) return false
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set
      setter?.call(input,${JSON.stringify(editedName)})
      input.dispatchEvent(new Event('input',{bubbles:true}))
      return true
    })()`)
    check('报价编辑 Drawer 可修改名称', changed)
    const updateBefore = cdp.requestCount('/api/opportunity/quotation/update', 'POST')
    check('报价编辑 Drawer 可提交保存', await clickText(cdp, '保存'))
    await cdp.waitFor(
      `![...document.querySelectorAll('.el-drawer')].some((el)=>el.textContent?.includes('编辑报价') && el.getBoundingClientRect().width>0)`,
      10000,
      '编辑报价 Drawer 关闭',
    )
    const updateStart = Date.now()
    while (Date.now() - updateStart < 10000 && cdp.requestCount('/api/opportunity/quotation/update', 'POST') <= updateBefore) {
      await sleep(100)
    }
    check(
      '编辑报价保存调用 Cordys POST /opportunity/quotation/update',
      cdp.requestCount('/api/opportunity/quotation/update', 'POST') > updateBefore,
    )
    await cdp.waitFor(
      `(() => {
        const row=[...document.querySelectorAll('.el-table__row')].find((el)=>el.textContent?.includes(${JSON.stringify(editedName)}))
        return Boolean(row) && row.textContent?.includes('审批中') && row.textContent?.includes('撤回')
      })()`,
      10000,
      '报价更新审批刷新',
    )
    check(
      'UPDATE 审批后重新进入审批中',
      true,
    )
    check('UPDATE 审批可撤回', await clickRowAction(cdp, editedName, '撤回'))
    await cdp.waitFor(textIncludes('撤回审批'), 5000, '撤回确认')
    const confirmed = (await clickText(cdp, '确定')) || (await clickText(cdp, '确认'))
    check('撤回确认框可确认', confirmed)
    await cdp.waitFor(textIncludes(quoteName), 10000, '撤回后快照回滚')
    const afterRevoke = await apiRequest('GET', `/opportunity/quotation/get/${quotationId}`)
    check(
      'UPDATE 撤回后后端恢复编辑前报价名称',
      afterRevoke.response.ok && afterRevoke.data?.name === quoteName && afterRevoke.data?.approvalStatus === 'REVOKED',
      afterRevoke.raw,
    )
    check(
      'UPDATE 撤回后 UI 恢复编辑前报价名称',
      await cdp.evaluate(`(() => {
        const row=[...document.querySelectorAll('.el-table__row')].find((el)=>el.textContent?.includes(${JSON.stringify(quoteName)}))
        return Boolean(row) && !row.textContent?.includes(${JSON.stringify(editedName)})
      })()`),
    )

    await cdp.evaluate(`(() => {
      window.__w362PdfHtml=''
      window.open=()=>({ document:{ write:(html)=>{window.__w362PdfHtml=html}, close:()=>{} } })
      return true
    })()`)
    const downloadBefore = cdp.requestCount(`/api/opportunity/quotation/download/${quotationId}`, 'GET')
    check('报价导出 PDF 动作可点击', await clickRowAction(cdp, quoteName, '导出 PDF'))
    await cdp.waitFor(`window.__w362PdfHtml?.includes(${JSON.stringify(quoteName)}) === true`, 5000, 'PDF HTML 生成')
    check(
      'PDF 使用冻结快照生成产品表格',
      await cdp.evaluate(`window.__w362PdfHtml.includes('产品定价') && window.__w362PdfHtml.includes('税点')`),
    )
    check(
      'PDF 下载操作写入 Cordys download 日志 API',
      cdp.requestCount(`/api/opportunity/quotation/download/${quotationId}`, 'GET') > downloadBefore,
    )

    check('报价→合同入口可点击', await clickRowAction(cdp, quoteName, '创建合同'))
    let contractRouteReady = false
    try {
      await cdp.waitFor(
        `location.pathname === '/contracts' && new URLSearchParams(location.search).get('fromQuote') === ${JSON.stringify(quotationId)}`,
        10000,
        '报价到合同路由',
      )
      contractRouteReady = true
    } catch {
      console.error('  报价→合同诊断 href:', await cdp.evaluate('location.href'))
      console.error('  报价→合同诊断 body:', (await cdp.evaluate('document.body?.innerText ?? ""')).slice(0, 3000))
    }
    check('报价→合同跳转携带 fromQuote', contractRouteReady)
    if (contractRouteReady) {
      await cdp.waitFor(
        `(() => {
          const dialogs=[...document.querySelectorAll('.el-dialog')].filter((el)=>el.getBoundingClientRect().width>0)
          return dialogs.some((el)=>el.textContent?.includes('从已审批报价创建') && el.textContent?.includes(${JSON.stringify(quoteName)}))
        })()`,
        10000,
        '报价到合同创建弹窗',
      )
      check(
        '报价→合同深链预选报价',
        await cdp.evaluate(`(() => {
          const dialog=[...document.querySelectorAll('.el-dialog')].find((el)=>el.getBoundingClientRect().width>0 && el.textContent?.includes('从已审批报价创建'))
          return Boolean(dialog?.textContent?.includes(${JSON.stringify(quoteName)}) && dialog?.textContent?.includes('留空则复制报价明细'))
        })()`),
      )
    }

    await cdp.navigate(`/quotes?fromOpportunity=${opportunityId}`)
    let linkedDrawerOpen = false
    try {
      await cdp.waitFor(
        `[...document.querySelectorAll('.el-drawer')].some((el)=>el.textContent?.includes('新建报价') && el.textContent?.includes('产品信息'))`,
        10000,
        '商机→报价新建 Drawer',
      )
      linkedDrawerOpen = true
    } catch {
      linkedDrawerOpen = false
    }
    const linkedNameReady = await cdp.evaluate(
      `[...document.querySelectorAll('.el-drawer input')].some((el)=>el.value===${JSON.stringify(`${prefix} Opportunity-报价`)})`,
    )
    check('商机→报价深链自动打开新建 Drawer', linkedDrawerOpen)
    check('商机→报价深链预填报价名称', linkedNameReady)
    if (!linkedDrawerOpen || !linkedNameReady) {
      console.error('  商机→报价深链诊断 href:', await cdp.evaluate('location.href'))
      console.error('  商机→报价深链诊断 body:', (await cdp.evaluate('document.body?.innerText ?? ""')).slice(0, 3000))
      console.error(
        '  商机→报价深链诊断 responses:',
        cdp.responses.filter((item) => item.url.includes(`/api/opportunity/get/${opportunityId}`)).slice(-10),
      )
    }

    const api5xx = cdp.responses.filter((item) => item.status >= 500 && item.url.includes('/api/'))
    check(
      '报价 Browser Smoke 无 API 5xx',
      api5xx.length === 0,
      api5xx.map((item) => `${item.status} ${item.url}`).join(', '),
    )
    check(
      '报价 Browser Smoke 无 Runtime exception',
      cdp.exceptions.length === 0,
      cdp.exceptions.join(', '),
    )
  } finally {
    cdp.close()
  }

  console.log(`\n结果：${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

try {
  await main()
} finally {
  if (flowId) await apiRequest('PATCH', `/approvals/flows/${flowId}/enabled`, { enabled: false })
  if (quotationId) await apiRequest('GET', `/opportunity/quotation/delete/${quotationId}`)
  if (opportunityId) await apiRequest('GET', `/opportunity/delete/${opportunityId}`)
  if (productId) await apiRequest('GET', `/product/delete/${productId}`)
  if (flowId) await apiRequest('DELETE', `/approvals/flows/${flowId}`)
}
