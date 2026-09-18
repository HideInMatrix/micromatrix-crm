import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Varchar } from '../../prisma/prisma8-varchar'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { UserViewsService } from './user-views.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'UserViews 使用 Prisma 8 保持 ownership、条件替换、4096 排序与唯一约束语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-user-views')
      tenantId = tenant.id
      const [actor, other] = await Promise.all([
        createPrismaTestUser(prisma8Client, {
          tenantId: tenant.id,
          name: 'View Actor',
        }),
        createPrismaTestUser(prisma8Client, {
          tenantId: tenant.id,
          name: 'Other View User',
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
        (
          await prisma8Client.orm.public.SysUserViewCondition.where({
            sysUserViewId: prisma8Varchar(first.id, 32),
          })
            .select('id')
            .all()
        ).length,
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
      assert.equal(
        await prisma8Client.orm.public.SysUserView.where({
          id: prisma8Varchar(first.id, 32),
        })
          .select('id')
          .first(),
        null,
      )
      assert.equal(
        (
          await prisma8Client.orm.public.SysUserViewCondition.where({
            sysUserViewId: prisma8Varchar(first.id, 32),
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      if (tenantId) {
        const organizationId = prisma8Varchar(tenantId, 32)
        const viewIds = await prisma8Client.orm.public.SysUserView.where({ organizationId })
          .select('id')
          .all()
        if (viewIds.length) {
          await prisma8Client.orm.public.SysUserViewCondition
            .where((row) => row.sysUserViewId.in(viewIds.map((item) => item.id)))
            .deleteAll()
        }
        await prisma8Client.orm.public.SysUserView.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
