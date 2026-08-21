import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AuthUser } from '../auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { DataScopeService } from './data-scope.service'

const departments = [
  { id: 'root', parentId: null },
  { id: 'sales', parentId: 'root' },
  { id: 'sales-child', parentId: 'sales' },
  { id: 'service', parentId: 'root' },
]

function service() {
  return new DataScopeService({
    department: {
      findMany: async () => departments,
    },
  } as unknown as PrismaService)
}

function actor(): AuthUser {
  return {
    id: 'actor',
    tenantId: 'tenant',
    email: 'actor@example.com',
    name: 'Actor',
    deptId: 'service',
    leaderId: null,
    permissions: ['menu:customer', 'customer:update', 'menu:opportunity'],
    roles: [
      {
        id: 'customer-view',
        name: '客户查看',
        permissions: ['menu:customer'],
        dataScope: 'CUSTOM',
        scopeDeptIds: ['sales'],
      },
      {
        id: 'customer-edit',
        name: '客户编辑',
        permissions: ['customer:update'],
        dataScope: 'SELF',
        scopeDeptIds: [],
      },
      {
        id: 'opportunity-all',
        name: '商机全部',
        permissions: ['menu:opportunity'],
        dataScope: 'ALL',
        scopeDeptIds: [],
      },
    ],
  }
}

describe('DataScopeService multi-role merge', () => {
  it('merges only roles that own the requested permission', async () => {
    const dataScope = service()
    assert.deepEqual(await dataScope.scopeFilter(actor(), 'menu:customer'), {
      OR: [{ ownerId: 'actor' }, { deptId: { in: ['sales', 'sales-child'] } }],
    })
    assert.deepEqual(await dataScope.scopeFilter(actor(), 'customer:update'), { ownerId: 'actor' })
  })

  it('does not leak an unrelated ALL scope into customer update', async () => {
    const dataScope = service()
    assert.equal(
      await dataScope.matchesResource(actor(), 'other-user', 'sales-child', 'customer:update'),
      false,
    )
    assert.equal(await dataScope.matchesResource(actor(), 'actor', 'service', 'customer:update'), true)
  })

  it('unions department scopes from multiple roles with the same permission', async () => {
    const user = actor()
    user.roles.push({
      id: 'customer-edit-sales',
      name: '销售客户编辑',
      permissions: ['customer:update'],
      dataScope: 'CUSTOM',
      scopeDeptIds: ['sales'],
    })
    const dataScope = service()
    assert.equal(
      await dataScope.matchesResource(user, 'other-user', 'sales-child', 'customer:update'),
      true,
    )
  })

  it('returns invisible when no role owns the requested permission', async () => {
    const dataScope = service()
    assert.deepEqual(await dataScope.scopeFilter(actor(), 'customer:delete'), {
      ownerId: '__permission_scope_denied__',
    })
  })
})
