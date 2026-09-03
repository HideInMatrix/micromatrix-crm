import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { Queue } from 'bullmq'

const pgName = `mmx-async001-pg-${process.pid}`
const redisName = `mmx-async001-redis-${process.pid}`
const password = 'async001-smoke'
const apiPort = 3317
const apiBase = `http://127.0.0.1:${apiPort}/api`
const uploadDir = `/tmp/mmx-async001-uploads-${process.pid}`
const apiRoot = new URL('..', import.meta.url).pathname
const pnpmExecPath = process.env['npm_execpath']
const dockerBin =
  process.env['DOCKER_BIN'] ??
  (existsSync('/usr/local/bin/docker') ? '/usr/local/bin/docker' : 'docker')

let api: ChildProcess | null = null
let worker: ChildProcess | null = null
let queue: Queue<{ taskId: string }> | null = null

function docker(args: string[], allowFailure = false) {
  const result = spawnSync(dockerBin, args, { encoding: 'utf8' })
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `docker ${args.join(' ')} failed: ${result.error?.message || result.stderr || result.stdout}`,
    )
  }
  return (result.stdout ?? '').trim()
}

function pnpm(args: string[], env: NodeJS.ProcessEnv) {
  if (!pnpmExecPath) throw new Error('npm_execpath 缺失，请通过 pnpm smoke:async-export 运行')
  const result = spawnSync(process.execPath, [pnpmExecPath, ...args], {
    cwd: apiRoot,
    env,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  }
}

function hostPort(container: string, port: number): number {
  const value = docker(['port', container, `${port}/tcp`])
  const match = value.match(/:(\d+)$/)
  if (!match) throw new Error(`无法解析 ${container}:${port} 宿主机端口: ${value}`)
  return Number(match[1])
}

async function waitUntil<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    try {
      last = await read()
      if (accept(last)) return last
    } catch {
      // 容器或 Nest runtime 启动中的短暂连接失败属于预期。
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`等待超时: ${label}; last=${String(last)}`)
}

async function stop(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3_000))])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

function startRuntime(entry: 'main.js' | 'worker.js', env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [`dist/${entry}`], {
    cwd: apiRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk) => (output += String(chunk)))
  child.stderr?.on('data', (chunk) => (output += String(chunk)))
  return { child, output: () => output }
}

async function login() {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'admin123' }),
  })
  assert.equal(response.status, 200)
  const body = (await response.json()) as { accessToken?: string }
  assert.ok(body.accessToken)
  return body.accessToken
}

async function createCustomerExport(token: string, fileName: string) {
  const response = await fetch(`${apiBase}/account/export-all`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ fileName, headList: ['name'] }),
  })
  const body = (await response.json()) as { id?: string; status?: string }
  assert.equal(response.status, 201)
  assert.equal(body.status, 'PENDING')
  assert.ok(body.id)
  return body.id
}

async function taskStatus(container: string, id: string) {
  return docker([
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'default',
    '-Atc',
    `select status||'|'||attempts||'|'||("startedAt" is not null)::text||'|'||("completedAt" is not null)::text from export_tasks where id='${id}'`,
  ])
}

async function main() {
  docker(['rm', '-f', pgName, redisName], true)
  rmSync(uploadDir, { recursive: true, force: true })

  try {
    docker([
      'run',
      '-d',
      '--name',
      pgName,
      '-e',
      'POSTGRES_USER=postgres',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=default',
      '-p',
      '127.0.0.1::5432',
      'postgres:18-alpine',
    ])
    docker([
      'run',
      '-d',
      '--name',
      redisName,
      '-p',
      '127.0.0.1::6379',
      'redis:7-alpine',
      'redis-server',
      '--appendonly',
      'yes',
      '--requirepass',
      password,
    ])

    await waitUntil(
      async () => docker(['exec', pgName, 'pg_isready', '-U', 'postgres', '-d', 'default'], true),
      (value) => value.includes('accepting connections'),
      'PostgreSQL ready',
    )
    await waitUntil(
      async () => docker(['exec', redisName, 'redis-cli', '-a', password, 'ping'], true),
      (value) => value.includes('PONG'),
      'Redis ready',
    )

    const pgPort = hostPort(pgName, 5432)
    const redisPort = hostPort(redisName, 6379)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(apiPort),
      DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${pgPort}/default?schema=public`,
      JWT_ACCESS_SECRET: 'async001_access_secret_please_change_1234567890',
      JWT_REFRESH_SECRET: 'async001_refresh_secret_please_change_1234567890',
      INTEGRATION_CREDENTIALS_KEY: '0123456789abcdef0123456789abcdef',
      UPLOAD_DIR: uploadDir,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(redisPort),
      REDIS_PASSWORD: password,
      REDIS_DB: '0',
      ASYNC_EXPORT_CONCURRENCY: '1',
      WEB_PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
      SWAGGER_ENABLED: 'false',
    }

    pnpm(['exec', 'prisma', 'migrate', 'deploy'], env)
    pnpm(['exec', 'tsx', 'prisma/seed.ts'], { ...env, SEED_MODE: 'bootstrap' })

    const apiRuntime = startRuntime('main.js', env)
    api = apiRuntime.child
    await waitUntil(
      async () => fetch(`${apiBase}/health`).then((response) => response.status),
      (status) => status === 200,
      'API health',
    )
    const token = await login()
    queue = new Queue('export', {
      prefix: 'micromatrix-crm:bull',
      connection: { host: '127.0.0.1', port: redisPort, password },
    })

    const recoveredId = await createCustomerExport(token, 'async001-recovery')
    const waiting = await queue.getJob(recoveredId)
    assert.ok(waiting)
    assert.equal(await waiting.getState(), 'waiting')
    await waiting.remove()
    assert.equal(await queue.getJob(recoveredId), undefined)
    assert.match(await taskStatus(pgName, recoveredId), /^PENDING\|0\|false\|false$/)

    const firstWorker = startRuntime('worker.js', env)
    worker = firstWorker.child
    await waitUntil(
      () => taskStatus(pgName, recoveredId),
      (status) => status.startsWith('SUCCESS|1|true|true'),
      'missing BullMQ job recovery',
    )
    await waitUntil(
      async () => firstWorker.output(),
      (output) => output.includes('recovered=1 kept=0'),
      'worker recovered=1 log',
    )
    const download = await fetch(`${apiBase}/export-tasks/${recoveredId}/download`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(download.status, 200)
    const bytes = Buffer.from(await download.arrayBuffer())
    assert.ok(bytes.length > 100)
    assert.equal(bytes.subarray(0, 4).toString('hex'), '504b0304')

    await stop(worker)
    worker = null
    const restartId = await createCustomerExport(token, 'async001-restart')
    await new Promise((resolve) => setTimeout(resolve, 800))
    assert.match(await taskStatus(pgName, restartId), /^PENDING\|0\|false\|false$/)
    assert.equal(await (await queue.getJob(restartId))?.getState(), 'waiting')

    const secondWorker = startRuntime('worker.js', env)
    worker = secondWorker.child
    await waitUntil(
      () => taskStatus(pgName, restartId),
      (status) => status.startsWith('SUCCESS|1|true|true'),
      'worker restart completion',
    )
    await waitUntil(
      async () => secondWorker.output(),
      (output) => output.includes('recovered=0 kept=1'),
      'worker kept=1 log',
    )

    const health = (await (await fetch(`${apiBase}/health`)).json()) as {
      asyncJobs?: { queue?: { ready?: boolean; workers?: number } }
    }
    assert.equal(health.asyncJobs?.queue?.ready, true)
    assert.ok((health.asyncJobs?.queue?.workers ?? 0) >= 1)

    console.log(
      JSON.stringify(
        {
          migrationsAndBootstrap: true,
          producerReturnsPending: true,
          missingJobRecovered: true,
          xlsxDownloadVerified: true,
          workerStoppedKeepsPending: true,
          workerRestartCompletes: true,
          queueWorkerObservable: true,
        },
        null,
        2,
      ),
    )
  } finally {
    await queue?.close().catch(() => undefined)
    await stop(worker)
    await stop(api)
    docker(['rm', '-f', pgName, redisName], true)
    rmSync(uploadDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
