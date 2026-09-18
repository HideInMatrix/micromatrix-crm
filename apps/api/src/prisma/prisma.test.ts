import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import { Temporal } from '@js-temporal/polyfill'
import { openPrismaTestDatabase } from '../testing/prisma-test-db'
import { PrismaService } from './prisma.service.js'
import { nowInstant } from './temporal.js'

const databaseUrl = process.env['DATABASE_URL']

function testTenant(prefix: string) {
  const token = randomUUID().replaceAll('-', '')
  return {
    id: `${prefix}_${token}`,
    name: `Prisma compat ${prefix}`,
    slug: `${prefix}-${token}`,
  }
}

function testTenantWithoutId(prefix: string) {
  const token = randomUUID().replaceAll('-', '')
  return {
    name: `Prisma compat ${prefix}`,
    slug: `${prefix}-${token}`,
  }
}

test(
  'Prisma native runtime preserves CRUD and rollback semantics',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)

    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma = testDb.client
    const explicitIdTenant = testTenant('explicit_to_p8')
    const fromPrisma = testTenantWithoutId('p8_to_fixture')
    const rollbackTenant = testTenant('p8_rollback')
    let generatedId = ''

    try {
      await prisma.orm.public.Tenants.create({
        ...explicitIdTenant,
        updatedAt: nowInstant(),
      })

      const read = await prisma.orm.public.Tenants.where({ id: explicitIdTenant.id })
        .select('id', 'name', 'slug')
        .first()
      assert.deepEqual(read, explicitIdTenant)

      const created = await prisma.orm.public.Tenants.select(
        'id',
        'name',
        'slug',
        'updatedAt',
      ).create({ ...fromPrisma, updatedAt: nowInstant() })
      generatedId = created.id
      assert.ok(created.id)
      assert.equal(created.name, fromPrisma.name)
      assert.equal(created.slug, fromPrisma.slug)

      await new Promise((resolve) => setTimeout(resolve, 20))
      const updatedName = `${fromPrisma.name} updated`
      const updated = await prisma.orm.public.Tenants.where({ id: created.id })
        .select('id', 'name', 'slug', 'updatedAt')
        .update({ name: updatedName, updatedAt: nowInstant() })
      assert.ok(updated)
      assert.equal(updated.id, created.id)
      assert.equal(updated.name, updatedName)
      assert.equal(updated.slug, fromPrisma.slug)
      assert.ok(Temporal.Instant.compare(updated.updatedAt, created.updatedAt) > 0)

      const nativeRead = await prisma.orm.public.Tenants.where({ id: created.id })
        .select('id', 'name', 'slug', 'updatedAt')
        .first()
      assert.equal(nativeRead?.id, created.id)
      assert.equal(nativeRead?.name, updatedName)
      assert.equal(nativeRead?.slug, fromPrisma.slug)
      assert.ok(nativeRead?.updatedAt)

      await assert.rejects(
        prisma.transaction(async (tx) => {
          await tx.orm.public.Tenants.create({ ...rollbackTenant, updatedAt: nowInstant() })
          throw new Error('prisma rollback probe')
        }),
        /prisma rollback probe/,
      )

      const rolledBack = await prisma.orm.public.Tenants.where({ id: rollbackTenant.id })
        .select('id')
        .first()
      assert.equal(rolledBack, null)
    } finally {
      await prisma.orm.public.Tenants.where((row) =>
        row.id.in([explicitIdTenant.id, generatedId, rollbackTenant.id].filter(Boolean)),
      ).deleteAll()
      await testDb.close()
    }
  },
)

test(
  'Prisma raw lane keeps parameters bound and decodes declared row codecs',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)

    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma = testDb.client
    const tenant = testTenant('p8_raw')

    try {
      await prisma.orm.public.Tenants.create({ ...tenant, updatedAt: nowInstant() })

      const rawQuery = prisma.raw.sql`
        SELECT id, name
        FROM tenants
        WHERE id = ${tenant.id}
      `.returnsRow({
        id: 'pg/text@1',
        name: 'pg/text@1',
      })
      const rows: Array<{ id: string; name: string }> = []
      for await (const row of prisma.runtime().query(rawQuery.build())) rows.push(row)

      assert.deepEqual(rows, [{ id: tenant.id, name: tenant.name }])
    } finally {
      await prisma.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
      await testDb.close()
    }
  },
)

test(
  'PrismaService startup lifecycle performs the Prisma database probe and closes cleanly',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const config = {
      getOrThrow: (key: string) => {
        assert.equal(key, 'DATABASE_URL')
        return databaseUrl
      },
    } as unknown as ConfigService
    const service = new PrismaService(config)

    await service.onModuleInit()
    assert.ok(service.client)
    await service.onModuleDestroy()
    assert.throws(() => service.client, /not initialized/)
  },
)
