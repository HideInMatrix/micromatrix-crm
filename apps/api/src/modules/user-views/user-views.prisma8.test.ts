import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { UserViewsService } from './user-views.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'UserViews 使用 Prisma 8 保持 ownership、条件替换、4096 排序与唯一约束语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 user views ${suffix}`, slug: `p8-user-views-${suffix}` },
      })
      tenantId = tenant.id
      const [actor, other] = await Promise.all([
        fixtureDb.user.create({
          data: { tenantId: tenant.id, name: 'View Actor', passwordHash: 'not-used' },
        }),
        fixtureDb.user.create({
          data: { tenantId: tenant.id, name: 'Other View User', passwordHash: 'not-used' },
        }),
      ])
      const user = { id: actor.id, tenantId: tenant.id } as AuthUser
      const otherUser = { id: other.id, tenantId: tenant.id } as AuthUser
      const service = new UserViewsService({ client: prisma8Client } as Prisma8Service)

      const first = await service.create(user, 'CLUE', {
        name: '重点线索',
        searchMode: 'OR',
        conditions: [
          { name: 'score', operator: 'gte', value: 10 },
          {
            name: 'department',
            operator: 'eq',
            value: 'dept-a',
            containChildIds: ['dept-a', 'dept-child'],
          },
        ],
      })
      const second = await service.create(user, 'CLUE', { name: '最近线索' })
      await service.create(user, 'CUSTOMER', { name: '我的客户' })

      assert.equal(first.pos, 4096)
      assert.equal(second.pos, 8192)
      assert.deepEqual(
        (await service.list(user, 'CLUE')).map((item) => item.id),
        [second.id, first.id],
      )
      assert.deepEqual((await service.detail(user, first.id, 'CLUE')).conditions, [
        {
          name: 'score',
          value: 10,
          valueType: 'INT',
          type: null,
          multipleValue: false,
          operator: 'gte',
          containChildIds: [],
        },
        {
          name: 'department',
          value: 'dept-a',
          valueType: 'STRING',
          type: null,
          multipleValue: false,
          operator: 'eq',
          containChildIds: ['dept-a', 'dept-child'],
        },
      ])

      await assert.rejects(
        () => service.create(user, 'CLUE', { name: '重点线索' }),
        BadRequestException,
      )
      await assert.rejects(() => service.detail(otherUser, first.id, 'CLUE'), NotFoundException)
      await assert.rejects(() => service.detail(user, first.id, 'CUSTOMER'), NotFoundException)

      const updated = await service.update(user, 'CLUE', {
        id: first.id,
        name: '重点线索更新',
        searchMode: 'AND',
        conditions: [{ name: 'active', operator: 'eq', value: true }],
      })
      assert.equal(updated.conditions.length, 1)
      assert.equal(updated.conditions[0]?.name, 'active')
      assert.equal(
        await fixtureDb.sysUserViewCondition.count({ where: { sysUserViewId: first.id } }),
        1,
      )

      await service.toggleEnabled(user, first.id, 'CLUE')
      await assert.rejects(() => service.resolveFilters(user, first.id, 'CLUE'), BadRequestException)
      await service.toggleEnabled(user, first.id, 'CLUE')
      assert.deepEqual(await service.resolveFilters(user, first.id, 'CLUE'), {
        searchMode: 'AND',
        conditions: [{ key: 'active', op: 'eq', value: true }],
      })

      await service.editPos(user, 'CLUE', {
        orgId: tenant.id,
        moveId: first.id,
        targetId: second.id,
        moveMode: 'BEFORE',
      })
      assert.deepEqual(
        (await service.list(user, 'CLUE')).map((item) => item.id),
        [first.id, second.id],
      )

      assert.deepEqual(await service.remove(user, first.id, 'CLUE'), {
        id: first.id,
        name: '重点线索更新',
      })
      assert.equal(await fixtureDb.sysUserView.findUnique({ where: { id: first.id } }), null)
      assert.equal(
        await fixtureDb.sysUserViewCondition.count({ where: { sysUserViewId: first.id } }),
        0,
      )
    } finally {
      if (tenantId) {
        await fixtureDb.sysUserViewCondition.deleteMany({
          where: { view: { organizationId: tenantId } },
        })
        await fixtureDb.sysUserView.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
