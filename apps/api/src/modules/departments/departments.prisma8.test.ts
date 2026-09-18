import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { DepartmentsService } from './departments.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Departments 使用 Prisma 8 保持树、主管、环校验与子树删除保护',
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
        data: { name: `Prisma8 Department ${suffix}`, slug: `p8-dept-${suffix}` },
      })
      tenantId = tenant.id
      const root = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '总部', sort: 0 },
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

      const leader = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: '研发主管',
          passwordHash: 'not-used',
          deptId: child.id,
        },
      })
      const updated = await service.update(tenant.id, child.id, { leaderId: leader.id })
      assert.equal(updated.leaderId, leader.id)
      const stored = await fixtureDb.department.findUniqueOrThrow({ where: { id: child.id } })
      assert.equal(stored.leaderId, leader.id)
      assert.ok(stored.updatedAt instanceof Date)

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

      await fixtureDb.user.update({ where: { id: leader.id }, data: { deptId: null } })
      const role = await fixtureDb.role.create({
        data: {
          tenantId: tenant.id,
          name: `Scoped ${suffix}`,
          dataScope: 'CUSTOM',
          scopeDeptIds: [grandchild.id],
        },
      })
      await assert.rejects(
        () => service.remove(tenant.id, child.id),
        /当前部门或下级部门仍被角色数据范围使用，无法删除/,
      )
      await fixtureDb.role.update({ where: { id: role.id }, data: { scopeDeptIds: [] } })

      const removed = await service.remove(tenant.id, child.id)
      assert.equal(removed.deletedCount, 2)
      assert.equal(
        await fixtureDb.department.count({ where: { id: { in: [child.id, grandchild.id] } } }),
        0,
      )
    } finally {
      if (tenantId) {
        await fixtureDb.userRole.deleteMany({ where: { tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.role.deleteMany({ where: { tenantId } })
        await fixtureDb.department.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
