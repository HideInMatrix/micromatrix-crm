import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, request } from 'node:http'
import { existsSync, readFileSync, statSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
type BrowserInput = {
  apiPort: number
  dir: string
  accessToken: string
  refreshToken: string
  batchId: string
  wecomBatchId: string
  checkRetained: () => Promise<void>
  checkDeleted: () => Promise<void>
}
const types: Record<string, string> = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}
export async function runNotificationBrowser(input: BrowserInput) {
  const webRoot = resolve('../web/dist'),
    mobileRoot = resolve('../mobile/dist')
  assert.ok(
    existsSync(join(webRoot, 'index.html')) && existsSync(join(mobileRoot, 'index.html')),
    'Build PC/H5 first',
  )
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/')) {
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: input.apiPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: '127.0.0.1:' + input.apiPort },
        },
        (r) => {
          res.writeHead(r.statusCode ?? 500, r.headers)
          r.pipe(res)
        },
      )
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502)
        res.end()
      })
      res.on('close', () => upstream.destroy())
      req.pipe(upstream)
      return
    }
    if (url.pathname === '/r89-test-bootstrap') {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><title>R89 isolated browser</title>')
      return
    }
    const mobile = url.pathname.startsWith('/mobile/')
    const root = mobile ? mobileRoot : webRoot
    let path = resolve(
      root,
      '.' + decodeURIComponent(mobile ? url.pathname.slice(7) : url.pathname),
    )
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (!existsSync(path) || !statSync(path).isFile()) path = join(root, 'index.html')
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream')
    res.end(readFileSync(path))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const chrome = process.env.R89_CHROME_PATH ?? '/Applications/Chromium.app/Contents/MacOS/Chromium'
  let proc: ChildProcess | undefined
  let socket: WebSocket | undefined
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >()
  let serial = 0
  try {
    assert.ok(existsSync(chrome), 'Set R89_CHROME_PATH to a Chromium executable')
    const profile = join(input.dir, 'browser-profile')
    mkdirSync(profile)
    proc = spawn(
      chrome,
      [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--disable-extensions',
        '--remote-debugging-port=0',
        '--user-data-dir=' + profile,
        '--window-size=1440,1000',
        'about:blank',
      ],
      { stdio: 'ignore' },
    )
    let devPort = ''
    for (let i = 0; i < 100 && !devPort; i++) {
      try {
        devPort = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]!
      } catch {}
      if (!devPort) await sleep(100)
    }
    assert.ok(devPort, 'Chromium debug endpoint not ready')
    const targets = (await (
      await fetch('http://127.0.0.1:' + devPort + '/json/list')
    ).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
    const page = targets.find((t) => t.type === 'page')!
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((r, j) => {
      socket!.addEventListener('open', () => r(), { once: true })
      socket!.addEventListener('error', () => j(Error('CDP open failed')), { once: true })
    })
    socket.addEventListener('message', (event) => {
      const m = JSON.parse(String(event.data))
      const waiter = pending.get(m.id)
      if (!waiter) return
      pending.delete(m.id)
      if (m.error) waiter.reject(Error(m.error.message))
      else waiter.resolve(m.result)
    })
    const call = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((r, j) => {
        const id = ++serial
        pending.set(id, { resolve: r, reject: j })
        socket!.send(JSON.stringify({ id, method, params }))
        const timer = setTimeout(() => {
          if (pending.delete(id)) j(Error('CDP timeout ' + method))
        }, 10000)
        timer.unref()
      })
    const evaluate = async (expression: string) => {
      const r = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails)
        throw Error('Browser JS evaluation failed: ' + r.exceptionDetails.text)
      return r.result.value
    }
    const wait = async (label: string, expr: string) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expr).catch(() => false)) return
        await sleep(150)
      }
      const diagnostic = await evaluate(
        '({url:location.pathname,text:document.body?.innerText?.slice(0,1400)})',
      ).catch(() => ({}))
      throw Error(label + ' failed ' + JSON.stringify(diagnostic))
    }
    const go = async (path: string) => {
      await call('Page.navigate', { url: origin + path })
      await wait(
        'navigation ' + path,
        'location.pathname === ' +
          JSON.stringify(path.split('?')[0]) +
          ' && document.readyState !== "loading"',
      )
    }
    const click = async (label: string, within = 'document') => {
      const expr =
        'Array.from(' +
        within +
        '.querySelectorAll("button")).find(b=>b.textContent.trim() === ' +
        JSON.stringify(label) +
        ')'
      await wait('button ' + label, '!!(' + expr + ')')
      await evaluate(
        '(()=>{const b=' + expr + ';b.scrollIntoView({block:"center"});return true})()',
      )
      await wait(
        'button hit target ' + label,
        '(()=>{const b=' +
          expr +
          ';if(!b||b.disabled)return false;const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&b.contains(hit)})()',
      )
      await sleep(250)
      // Exercise the actual mounted Vue/Element Plus button, only after
      // the hit target is visible and unblocked by the loading mask.
      await evaluate('(()=>{const b=' + expr + ';b.click();return true})()')
    }

    const screenshot = async (name: string) => {
      const data = await call('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(input.dir, name + '.png'), Buffer.from(data.data, 'base64'), {
        mode: 0o600,
      })
    }
    await call('Page.enable')
    await call('Runtime.enable')
    await go('/r89-test-bootstrap')
    await evaluate(
      'localStorage.setItem("mmx_access_token",' +
        JSON.stringify(input.accessToken) +
        ');localStorage.setItem("mmx_refresh_token",' +
        JSON.stringify(input.refreshToken) +
        ');true',
    )
    await go('/system/messages')
    await click('清理去重凭据')
    await wait(
      'cleanup confirmation',
      'document.body.innerText.includes("确认清理去重凭据") && document.body.innerText.includes("1 条")',
    )
    await screenshot('pc-dedup-confirm')
    await click('取消', 'document.querySelector(".el-message-box")')
    await wait(
      'cancel closed',
      'Array.from(document.querySelectorAll(".el-message-box")).every(e=>!e.getClientRects().length||getComputedStyle(e).visibility==="hidden")',
    )
    await input.checkRetained()
    await click('清理去重凭据')
    await wait(
      'second cleanup confirmation',
      'document.body.innerText.includes("确认清理去重凭据")',
    )
    await click('确认清理', 'document.querySelector(".el-message-box")')
    await wait('cleanup success toast', 'document.body.innerText.includes("已清理 1 条去重凭据")')
    await input.checkDeleted()
    await go('/notifications/batches/' + input.batchId)
    await wait(
      'PC detail',
      'document.body.innerText.includes("PRIVATE-FIXTURE") && document.body.innerText.includes("站内通知")',
    )
    assert.equal(await evaluate('document.body.innerText.includes("PRIVATE-FIXTURE")'), true)
    await screenshot('pc-batch-detail')
    await click('刷新明细')
    await wait('PC refreshed', 'document.body.innerText.includes("PRIVATE-FIXTURE")')
    await call('Network.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
    })
    await call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    })
    await go('/mobile/mine/message/batch?id=' + encodeURIComponent(input.wecomBatchId))
    await wait(
      'H5 detail',
      'document.body.innerText.includes("PRIVATE-FIXTURE") && document.body.innerText.includes("企业微信")',
    )
    assert.equal(await evaluate('document.body.innerText.includes("PRIVATE-FIXTURE")'), true)
    await screenshot('h5-batch-detail')
    await click('刷新明细')
    await wait('H5 refreshed', 'document.body.innerText.includes("PRIVATE-FIXTURE")')
    return {
      pcCleanupCancel: 'PASS',
      pcCleanupConfirm: 'PASS',
      pcDetail: 'PASS',
      mobileDetail: 'PASS',
      refresh: 'PASS',
      screenshots: 3,
    }
  } finally {
    socket?.close()
    proc?.kill('SIGTERM')
    await sleep(500)
    if (proc && proc.exitCode === null) proc.kill('SIGKILL')
    rmSync(join(input.dir, 'browser-profile'), { recursive: true, force: true })
    server.closeAllConnections()
    server.close()
  }
}
