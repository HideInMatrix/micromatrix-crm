import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8TimestampToISOString } from '../../prisma/prisma8-temporal'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { PersonalApiKeyService } from './personal-api-key.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'PersonalApiKey 使用 Prisma 8 保持 UserKey 字段映射、Temporal 到期时间与 ownership',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client

    let tenantId: string | null = null
    let userId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-api-key')
      tenantId = tenant.id
      const userRow = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: 'API Key User',
      })
      userId = userRow.id
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

      const stored = await prisma8Client.orm.public.UserKey.where({ id: listed[0]!.id })
        .select('createUser', 'enable', 'forever', 'expireTime', 'description')
        .first()
      assert.ok(stored)
      assert.equal(stored.createUser, userRow.id)
      assert.equal(stored.enable, false)
      assert.equal(stored.forever, false)
      assert.equal(
        stored.expireTime ? prisma8TimestampToISOString(stored.expireTime) : null,
        expiresAt.toISOString(),
      )
      assert.equal(stored.description, 'Prisma 8 key')

      await service.remove(user, listed[0]!.id)
      const remaining = await prisma8Client.orm.public.UserKey.where({ createUser: userRow.id })
        .select('id')
        .all()
      assert.equal(remaining.length, 0)
      assert.deepEqual(actions, ['add', 'update', 'disable', 'delete'])
    } finally {
      if (userId) await prisma8Client.orm.public.UserKey.where({ createUser: userId }).deleteAll()
      if (tenantId) {
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
