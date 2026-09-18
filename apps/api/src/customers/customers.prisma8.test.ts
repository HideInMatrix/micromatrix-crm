import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../common/auth-user'
import { createPrismaFixtureClient } from '../testing/prisma-fixture-client'
import { createPrisma8Client } from '../prisma/prisma8-client'
import type { Prisma8Service } from '../prisma/prisma8.service'
import { CustomersService } from './customers.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'CustomersService production 路径使用 Prisma 8 保持 CRUD、团队与集团关系语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const prisma8 = { client: prisma8Client } as Prisma8Service
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: 'Customers Prisma8 ' + suffix, slug: 'customers-p8-' + suffix },
      })
      tenantId = tenant.id
      const actor = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          email: suffix + '@example.com',
          passwordHash: 'test',
          name: '客户测试成员',
        },
      })
      const collaborator = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          email: 'collab-' + suffix + '@example.com',
          passwordHash: 'test',
          name: '协作成员',
        },
      })
      const user: AuthUser = {
        id: actor.id,
        tenantId: tenant.id,
        email: actor.email,
        name: actor.name,
        deptId: null,
        leaderId: null,
        roles: [],
        permissions: ['*'],
      }

      const dataScope = {
        directOwnerFilter: async () => ({}),
        resolveScope: async () => ({ all: true, deptIds: [] }),
        matchesDirectOwner: async () => true,
      }
      const metadata = {
        listFields: async () => [
          {
            id: 'name',
            key: 'name',
            label: '客户名称',
            type: 'text',
            system: true,
            required: true,
            hidden: false,
          },
        ],
        fieldsMap: async () =>
          new Map([
            [
              'name',
              {
                id: 'name',
                key: 'name',
                label: '客户名称',
                type: 'text',
                system: true,
                required: true,
                config: { unique: false },
              },
            ],
          ]),
        computeFormulas: () => ({}),
      }
      const fieldValues = {
        validate: async () => undefined,
        save: async () => undefined,
        saveBatch: async () => undefined,
        load: async (_tenantId: string, _type: string, ids: string[]) =>
          new Map(ids.map((id) => [id, {}])),
        filterResourceIds: async () => [],
      }
      const notifications = { send: async () => undefined }
      const pools = {
        assertCapacityForOwner: async () => undefined,
        options: async () => [],
      }
      const changeLog = { record: async () => undefined }
      const accessResult = async (customerId: string) => {
        const customer = await fixtureDb.customer.findUniqueOrThrow({ where: { id: customerId } })
        return {
          customer,
          dataScope: true,
          pool: false,
          collaborationType: null,
          canManageCustomer: true,
          canCollaborateWrite: true,
        }
      }
      const customerAccess = {
        assertRead: async (_user: AuthUser, customerId: string) => accessResult(customerId),
        assertManageCustomer: async (_user: AuthUser, customerId: string) =>
          accessResult(customerId),
      }

      const service = new CustomersService(
        prisma8,
        dataScope as never,
        metadata as never,
        {} as never,
        fieldValues as never,
        notifications as never,
        pools as never,
        {} as never,
        changeLog as never,
        { resolveFilters: async () => null } as never,
        customerAccess as never,
        {} as never,
        {} as never,
        {} as never,
      )

      const parent = await service.create(user, {
        name: 'Prisma8 客户集团',
        ownerId: actor.id,
        customData: {},
      })
      const child = await service.create(user, {
        name: 'Prisma8 子公司',
        ownerId: actor.id,
        customData: {},
      })
      assert.equal(parent.ownerId, actor.id)
      assert.equal(child.ownerId, actor.id)

      const page = await service.findAll(user, {
        page: 1,
        pageSize: 10,
        keyword: 'Prisma8 客户',
      })
      assert.equal(page.total, 1)
      assert.equal(page.items[0]?.id, parent.id)

      const detail = await service.findOne(user, parent.id)
      assert.equal(detail.name, 'Prisma8 客户集团')

      const updated = await service.update(user, parent.id, { name: 'Prisma8 客户集团更新' })
      assert.equal(updated.name, 'Prisma8 客户集团更新')
      assert.equal(
        (await fixtureDb.customer.findUniqueOrThrow({ where: { id: parent.id } })).name,
        'Prisma8 客户集团更新',
      )

      await service.teamAdd(user, parent.id, collaborator.id, undefined, 'COLLABORATION')
      const team = await service.teamList(user, parent.id)
      assert.equal(team.length, 1)
      assert.equal(team[0]?.userId, collaborator.id)
      assert.equal(team[0]?.userName, '协作成员')

      const relation = await service.relationAdd(
        user,
        parent.id,
        child.id,
        'SUBSIDIARY',
      )
      assert.ok(relation)
      const relations = await service.relationList(user, parent.id)
      assert.equal(relations.length, 1)
      assert.equal(relations[0]?.customerId, child.id)
      assert.equal(relations[0]?.relationType, 'SUBSIDIARY')

      await service.relationRemove(user, parent.id, String(relation.id))
      await service.teamRemove(user, parent.id, team[0]!.id)

      const removedParent = await service.remove(user, parent.id)
      const removedChild = await service.remove(user, child.id)
      assert.equal(removedParent.id, parent.id)
      assert.equal(removedChild.id, child.id)
      assert.equal(
        await fixtureDb.customer.count({ where: { id: { in: [parent.id, child.id] } } }),
        0,
      )
    } finally {
      if (tenantId) {
        await fixtureDb.customerRelation.deleteMany({
          where: {
            OR: [
              { sourceCustomer: { organizationId: tenantId } },
              { targetCustomer: { organizationId: tenantId } },
            ],
          },
        }).catch(() => undefined)
        await fixtureDb.customerCollaboration.deleteMany({
          where: { customer: { organizationId: tenantId } },
        }).catch(() => undefined)
        await fixtureDb.customer.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
