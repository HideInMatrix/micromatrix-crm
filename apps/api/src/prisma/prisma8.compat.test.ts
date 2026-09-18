import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import { Temporal } from '@js-temporal/polyfill'
import { createPrismaFixtureClient } from '../testing/prisma-fixture-client'
import { createPrisma8Client } from './prisma8-client.js'
import { Prisma8Service } from './prisma8.service.js'
import { prisma8Now } from './prisma8-temporal.js'

const databaseUrl = process.env['DATABASE_URL']

function testTenant(prefix: string) {
  const token = randomUUID().replaceAll('-', '')
  return {
    id: `${prefix}_${token}`,
    name: `Prisma 8 compat ${prefix}`,
    slug: `${prefix}-${token}`,
  }
}

function testTenantWithoutId(prefix: string) {
  const token = randomUUID().replaceAll('-', '')
  return {
    name: `Prisma 8 compat ${prefix}`,
    slug: `${prefix}-${token}`,
  }
}

test(
  'Prisma 8 fixture and runtime preserve CRUD and rollback semantics',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)

    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8 = await createPrisma8Client(databaseUrl)
    const fromFixture = testTenant('fixture_to_p8')
    const fromPrisma8 = testTenantWithoutId('p8_to_fixture')
    const rollbackTenant = testTenant('p8_rollback')
    let prisma8GeneratedId = ''

    await fixtureDb.$connect()
    await prisma8.connect()

    try {
      await fixtureDb.tenant.create({
        data: fromFixture,
      })

      const prisma8Read = await prisma8.orm.public.Tenants.where({ id: fromFixture.id })
        .select('id', 'name', 'slug')
        .first()
      assert.deepEqual(prisma8Read, fromFixture)

      const prisma8Created = await prisma8.orm.public.Tenants
        .select('id', 'name', 'slug', 'updatedAt')
        .create({ ...fromPrisma8, updatedAt: prisma8Now() })
      prisma8GeneratedId = prisma8Created.id
      assert.ok(prisma8Created.id)
      assert.equal(prisma8Created.name, fromPrisma8.name)
      assert.equal(prisma8Created.slug, fromPrisma8.slug)

      await new Promise((resolve) => setTimeout(resolve, 20))
      const updatedName = `${fromPrisma8.name} updated`
      const prisma8Updated = await prisma8.orm.public.Tenants
        .where({ id: prisma8Created.id })
        .select('id', 'name', 'slug', 'updatedAt')
        .update({ name: updatedName, updatedAt: prisma8Now() })
      assert.ok(prisma8Updated)
      assert.equal(prisma8Updated.id, prisma8Created.id)
      assert.equal(prisma8Updated.name, updatedName)
      assert.equal(prisma8Updated.slug, fromPrisma8.slug)
      assert.ok(
        Temporal.PlainDateTime.compare(prisma8Updated.updatedAt, prisma8Created.updatedAt) > 0,
      )

      const fixtureRead = await fixtureDb.tenant.findUnique({
        where: { id: prisma8Created.id },
        select: { id: true, name: true, slug: true, updatedAt: true },
      })
      assert.equal(fixtureRead?.id, prisma8Created.id)
      assert.equal(fixtureRead?.name, updatedName)
      assert.equal(fixtureRead?.slug, fromPrisma8.slug)
      assert.ok(fixtureRead?.updatedAt)

      await assert.rejects(
        prisma8.transaction(async (tx) => {
          await tx.orm.public.Tenants.create({ ...rollbackTenant, updatedAt: prisma8Now() })
          throw new Error('prisma8 rollback probe')
        }),
        /prisma8 rollback probe/,
      )

      const rolledBack = await fixtureDb.tenant.findUnique({ where: { id: rollbackTenant.id } })
      assert.equal(rolledBack, null)
    } finally {
      await fixtureDb.tenant.deleteMany({
        where: {
          id: {
            in: [fromFixture.id, prisma8GeneratedId, rollbackTenant.id].filter(Boolean),
          },
        },
      })
      await prisma8.close()
      await fixtureDb.$disconnect()
    }
  },
)

test(
  'Prisma 8 raw lane keeps parameters bound and decodes declared row codecs',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)

    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8 = await createPrisma8Client(databaseUrl)
    const tenant = testTenant('p8_raw')

    await fixtureDb.$connect()
    await prisma8.connect()

    try {
      await fixtureDb.tenant.create({ data: tenant })

      const rawQuery = prisma8.raw.sql`
        SELECT id, name
        FROM tenants
        WHERE id = ${tenant.id}
      `.returnsRow({
        id: 'pg/text@1',
        name: 'pg/text@1',
      })
      const rows: Array<{ id: string; name: string }> = []
      for await (const row of prisma8.runtime().query(rawQuery.build())) rows.push(row)

      assert.deepEqual(rows, [{ id: tenant.id, name: tenant.name }])
    } finally {
      await fixtureDb.tenant.deleteMany({ where: { id: tenant.id } })
      await prisma8.close()
      await fixtureDb.$disconnect()
    }
  },
)

test(
  'Prisma8Service startup lifecycle performs the Prisma 8 database probe and closes cleanly',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const config = {
      getOrThrow: (key: string) => {
        assert.equal(key, 'DATABASE_URL')
        return databaseUrl
      },
    } as unknown as ConfigService
    const service = new Prisma8Service(config)

    await service.onModuleInit()
    assert.ok(service.client)
    await service.onModuleDestroy()
    assert.throws(() => service.client, /not initialized/)
  },
)
