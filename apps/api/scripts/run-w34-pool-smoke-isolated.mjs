import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const source = new URL(process.env.DATABASE_URL)
const database = `w34_pool_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const target = new URL(source)
target.pathname = `/${database}`
const postgresEnv = {
  ...process.env,
  PGHOST: source.hostname,
  PGPORT: source.port || '5432',
  PGUSER: decodeURIComponent(source.username),
  PGPASSWORD: decodeURIComponent(source.password),
}

function run(command, args, env = postgresEnv) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败，退出码 ${result.status}`)
}

try {
  run('createdb', [database])
  run('./node_modules/.bin/prisma', ['migrate', 'deploy'], {
    ...process.env,
    DATABASE_URL: target.toString(),
  })
  run('node', ['--import', 'tsx', 'scripts/w34-pool-repositories-smoke.ts'], {
    ...process.env,
    DATABASE_URL: target.toString(),
  })
} finally {
  const result = spawnSync('dropdb', ['--if-exists', database], {
    env: postgresEnv,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exitCode = result.status ?? 1
}
