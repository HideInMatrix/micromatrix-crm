import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { PrismaPg } = requireFromApi('@prisma/adapter-pg')
const { PrismaClient } = requireFromApi('./dist/generated/prisma/client.js')
const migrationsRoot = new URL('../apps/api/prisma/migrations/', import.meta.url)
const contractMigrationName = '20260829133000_w363_contract_direct_models'

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8')
  const line = envFile.split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (!line) throw new Error('W3.6.3 upgrade smoke 需要 DATABASE_URL')
  return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

async function client(connectionString) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

async function scalar(prisma, sql) {
  const rows = await prisma.$queryRawUnsafe(sql)
  return Number(rows[0]?.value ?? 0)
}

function id() {
  return randomUUID().replaceAll('-', '').slice(0, 32)
}

const source = new URL(resolveDatabaseUrl())
const database = `w363_contract_upgrade_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const target = new URL(source)
target.pathname = `/${database}`
const managementUrl = new URL(source)
managementUrl.pathname = '/postgres'

const migrationNames = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
const contractMigrationIndex = migrationNames.indexOf(contractMigrationName)
if (contractMigrationIndex !== 46) {
  throw new Error(`W3.6.3 前置 migration 数量异常：${contractMigrationIndex}，预期 46`)
}
const baselineMigrations = migrationNames.slice(0, contractMigrationIndex)
const contractMigrationSql = readFileSync(
  new URL(`${contractMigrationName}/migration.sql`, migrationsRoot),
  'utf8',
)

let management
let isolated
try {
  console.log(`W3.6.3 合同 46→47 upgrade smoke: ${database}`)
  management = await client(managementUrl.toString())
  await management.$executeRawUnsafe(`CREATE DATABASE "${database}"`)
  isolated = await client(target.toString())

  for (const migrationName of baselineMigrations) {
    const sql = readFileSync(new URL(`${migrationName}/migration.sql`, migrationsRoot), 'utf8')
    await isolated.$executeRawUnsafe(sql)
  }

  const legacyTablesBefore = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN ('contracts','contract_items')`,
  )
  const directTablesBefore = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN
       ('contract','contract_field','contract_field_blob','contract_snapshot','contract_stage_config')`,
  )
  if (legacyTablesBefore !== 2 || directTablesBefore !== 0) {
    throw new Error(`46 基线 schema 异常：legacy=${legacyTablesBefore}/2 direct=${directTablesBefore}/0`)
  }

  const organizationId = id()
  const userId = id()
  const customerId = id()
  const productId = id()
  const formId = id()
  const contractId = id()
  const itemId = id()
  const now = Date.now()

  await isolated.$executeRawUnsafe(`
    INSERT INTO "customer" (
      "id", "name", "owner", "create_time", "update_time", "create_user", "update_user",
      "in_shared_pool", "organization_id"
    ) VALUES (
      '${customerId}', 'W363 Upgrade Customer', '${userId}', ${now}, ${now}, '${userId}', '${userId}', false, '${organizationId}'
    );

    INSERT INTO "product" (
      "id", "name", "price", "status", "pos", "organization_id",
      "create_time", "update_time", "create_user", "update_user"
    ) VALUES (
      '${productId}', 'W363 Upgrade Product', 128.50, '1', 1, '${organizationId}',
      ${now}, ${now}, '${userId}', '${userId}'
    );

    INSERT INTO "sys_module_form" (
      "id", "form_key", "organization_id", "create_time", "update_time", "create_user", "update_user"
    ) VALUES (
      '${formId}', 'contract', '${organizationId}', ${now}, ${now}, '${userId}', '${userId}'
    );

    INSERT INTO "contracts" (
      "id", "tenantId", "code", "name", "customerId", "amount", "status",
      "startAt", "endAt", "ownerId", "customData", "createdAt", "updatedAt", "approvalStatus"
    ) VALUES (
      '${contractId}', '${organizationId}', 'W363-UPGRADE-001', 'W363 Upgrade Contract', '${customerId}', 257.00,
      'EXECUTING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 day', '${userId}', '{}'::jsonb,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'APPROVED'
    );

    INSERT INTO "contract_items" (
      "id", "contractId", "productId", "productName", "quantity", "unitPrice", "discount", "amount", "sort"
    ) VALUES (
      '${itemId}', '${contractId}', '${productId}', 'W363 Upgrade Product', 2, 128.50, 100, 257.00, 0
    );
  `)

  const legacyContracts = await scalar(isolated, 'SELECT COUNT(*)::int AS value FROM "contracts"')
  const legacyItems = await scalar(isolated, 'SELECT COUNT(*)::int AS value FROM "contract_items"')
  if (legacyContracts !== 1 || legacyItems !== 1) {
    throw new Error(`46 基线夹具异常：contracts=${legacyContracts}, items=${legacyItems}`)
  }

  await isolated.$executeRawUnsafe(contractMigrationSql)

  const directContracts = await scalar(isolated, 'SELECT COUNT(*)::int AS value FROM "contract"')
  const directTables = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN
       ('contract','contract_field','contract_field_blob','contract_snapshot','contract_stage_config')`,
  )
  const legacyTables = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN ('contracts','contract_items')`,
  )
  const snapshots = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value FROM "contract_snapshot" WHERE "contract_id"='${contractId}'`,
  )
  const productCells = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value FROM "contract_field" f
     JOIN "sys_module_field" mf ON mf."id" = f."field_id"
     WHERE f."resource_id"='${contractId}' AND f."ref_sub_id" IS NOT NULL
       AND mf."internal_key" IN ('product','productAmount','productNumber','sumAmount')`,
  )
  const stages = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value FROM "contract_stage_config" WHERE "organization_id"='${organizationId}'`,
  )
  const migratedExecutingStage = await scalar(
    isolated,
    `SELECT COUNT(*)::int AS value
     FROM "contract" c JOIN "contract_stage_config" s ON s."id"=c."stage"
     WHERE c."id"='${contractId}' AND s."name"='履行中' AND c."approved"=true`,
  )

  if (directContracts !== legacyContracts) throw new Error(`合同数量不守恒：${legacyContracts} -> ${directContracts}`)
  if (directTables !== 5) throw new Error(`direct tables 不完整：${directTables}/5`)
  if (legacyTables !== 0) throw new Error(`旧合同表仍存在：${legacyTables}`)
  if (snapshots !== 1) throw new Error(`合同快照数量异常：${snapshots}/1`)
  if (productCells !== 4) throw new Error(`旧 ContractItem products 单元迁移异常：${productCells}/4`)
  if (stages !== 7) throw new Error(`默认合同阶段异常：${stages}/7`)
  if (migratedExecutingStage !== 1) throw new Error('旧 EXECUTING 合同未迁入真实“履行中”阶段或 approved 未保留')

  console.log('✓ baseline migrations: 46')
  console.log('✓ legacy contracts/items: 1/1')
  console.log('✓ migrated contracts: 1/1')
  console.log('✓ products SUB_TABLE cells: 4/4')
  console.log('✓ snapshots: 1/1')
  console.log('✓ contract stages: 7/7')
  console.log('✓ EXECUTING → 履行中 + approved=true')
  console.log('✓ direct tables: 5/5; legacy tables: 0/2')
} finally {
  if (isolated) await isolated.$disconnect().catch(() => undefined)
  if (!management) management = await client(managementUrl.toString())
  await management.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
  ).catch(() => undefined)
  await management.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`).catch(() => undefined)
  await management.$disconnect().catch(() => undefined)
}
