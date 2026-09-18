import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { DictionariesService } from './dictionaries.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Dictionaries 使用 Prisma 8 保持 BigInt 排序、复合配置键与 transaction 语义',
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
        data: { name: `Prisma8 Dictionary ${suffix}`, slug: `p8-dict-${suffix}` },
      })
      tenantId = tenant.id
      const actorRow = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'Dictionary User', passwordHash: 'not-used' },
      })
      const actor = { id: actorRow.id, tenantId: tenant.id } as AuthUser
      const service = new DictionariesService({ client: prisma8Client } as Prisma8Service)

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
      assert.equal((await service.validateReason(tenant.id, 'CLUE_POOL_RS', first.id))?.id, first.id)

      await service.remove(actor, first.id)
      await service.remove(actor, second.id)
      await assert.rejects(() => service.remove(actor, third.id), /原因已启用，至少保留一条原因/)

      const stored = await fixtureDb.sysDict.findMany({
        where: { organizationId: tenant.id, module: 'CLUE_POOL_RS' },
        orderBy: [{ pos: 'asc' }, { createTime: 'asc' }],
      })
      assert.equal(stored.length, 1)
      assert.equal(stored[0]?.id, third.id)
      assert.equal(stored[0]?.pos, BigInt(1))
      assert.equal(stored[0]?.type, 'TEXT')
      const config = await fixtureDb.sysDictConfig.findUniqueOrThrow({
        where: { module_organizationId: { module: 'CLUE_POOL_RS', organizationId: tenant.id } },
      })
      assert.equal(config.enabled, true)
    } finally {
      if (tenantId) {
        await fixtureDb.sysDict.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.sysDictConfig.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
