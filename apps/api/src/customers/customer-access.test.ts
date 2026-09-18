import assert from 'node:assert/strict'
import test from 'node:test'
import { NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../common/auth-user'
import type { DataScopeService } from '../common/services/data-scope.service'
import type { ResourcePoolsService } from '../modules/pool-rules/resource-pools.service'
import type { PrismaService } from '../prisma/prisma.service'
import { createLegacyId32 } from '../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../testing/prisma-test-db'
import { CustomerAccessService } from './customer-access.service'

const databaseUrl = process.env['DATABASE_URL']

test('CustomerAccess 使用 Prisma 保持租户隔离与协作访问裁决', { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl)
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prismaClient = testDb.client

  let tenantId: string | null = null
  let otherTenantId: string | null = null
  try {
    const [tenant, otherTenant] = await Promise.all([
      createPrismaTestTenant(prismaClient, 'p8-customer-access'),
      createPrismaTestTenant(prismaClient, 'p8-customer-other'),
    ])
    tenantId = tenant.id
    otherTenantId = otherTenant.id
    const member = await createPrismaTestUser(prismaClient, {
      tenantId: tenant.id,
      name: 'Collaborator',
    })
    const now = BigInt(Date.now())
    const memberId = member.id
    const customer = await prismaClient.orm.public.Customer.select('id').create({
      id: createLegacyId32(),
      name: 'Customer A',
      owner: null,
      organizationId: tenant.id,
      createTime: now,
      updateTime: now,
      createUser: memberId,
      updateUser: memberId,
    })
    const foreignCustomer = await prismaClient.orm.public.Customer.select('id').create({
      id: createLegacyId32(),
      name: 'Foreign Customer',
      owner: null,
      organizationId: otherTenant.id,
      createTime: now,
      updateTime: now,
      createUser: memberId,
      updateUser: memberId,
    })
    const collaboration = await prismaClient.orm.public.CustomerCollaboration.select('id').create({
      id: createLegacyId32(),
      createTime: now,
      updateTime: now,
      createUser: memberId,
      updateUser: memberId,
      userId: memberId,
      customerId: customer.id,
      collaborationType: 'READ_ONLY',
    })

    const dataScope = {
      matchesDirectOwner: async () => false,
    } as unknown as DataScopeService
    const resourcePools = {
      options: async () => [],
      isPoolManager: async () => false,
    } as unknown as ResourcePoolsService
    const service = new CustomerAccessService(
      { client: prismaClient } as PrismaService,
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

    await prismaClient.orm.public.CustomerCollaboration.where({ id: collaboration.id }).update({
      collaborationType: 'COLLABORATION',
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
      const organizationId = tenantId
      const customerIds = await prismaClient.orm.public.Customer.where({ organizationId })
        .select('id')
        .all()
      if (customerIds.length) {
        await prismaClient.orm.public.CustomerCollaboration.where((row) =>
          row.customerId.in(customerIds.map((item) => item.id)),
        ).deleteAll()
      }
      await prismaClient.orm.public.Customer.where({ organizationId }).deleteAll()
      await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
      await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
    }
    if (otherTenantId) {
      await prismaClient.orm.public.Customer.where({ organizationId: otherTenantId }).deleteAll()
      await prismaClient.orm.public.Tenants.where({ id: otherTenantId }).deleteAll()
    }
    await testDb.close()
  }
})
