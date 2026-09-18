import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../common/auth-user'
import type { DataScopeService } from '../common/services/data-scope.service'
import { createPrismaFixtureClient } from '../testing/prisma-fixture-client'
import type { ResourcePoolsService } from '../modules/pool-rules/resource-pools.service'
import { createPrisma8Client } from '../prisma/prisma8-client'
import type { Prisma8Service } from '../prisma/prisma8.service'
import { CustomerAccessService } from './customer-access.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'CustomerAccess 使用 Prisma 8 保持租户隔离与协作访问裁决',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    let otherTenantId: string | null = null
    try {
      const [tenant, otherTenant] = await Promise.all([
        fixtureDb.tenant.create({
          data: { name: `Prisma8 customer access ${suffix}`, slug: `p8-customer-access-${suffix}` },
        }),
        fixtureDb.tenant.create({
          data: { name: `Prisma8 customer other ${suffix}`, slug: `p8-customer-other-${suffix}` },
        }),
      ])
      tenantId = tenant.id
      otherTenantId = otherTenant.id
      const member = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Collaborator',
          passwordHash: 'not-used',
        },
      })
      const now = BigInt(Date.now())
      const customer = await fixtureDb.customer.create({
        data: {
          name: 'Customer A',
          owner: null,
          organizationId: tenant.id,
          createTime: now,
          updateTime: now,
          createUser: member.id,
          updateUser: member.id,
        },
      })
      const foreignCustomer = await fixtureDb.customer.create({
        data: {
          name: 'Foreign Customer',
          owner: null,
          organizationId: otherTenant.id,
          createTime: now,
          updateTime: now,
          createUser: member.id,
          updateUser: member.id,
        },
      })
      const collaboration = await fixtureDb.customerCollaboration.create({
        data: {
          createTime: now,
          updateTime: now,
          createUser: member.id,
          updateUser: member.id,
          userId: member.id,
          customerId: customer.id,
          collaborationType: 'READ_ONLY',
        },
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

      await fixtureDb.customerCollaboration.update({
        where: { id: collaboration.id },
        data: { collaborationType: 'COLLABORATION' },
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
        await fixtureDb.customerCollaboration.deleteMany({
          where: { customer: { organizationId: tenantId } },
        })
        await fixtureDb.customer.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      if (otherTenantId) {
        await fixtureDb.customer.deleteMany({ where: { organizationId: otherTenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: otherTenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
