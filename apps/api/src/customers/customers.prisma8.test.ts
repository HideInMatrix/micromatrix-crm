import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../common/auth-user'
import type { Prisma8Service } from '../prisma/prisma8.service'
import { prisma8Varchar } from '../prisma/prisma8-varchar'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../testing/prisma-test-db'
import { CustomersService } from './customers.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'CustomersService production 路径使用 Prisma 8 保持 CRUD、团队与集团关系语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const prisma8 = { client: prisma8Client } as Prisma8Service
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'customers-p8')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        email: suffix + '@example.com',
        passwordHash: 'test',
        name: '客户测试成员',
      })
      const collaborator = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        email: 'collab-' + suffix + '@example.com',
        passwordHash: 'test',
        name: '协作成员',
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
        const customer = await prisma8Client.orm.public.Customer.where({
          id: prisma8Varchar(customerId, 32),
          organizationId: prisma8Varchar(tenant.id, 32),
        }).first()
        assert.ok(customer)
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
        (
          await prisma8Client.orm.public.Customer.where({
            id: prisma8Varchar(parent.id, 32),
          })
            .select('name')
            .first()
        )?.name,
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
      const remaining = await prisma8Client.orm.public.Customer
        .where((row) => row.id.in([prisma8Varchar(parent.id, 32), prisma8Varchar(child.id, 32)]))
        .select('id')
        .all()
      assert.equal(remaining.length, 0)
    } finally {
      if (tenantId) {
        const organizationId = prisma8Varchar(tenantId, 32)
        const customerIds = await prisma8Client.orm.public.Customer.where({ organizationId })
          .select('id')
          .all()
        if (customerIds.length) {
          const ids = customerIds.map((item) => item.id)
          await prisma8Client.orm.public.CustomerRelation
            .where((row) => row.sourceCustomerId.in(ids))
            .deleteAll()
          await prisma8Client.orm.public.CustomerRelation
            .where((row) => row.targetCustomerId.in(ids))
            .deleteAll()
          await prisma8Client.orm.public.CustomerCollaboration
            .where((row) => row.customerId.in(ids))
            .deleteAll()
        }
        await prisma8Client.orm.public.Customer.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
