/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import test from 'node:test'
import { HomeDepartmentScopeService } from './home-department-scope.service'

const departments = [
  { id: 'root', name: '公司', parentId: null },
  { id: 'sales', name: '销售部', parentId: 'root' },
  { id: 'sales-a', name: '销售一部', parentId: 'sales' },
  { id: 'delivery', name: '交付部', parentId: 'root' },
]

function authUser(roles: Array<Record<string, unknown>>, deptId = 'sales') {
  return {
    id: 'user-self',
    tenantId: 'tenant-a',
    email: 'self@example.com',
    name: 'Self',
    deptId,
    leaderId: null,
    permissions: [...new Set(roles.flatMap((role) => role.permissions as string[]))],
    roles,
  } as any
}

function createService(scopeResult: Record<string, unknown>) {
  let requestedUserDeptIds: string[] = []
  const prisma = {
    department: { findMany: async () => departments },
    user: {
      findMany: async ({ where }: any) => {
        requestedUserDeptIds = [...(where.deptId?.in ?? [])]
        return requestedUserDeptIds.map((deptId) => ({ id: `user-${deptId}` }))
      },
    },
  }
  const dataScope = {
    resolveScope: async () => scopeResult,
    collectWithDescendants: async (_tenantId: string, rootId: string) =>
      rootId === 'sales' ? ['sales', 'sales-a'] : [rootId],
    collectManyWithDescendants: async (_tenantId: string, rootIds: string[]) =>
      rootIds.flatMap((rootId) => (rootId === 'sales' ? ['sales', 'sales-a'] : [rootId])),
  }
  return {
    service: new HomeDepartmentScopeService(prisma as any, dataScope as any),
    requestedUserDeptIds: () => requestedUserDeptIds,
  }
}

test('首页部门树对 ALL 数据范围返回当前组织完整部门树', async () => {
  const { service } = createService({ hasPermission: true, all: true, deptIds: [] })
  const tree = await service.tree(
    authUser([{ permissions: ['menu:lead'], dataScope: 'ALL', scopeDeptIds: [] }]),
  )
  assert.deepEqual(tree, [
    {
      id: 'root',
      name: '公司',
      children: [
        { id: 'sales', name: '销售部', children: [{ id: 'sales-a', name: '销售一部' }] },
        { id: 'delivery', name: '交付部' },
      ],
    },
  ])
})

test('首页部门树 DEPT_AND_CHILD 只保留本部门及下级且移除无权父节点', async () => {
  const { service } = createService({
    hasPermission: true,
    all: false,
    deptIds: ['sales', 'sales-a'],
  })
  const tree = await service.tree(
    authUser([
      { permissions: ['menu:opportunity'], dataScope: 'DEPT_AND_CHILD', scopeDeptIds: [] },
    ]),
  )
  assert.deepEqual(tree, [
    { id: 'sales', name: '销售部', children: [{ id: 'sales-a', name: '销售一部' }] },
  ])
})

test('DEPARTMENT 请求只能取当前目标权限真正允许的部门交集', async () => {
  const { service, requestedUserDeptIds } = createService({
    hasPermission: true,
    all: false,
    deptIds: ['sales', 'sales-a'],
  })
  const resolved = await service.resolve(
    authUser([{ permissions: ['menu:lead'], dataScope: 'CUSTOM', scopeDeptIds: ['sales'] }]),
    'menu:lead',
    'DEPARTMENT',
    ['sales-a', 'delivery'],
  )
  assert.deepEqual(resolved.deptIds, ['sales-a'])
  assert.deepEqual(requestedUserDeptIds(), ['sales-a'])
  assert.deepEqual(resolved.userIds, ['user-sales-a'])
})

test('目标模块无权限时首页 Scope 返回空集合而不是回退到其它角色范围', async () => {
  const { service } = createService({ hasPermission: false, all: false, deptIds: [] })
  const resolved = await service.resolve(
    authUser([{ permissions: ['menu:customer'], dataScope: 'ALL', scopeDeptIds: [] }]),
    'menu:lead',
    'ALL',
    [],
  )
  assert.deepEqual(resolved, { all: false, self: false, deptIds: [], userIds: [] })
})
