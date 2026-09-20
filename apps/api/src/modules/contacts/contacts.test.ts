import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { createLegacyId32 } from '../../common/legacy-id'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { ContactsService } from './contacts.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ContactsService production 路径使用 Prisma 保持关系、分页、状态与 CRUD 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const prisma = { client: prismaClient } as PrismaService
    const suffix = randomUUID().replaceAll('-', '')
    const organizationId = `org-${suffix}`.slice(0, 32)
    const actorId = `u${suffix}`.slice(0, 32)
    const user: AuthUser = {
      id: actorId,
      tenantId: organizationId,
      email: `${suffix}@example.com`,
      name: '联系人测试成员',
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: ['*'],
    }
    const customerAccess = {
      assertRead: async () => ({ dataScope: true, pool: false, collaborationType: null }),
      assertCollaborateWrite: async () => ({
        dataScope: true,
        pool: false,
        collaborationType: null,
      }),
    }
    const dataScope = {
      directOwnerFilter: async () => ({}),
      matchesDirectOwner: async () => true,
      resolveScope: async () => ({ hasPermission: true, all: true, deptIds: [] }),
    }
    const fields = [
      {
        id: 'name',
        key: 'name',
        label: '姓名',
        type: 'text',
        system: true,
        hidden: false,
        required: true,
      },
      {
        id: 'phone',
        key: 'phone',
        label: '手机',
        type: 'text',
        system: true,
        hidden: false,
        required: false,
      },
      {
        id: 'owner',
        key: 'owner',
        label: '负责人',
        type: 'user',
        system: true,
        hidden: false,
        required: true,
      },
      {
        id: 'customerId',
        key: 'customerId',
        label: '客户',
        type: 'relation',
        system: true,
        hidden: false,
        required: false,
      },
      {
        id: 'enable',
        key: 'enable',
        label: '启用',
        type: 'switch',
        system: true,
        hidden: false,
        required: true,
      },
    ]
    const metadata = {
      listFields: async () => fields,
      fieldsMap: async () => new Map(fields.map((field) => [field.key, { ...field, config: {} }])),
      computeFormulas: () => ({}),
      resolveEditableField: async (_tenantId: string, _module: string, id: string) =>
        fields.find((field) => field.id === id || field.key === id),
      validateBatchFieldValue: () => undefined,
    }
    const fieldValues = {
      validate: async () => undefined,
      save: async () => undefined,
      saveBatch: async () => ({ count: 1 }),
      load: async (_tenantId: string, _type: string, ids: string[]) =>
        new Map(ids.map((id) => [id, {}])),
      filterResourceIds: async () => [],
    }
    const service = new ContactsService(
      prisma,
      customerAccess as never,
      dataScope as never,
      metadata as never,
      { getConfig: async () => ({ fields: [] }) } as never,
      fieldValues as never,
      { resolveFilters: async () => null } as never,
      {} as never,
      {} as never,
      { send: async () => undefined } as never,
    )

    try {
      await prismaClient.orm.public.Tenants.create({
        id: organizationId,
        name: '联系人专项租户',
        slug: `contacts-${suffix}`,
        updatedAt: nowInstant(),
      })
      await prismaClient.orm.public.Users.create({
        id: actorId,
        tenantId: organizationId,
        email: user.email,
        passwordHash: 'test',
        name: user.name,
        updatedAt: nowInstant(),
      })
      const now = BigInt(Date.now())
      const actorVarchar = actorId
      const organizationVarchar = organizationId
      const customer = await prismaClient.orm.public.Customer.select('id').create({
        id: createLegacyId32(),
        name: '联系人专项客户',
        owner: actorVarchar,
        organizationId: organizationVarchar,
        createTime: now,
        updateTime: now,
        createUser: actorVarchar,
        updateUser: actorVarchar,
      })

      const contact = await service.create(user, {
        customerId: customer.id,
        ownerId: actorId,
        name: '张三',
        phone: '13800138000',
        customData: {},
      })
      assert.equal(contact.customerId, customer.id)
      assert.equal(contact.customerName, '联系人专项客户')
      assert.equal(contact.ownerId, actorId)
      assert.equal(contact.enable, true)

      const page = await service.findAll(user, { page: 1, pageSize: 10, keyword: '张三' })
      assert.equal(page.total, 1)
      assert.equal(page.items[0]?.id, contact.id)
      assert.equal(page.items[0]?.customerName, '联系人专项客户')

      const embedded = await service.listByCustomer(user, customer.id)
      assert.equal(embedded.length, 1)
      assert.equal(embedded[0]?.id, contact.id)

      const updated = await service.update(user, contact.id, {
        name: '张三更新',
        phone: '13900139000',
      })
      assert.equal(updated.name, '张三更新')
      assert.equal(updated.phone, '13900139000')
      assert.equal(
        (
          await prismaClient.orm.public.CustomerContact.where({
            id: contact.id,
          })
            .select('name')
            .first()
        )?.name,
        '张三更新',
      )

      const disabled = await service.disable(user, contact.id, '离职')
      assert.equal(disabled.enable, false)
      assert.equal(disabled.disableReason, '离职')
      const enabled = await service.enable(user, contact.id)
      assert.equal(enabled.enable, true)
      assert.equal(enabled.disableReason, null)

      assert.deepEqual(await service.checkOpportunity(user, contact.id), {
        linked: false,
        count: 0,
      })
      const removed = await service.remove(user, contact.id)
      assert.equal(removed.id, contact.id)
      assert.equal(
        (
          await prismaClient.orm.public.CustomerContact.where({
            id: contact.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      await prismaClient.orm.public.CustomerContact.where({
        organizationId: organizationId,
      }).deleteAll()
      await prismaClient.orm.public.Customer.where({ organizationId: organizationId }).deleteAll()
      await prismaClient.orm.public.Users.where({ tenantId: organizationId }).deleteAll()
      await prismaClient.orm.public.Tenants.where({ id: organizationId }).deleteAll()
      await testDb.close()
    }
  },
)
