import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const repoRoot = new URL('../', import.meta.url)
const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.6.3 migration smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

const source = new URL(resolveDatabaseUrl())
const database = `w363_contract_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const target = new URL(source)
target.pathname = `/${database}`
const managementUrl = new URL(source)
managementUrl.pathname = '/postgres'

const nodeBin = new URL('.', `file://${process.execPath}`).pathname
const inheritedPath = process.env.PATH ?? ''
const env = { ...process.env, PATH: `${nodeBin}:${inheritedPath}`, DATABASE_URL: target.toString() }

async function client(connectionString) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

function run(program, args) {
  const result = spawnSync(program, args, { cwd: repoRoot, env, encoding: 'utf8' })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} 失败，退出码 ${result.status}`)
}

async function scalar(prisma, sql) {
  const rows = await prisma.$queryRawUnsafe(sql)
  return Number(rows[0]?.value ?? 0)
}

let management
let isolated
try {
  console.log(`W3.6.3 合同 migration smoke: ${database}`)
  management = await client(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)

  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'prisma', 'migrate', 'deploy'])
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])
  run('pnpm', ['--filter', '@micromatrix/api', 'exec', 'tsx', 'prisma/seed.ts'])

  isolated = await client(target.toString())
  const directTables = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN
       ('contract','contract_field','contract_field_blob','contract_snapshot','contract_stage_config')`,
  )
  if (directTables !== 5) throw new Error(`合同 direct tables 不完整：${directTables}/5`)

  const legacyTables = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN ('contracts','contract_items')`,
  )
  if (legacyTables !== 0) throw new Error(`旧合同表仍存在：${legacyTables}`)

  const migrations = await scalar(isolated, 'SELECT COUNT(*)::int AS value FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
  const stageCount = await scalar(isolated, 'SELECT COUNT(*)::int AS value FROM "contract_stage_config"')
  if (stageCount < 7) throw new Error(`合同默认阶段不足：${stageCount}`)

  console.log(`✓ migrations: ${migrations}`)
  console.log('✓ direct tables: 5/5')
  console.log('✓ legacy tables: 0/2')
  console.log(`✓ contract stages: ${stageCount}`)
  console.log('✓ seed: 2/2')
} finally {
  if (isolated) await isolated.$disconnect().catch(() => undefined)
  if (!management) management = await client(managementUrl.toString())
  await management.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
  ).catch(() => undefined)
  await management.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`).catch(() => undefined)
  await management.$disconnect().catch(() => undefined)
}
