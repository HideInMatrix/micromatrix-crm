import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { DepartmentsService } from './departments.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Departments 使用 Prisma 8 保持树、主管、环校验与子树删除保护',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-dept')
      tenantId = tenant.id
      const root = await createPrismaTestDepartment(prisma8Client, {
        tenantId: tenant.id,
        name: '总部',
      })
      const service = new DepartmentsService({ client: prisma8Client } as Prisma8Service)

      const child = await service.create(tenant.id, {
        name: '研发部',
        parentId: root.id,
        sort: 1,
      })
      const grandchild = await service.create(tenant.id, {
        name: '平台组',
        parentId: child.id,
        sort: 1,
      })
      await service.create(tenant.id, { name: 'Sales', parentId: root.id, sort: 2 })
      await assert.rejects(
        () => service.create(tenant.id, { name: 'sales', parentId: root.id, sort: 3 }),
        /同一上级部门下已存在同名部门/,
      )

      const leader = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: '研发主管',
        deptId: child.id,
      })
      const updated = await service.update(tenant.id, child.id, { leaderId: leader.id })
      assert.equal(updated.leaderId, leader.id)
      const stored = await prisma8Client.orm.public.Departments.where({ id: child.id })
        .select('leaderId', 'updatedAt')
        .first()
      assert.ok(stored)
      assert.equal(stored.leaderId, leader.id)
      assert.ok(stored.updatedAt)

      const tree = await service.tree(tenant.id)
      const rootNode = tree.find((item) => item.id === root.id)
      const childNode = rootNode?.children?.find((item) => item.id === child.id)
      assert.equal(childNode?.leaderName, '研发主管')
      assert.equal(childNode?.userCount, 1)
      assert.equal(childNode?.children?.[0]?.id, grandchild.id)

      await assert.rejects(
        () => service.update(tenant.id, child.id, { parentId: grandchild.id }),
        /不能移动到自己的下级部门/,
      )
      await assert.rejects(
        () => service.remove(tenant.id, child.id),
        /当前部门或下级部门存在成员，无法删除/,
      )

      await prisma8Client.orm.public.Users.where({ id: leader.id }).update({
        deptId: null,
        updatedAt: prisma8Now(),
      })
      const role = await prisma8Client.orm.public.Roles
        .select('id')
        .create({
          tenantId: tenant.id,
          name: 'Scoped ' + suffix,
          dataScope: 'CUSTOM',
          scopeDeptIds: [grandchild.id],
          updatedAt: prisma8Now(),
        })
      await assert.rejects(
        () => service.remove(tenant.id, child.id),
        /当前部门或下级部门仍被角色数据范围使用，无法删除/,
      )
      await prisma8Client.orm.public.Roles.where({ id: role.id }).update({
        scopeDeptIds: [],
        updatedAt: prisma8Now(),
      })

      const removed = await service.remove(tenant.id, child.id)
      assert.equal(removed.deletedCount, 2)
      const remaining = await prisma8Client.orm.public.Departments
        .where((row) => row.id.in([child.id, grandchild.id]))
        .select('id')
        .all()
      assert.equal(remaining.length, 0)
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.UserRoles.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Roles.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Departments.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
