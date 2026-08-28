import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const apiPort = Number(process.env.W345_API_PORT ?? 3101)
const webPort = Number(process.env.W345_WEB_PORT ?? 5176)
const repoRoot = new URL('../', import.meta.url)
const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`)
  }
}

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.4.5 空库验收需要 DATABASE_URL')
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w345_empty_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const target = new URL(source)
target.pathname = `/${database}`

const managementUrl = new URL(source)
managementUrl.pathname = '/postgres'

async function managementSql(sql) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: managementUrl.toString() }),
  })
  try {
    await prisma.$executeRawUnsafe(sql)
  } finally {
    await prisma.$disconnect()
  }
}

function run(program, args, env = process.env) {
  const result = spawnSync(program, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} 执行失败，退出码 ${result.status}`)
  }
}

async function waitFor(url, label, timeoutMs = 30_000) {
  const startedAt = Date.now()
  let lastError = ''
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`${label} 启动超时${lastError ? `：${lastError}` : ''}`)
}

async function jsonRequest(base, method, path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    // empty/non-json response
  }
  return { response, data }
}

function start(program, args, env, cwd = repoRoot) {
  return spawn(program, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function stop(child) {
  if (!child || child.killed) return
  child.kill('SIGTERM')
}

let apiProcess
let webProcess

try {
  console.log('\nW3.4.5 隔离空库最终验收')
  await managementSql(`CREATE DATABASE "${database}"`)

  const isolatedEnv = { ...process.env, DATABASE_URL: target.toString() }
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'prisma', 'migrate', 'deploy'], isolatedEnv)
  check('隔离空库可从零应用全部 Prisma migration', true)

  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'], isolatedEnv)
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'], isolatedEnv)
  check('Seed 可连续执行两次且保持幂等', true)

  run(
    'pnpm',
    [
      '--filter',
      '@micromatrix/api',
      'exec',
      'node',
      '--import',
      'tsx',
      'scripts/w34-seed-empty-db-audit.ts',
    ],
    isolatedEnv,
  )
  check('目标直表、关键索引、Seed 样例与旧表删除审计通过', true)

  apiProcess = start(
    'node',
    ['dist/main.js'],
    {
      ...isolatedEnv,
      PORT: String(apiPort),
      SWAGGER_ENABLED: 'false',
    },
    new URL('../apps/api/', import.meta.url),
  )
  apiProcess.stdout?.on('data', (chunk) => process.stdout.write(`  [isolated-api] ${chunk}`))
  apiProcess.stderr?.on('data', (chunk) => process.stderr.write(`  [isolated-api] ${chunk}`))
  await waitFor(`http://127.0.0.1:${apiPort}/api/health`, '隔离 API')
  check('隔离数据库上的 API 可正常启动', true)

  webProcess = start(
    'pnpm',
    ['--filter', '@micromatrix/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(webPort)],
    {
      ...process.env,
      API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
    },
  )
  webProcess.stdout?.on('data', (chunk) => process.stdout.write(`  [isolated-web] ${chunk}`))
  webProcess.stderr?.on('data', (chunk) => process.stderr.write(`  [isolated-web] ${chunk}`))
  const webResponse = await waitFor(`http://127.0.0.1:${webPort}/login`, '隔离 Web')
  const webHtml = await webResponse.text()
  check('Web 可指向隔离 API 启动并返回 SPA', webHtml.includes('<div id="app"></div>'))

  const webApiBase = `http://127.0.0.1:${webPort}/api`
  const login = await jsonRequest(webApiBase, 'POST', '/auth/login', undefined, {
    email: 'admin@demo.com',
    password: 'admin123',
  })
  check(
    'Web runtime proxy 可登录隔离 Seed 管理员',
    login.response.ok && Boolean(login.data?.accessToken),
    JSON.stringify(login.data),
  )

  if (!login.data?.accessToken) throw new Error('隔离管理员登录失败，无法继续 API 验收')
  const token = login.data.accessToken

  const targets = [
    ['POST', '/lead/page', { current: 1, pageSize: 10 }],
    ['POST', '/account/page', { current: 1, pageSize: 10 }],
    ['POST', '/dashboard/page', { current: 1, pageSize: 10 }],
    ['GET', '/module-configs'],
  ]
  for (const [method, path, body] of targets) {
    const result = await jsonRequest(webApiBase, method, path, token, body)
    check(`目标 API ${path} 在空库 Seed 后真实可用`, result.response.ok, `HTTP ${result.response.status}`)
  }

  const removedApis = [
    ['GET', '/leads'],
    ['GET', '/customers'],
    ['GET', '/contacts'],
    ['GET', '/dashboard/summary'],
  ]
  for (const [method, path] of removedApis) {
    const result = await jsonRequest(webApiBase, method, path, token)
    check(`旧 API ${path} 已移除`, result.response.status === 404, `HTTP ${result.response.status}`)
  }
} catch (error) {
  failed += 1
  console.error(`  ✗ 隔离空库验收执行异常：${error instanceof Error ? error.stack : error}`)
} finally {
  stop(webProcess)
  stop(apiProcess)
  await new Promise((resolve) => setTimeout(resolve, 500))
  try {
    await managementSql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
  } catch (error) {
    failed += 1
    console.error(
      `  ✗ 临时数据库 ${database} 清理失败：${error instanceof Error ? error.message : error}`,
    )
  }
}

console.log(`\n结果：${passed} 通过, ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
