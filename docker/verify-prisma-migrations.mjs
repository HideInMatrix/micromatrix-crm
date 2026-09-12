import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = resolve(rootDir, 'apps/api/prisma/migrations')
const immutableMigrations = new Map([
  [
    '20260905084900_baseline',
    '165aa235f931beeb5f6224488867e4c32af7e9b3e7bb6af7f9c8cc935678686b',
  ],
  [
    '20260911153000_lark_provider_schema',
    'de87c993988438b1491d6284eed7205a7a9f9f8e160e7852ea68a3117a517516',
  ],
])

const fail = (message) => {
  console.error(`[prisma-migrations] ${message}`)
  process.exit(1)
}

for (const [migrationName, expectedSha256] of immutableMigrations) {
  const migrationPath = resolve(migrationsDir, migrationName, 'migration.sql')
  if (!existsSync(migrationPath)) {
    fail(`published migration is missing: ${migrationName}`)
  }

  const actualSha256 = createHash('sha256').update(readFileSync(migrationPath)).digest('hex')
  if (actualSha256 !== expectedSha256) {
    fail(`published migration was modified: ${migrationName}. Add a new migration instead.`)
  }
}

const migrationDirectories = readdirSync(migrationsDir)
  .map((name) => ({ name, path: resolve(migrationsDir, name) }))
  .filter(({ path }) => statSync(path).isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))

if (migrationDirectories.length === 0) {
  fail('no Prisma migrations were found')
}

for (const migration of migrationDirectories) {
  if (!/^\d{14}_[a-z0-9][a-z0-9_-]*$/i.test(migration.name)) {
    fail(`invalid migration directory name: ${migration.name}`)
  }

  if (!existsSync(resolve(migration.path, 'migration.sql'))) {
    fail(`migration.sql is missing from ${migration.name}`)
  }
}

console.log(
  `[prisma-migrations] verified ${migrationDirectories.length} migrations; ${immutableMigrations.size} published migrations are immutable`,
)
