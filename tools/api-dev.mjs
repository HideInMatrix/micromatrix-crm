import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readdir, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

const POLL_INTERVAL_MS = 700
const STOP_TIMEOUT_MS = 5_000
const API_ROOT = process.cwd()
const REPO_ROOT = resolve(API_ROOT, '../..')
const CONTRACT_PATH = resolve(API_ROOT, 'src/prisma/contract.prisma')
const WATCH_ROOTS = [
  { dir: resolve(API_ROOT, 'src'), extensions: new Set(['.ts', '.prisma']) },
  { dir: resolve(REPO_ROOT, 'packages/shared/dist'), extensions: new Set(['.ts', '.js']) },
]
const WATCH_FILES = [
  resolve(API_ROOT, 'tsconfig.json'),
  resolve(API_ROOT, 'tsconfig.build.json'),
  resolve(API_ROOT, 'prisma.config.ts'),
  resolve(API_ROOT, 'package.json'),
  resolve(API_ROOT, '.env'),
]

let apiProcess = null
let activeTask = null
let shuttingDown = false
let lastContractStamp = null
const expectedApiExit = new WeakSet()

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms)
  })
}

function writeLines(stream, prefix) {
  let buffered = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffered += chunk
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) process.stdout.write(`${prefix}${line}\n`)
  })
  stream.on('end', () => {
    if (!buffered) return
    process.stdout.write(`${prefix}${buffered}\n`)
    buffered = ''
  })
}

async function fileStamp(path) {
  try {
    const info = await stat(path)
    return `${info.mtimeMs}:${info.size}`
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

async function collectFiles(dir, extensions, output) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(path, extensions, output)
      continue
    }
    if (!entry.isFile() || !extensions.has(extname(entry.name))) continue
    output.push(path)
  }
}

async function snapshotInputs() {
  const files = [...WATCH_FILES]
  for (const root of WATCH_ROOTS) {
    await collectFiles(root.dir, root.extensions, files)
  }

  files.sort()
  const parts = []
  for (const path of files) {
    parts.push(`${relative(REPO_ROOT, path)}:${await fileStamp(path)}`)
  }
  return parts.join('\n')
}

async function runTask(label, command, args) {
  if (shuttingDown) return false
  const child = spawn(command, args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeTask = child
  writeLines(child.stdout, `[${label}] `)
  writeLines(child.stderr, `[${label}] `)

  const [code, signal] = await once(child, 'exit')
  if (activeTask === child) activeTask = null
  if (shuttingDown) return false
  if (code === 0) return true

  process.stderr.write(`[${label}] exited with ${signal ?? `code ${code}`}\n`)
  return false
}

async function stopApi() {
  const child = apiProcess
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    apiProcess = null
    return
  }

  expectedApiExit.add(child)
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const result = await Promise.race([
    exited.then(() => 'exit'),
    delay(STOP_TIMEOUT_MS).then(() => 'timeout'),
  ])
  if (result === 'timeout' && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
  if (apiProcess === child) apiProcess = null
}

function startApi() {
  if (shuttingDown) return
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  apiProcess = child
  writeLines(child.stdout, '[api] ')
  writeLines(child.stderr, '[api] ')
  child.on('exit', (code, signal) => {
    if (apiProcess === child) apiProcess = null
    if (!shuttingDown && !expectedApiExit.has(child) && code !== 0) {
      process.stderr.write(`[api] exited with ${signal ?? `code ${code}`}\n`)
    }
  })
}

async function restartApi() {
  await stopApi()
  startApi()
}

async function compileUntilStable({ forceContractEmit = false } = {}) {
  let mustEmitContract = forceContractEmit

  while (!shuttingDown) {
    const contractStamp = await fileStamp(CONTRACT_PATH)
    if (mustEmitContract || contractStamp !== lastContractStamp) {
      if (!(await runTask('prisma', 'prisma', ['contract', 'emit']))) return false
      lastContractStamp = await fileStamp(CONTRACT_PATH)
      mustEmitContract = false
    }

    const before = await snapshotInputs()
    const compiled = await runTask('tsc', 'tsc', ['-p', 'tsconfig.build.json'])
    const after = await snapshotInputs()

    if (after !== before) continue
    if (!compiled) return false

    await restartApi()
    return true
  }
  return false
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  const task = activeTask
  if (task && task.exitCode === null && task.signalCode === null) task.kill(signal)
  await stopApi()
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0))
  })
}

async function main() {
  await compileUntilStable({ forceContractEmit: true })
  let previous = await snapshotInputs()

  while (!shuttingDown) {
    await delay(POLL_INTERVAL_MS)
    const current = await snapshotInputs()
    if (current === previous) continue

    await compileUntilStable()
    previous = await snapshotInputs()
  }
}

void main().catch((error) => {
  process.stderr.write(
    `[dev] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  void shutdown('SIGTERM').finally(() => process.exit(1))
})
