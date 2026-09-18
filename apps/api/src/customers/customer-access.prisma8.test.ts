import assert from 'node:assert/strict'
import test from 'node:test'
import { NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../common/auth-user'
import type { DataScopeService } from '../common/services/data-scope.service'
import type { ResourcePoolsService } from '../modules/pool-rules/resource-pools.service'
import type { Prisma8Service } from '../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar } from '../prisma/prisma8-varchar'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../testing/prisma-test-db'
import { CustomerAccessService } from './customer-access.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'CustomerAccess 使用 Prisma 8 保持租户隔离与协作访问裁决',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client

    let tenantId: string | null = null
    let otherTenantId: string | null = null
    try {
      const [tenant, otherTenant] = await Promise.all([
        createPrismaTestTenant(prisma8Client, 'p8-customer-access'),
        createPrismaTestTenant(prisma8Client, 'p8-customer-other'),
      ])
      tenantId = tenant.id
      otherTenantId = otherTenant.id
      const member = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: 'Collaborator',
      })
      const now = BigInt(Date.now())
      const memberId = prisma8Varchar(member.id, 32)
      const customer = await prisma8Client.orm.public.Customer
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('Customer A', 255),
          owner: null,
          organizationId: prisma8Varchar(tenant.id, 32),
          createTime: now,
          updateTime: now,
          createUser: memberId,
          updateUser: memberId,
        })
      const foreignCustomer = await prisma8Client.orm.public.Customer
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('Foreign Customer', 255),
          owner: null,
          organizationId: prisma8Varchar(otherTenant.id, 32),
          createTime: now,
          updateTime: now,
          createUser: memberId,
          updateUser: memberId,
        })
      const collaboration = await prisma8Client.orm.public.CustomerCollaboration
        .select('id')
        .create({
          id: prisma8Id32(),
          createTime: now,
          updateTime: now,
          createUser: memberId,
          updateUser: memberId,
          userId: memberId,
          customerId: customer.id,
          collaborationType: prisma8Varchar('READ_ONLY', 50),
        })

      const dataScope = {
        matchesDirectOwner: async () => false,
      } as unknown as DataScopeService
      const resourcePools = {
        options: async () => [],
        isPoolManager: async () => false,
      } as unknown as ResourcePoolsService
      const service = new CustomerAccessService(
        { client: prisma8Client } as Prisma8Service,
        dataScope,
        resourcePools,
      )
      const user = {
        id: member.id,
        tenantId: tenant.id,
        email: null,
        name: member.name,
        deptId: null,
        leaderId: null,
        roles: [],
        permissions: [],
      } satisfies AuthUser

      const readOnly = await service.resolve(user, customer.id)
      assert.equal(readOnly.customer.id, customer.id)
      assert.equal(readOnly.collaborationType, 'READ_ONLY')
      assert.equal(readOnly.dataScope, false)
      assert.equal(readOnly.canRead, true)
      assert.equal(readOnly.canManageCustomer, false)
      assert.equal(readOnly.canCollaborateWrite, false)

      await prisma8Client.orm.public.CustomerCollaboration.where({ id: collaboration.id }).update({
        collaborationType: prisma8Varchar('COLLABORATION', 50),
      })
      const writable = await service.resolve(user, customer.id)
      assert.equal(writable.collaborationType, 'COLLABORATION')
      assert.equal(writable.canRead, true)
      assert.equal(writable.canCollaborateWrite, true)

      await assert.rejects(
        () => service.resolve(user, foreignCustomer.id),
        (error) => error instanceof NotFoundException,
      )
    } finally {
      if (tenantId) {
        const organizationId = prisma8Varchar(tenantId, 32)
        const customerIds = await prisma8Client.orm.public.Customer.where({ organizationId })
          .select('id')
          .all()
        if (customerIds.length) {
          await prisma8Client.orm.public.CustomerCollaboration
            .where((row) => row.customerId.in(customerIds.map((item) => item.id)))
            .deleteAll()
        }
        await prisma8Client.orm.public.Customer.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      if (otherTenantId) {
        await prisma8Client.orm.public.Customer
          .where({ organizationId: prisma8Varchar(otherTenantId, 32) })
          .deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: otherTenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
