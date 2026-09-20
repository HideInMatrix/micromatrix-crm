import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'

import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { DictionariesService } from './dictionaries.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Dictionaries 使用 Prisma 保持 BigInt 排序、复合配置键与 transaction 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-dict')
      tenantId = tenant.id
      const actorRow = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'Dictionary User',
      })
      const actor = { id: actorRow.id, tenantId: tenant.id } as AuthUser
      const service = new DictionariesService({ client: prismaClient } as PrismaService)

      const first = await service.add(actor, { name: '原因一', module: 'CLUE_POOL_RS' })
      const second = await service.add(actor, { name: '原因二', module: 'CLUE_POOL_RS' })
      const third = await service.add(actor, { name: '原因三', module: 'CLUE_POOL_RS' })
      assert.equal(first.pos, 1)
      assert.equal(second.pos, 2)
      assert.equal(third.pos, 3)
      assert.equal(first.id.length, 32)

      await service.update(actor, { id: second.id, name: '原因二-更新' })
      const sorted = await service.sort(actor, {
        start: 3,
        end: 1,
        dragDictId: third.id,
        module: 'CLUE_POOL_RS',
      })
      assert.deepEqual(
        sorted.map((row) => [row.name, row.pos]),
        [
          ['原因三', 1],
          ['原因一', 2],
          ['原因二-更新', 3],
        ],
      )

      assert.deepEqual(await service.switch(actor, 'CLUE_POOL_RS', true), {
        module: 'CLUE_POOL_RS',
        enable: true,
      })
      assert.equal(await service.isEnabled(tenant.id, 'CLUE_POOL_RS'), true)
      assert.equal(
        (await service.validateReason(tenant.id, 'CLUE_POOL_RS', first.id))?.id,
        first.id,
      )

      await service.remove(actor, first.id)
      await service.remove(actor, second.id)
      await assert.rejects(() => service.remove(actor, third.id), /原因已启用，至少保留一条原因/)

      const organizationId = tenant.id
      const moduleName = 'CLUE_POOL_RS'
      const stored = await prismaClient.orm.public.SysDict.where({
        organizationId,
        module: moduleName,
      })
        .orderBy((row) => row.pos.asc())
        .orderBy((row) => row.createTime.asc())
        .select('id', 'pos', '_type')
        .all()
      assert.equal(stored.length, 1)
      assert.equal(stored[0]?.id, third.id)
      assert.equal(stored[0]?.pos, BigInt(1))
      assert.equal(stored[0]?._type, 'TEXT')
      const config = await prismaClient.orm.public.SysDictConfig.where({
        module: moduleName,
        organizationId,
      })
        .select('enabled')
        .first()
      assert.ok(config)
      assert.equal(config.enabled, true)
    } finally {
      if (tenantId) {
        const organizationId = tenantId
        await prismaClient.orm.public.SysDict.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.SysDictConfig.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
