import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { PersonalApiKeyService } from './personal-api-key.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'PersonalApiKey 使用 Prisma 8 保持 UserKey 字段映射、Temporal 到期时间与 ownership',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 API key ${suffix}`, slug: `p8-key-${suffix}` },
      })
      tenantId = tenant.id
      const userRow = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'API Key User', passwordHash: 'not-used' },
      })
      const actions: string[] = []
      const service = new PersonalApiKeyService(
        { client: prisma8Client } as Prisma8Service,
        {
          record: async (_user: AuthUser, input: { action: string }) => void actions.push(input.action),
        } as unknown as BusinessChangeLogService,
      )
      const user = { id: userRow.id, tenantId: tenant.id } as AuthUser

      await service.add(user)
      const listed = await service.list(user)
      assert.equal(listed.length, 1)
      assert.equal(listed[0]?.createUser, userRow.id)
      assert.equal(listed[0]?.enable, true)

      const expiresAt = new Date('2026-12-31T08:00:00.000Z')
      await service.update(user, {
        id: listed[0]!.id,
        forever: false,
        expireTime: expiresAt.getTime(),
        description: 'Prisma 8 key',
      })
      await service.setEnabled(user, listed[0]!.id, false)

      const stored = await fixtureDb.userApiKey.findUniqueOrThrow({ where: { id: listed[0]!.id } })
      assert.equal(stored.userId, userRow.id)
      assert.equal(stored.enabled, false)
      assert.equal(stored.forever, false)
      assert.equal(stored.expireAt?.toISOString(), expiresAt.toISOString())
      assert.equal(stored.description, 'Prisma 8 key')

      await service.remove(user, listed[0]!.id)
      assert.equal(await fixtureDb.userApiKey.count({ where: { userId: userRow.id } }), 0)
      assert.deepEqual(actions, ['add', 'update', 'disable', 'delete'])
    } finally {
      if (tenantId) {
        await fixtureDb.userApiKey.deleteMany({ where: { user: { tenantId } } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
