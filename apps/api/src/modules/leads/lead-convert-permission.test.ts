import assert from 'node:assert/strict'
import test from 'node:test'
import { ForbiddenException } from '@nestjs/common'
import { hasPermission, PERMISSION_TREE } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator'
import { ClueController } from './clue.controller'
import { LeadsService } from './leads.service'

const integrationUser = {
  id: 'integration-user',
  tenantId: 'tenant-1',
  email: null,
  name: '接待系统',
  deptId: null,
  leaderId: null,
  roles: [],
  permissions: ['lead:update', 'customer:create'],
} satisfies AuthUser

test('线索角色权限树仅增加独立的手动转化权限', () => {
  const lead = PERMISSION_TREE.find((node) => node.code === 'menu:lead')
  assert.equal(lead?.children?.filter((node) => node.code === 'lead:convert').length, 1)
  assert.equal(lead?.children?.find((node) => node.code === 'lead:convert')?.label, '转化')
  assert.equal(hasPermission(integrationUser.permissions, 'lead:convert'), false)
  assert.equal(hasPermission([...integrationUser.permissions, 'lead:convert'], 'lead:convert'), true)
})

test('三条人工转化/关联 API 都要求 lead:convert，既有权限仍保留', () => {
  for (const [handler, alsoRequired] of [
    ['transform', 'lead:update'],
    ['transitionCustomer', 'customer:create'],
    ['retransitionCustomer', 'lead:update'],
  ] as const) {
    const fn = ClueController.prototype[handler]
    const declared = Reflect.getMetadata(PERMISSIONS_KEY, fn) as string[]
    assert.ok(declared.includes('lead:convert'), handler)
    assert.ok(declared.includes(alsoRequired), handler)
  }
})

test('只有编辑和新建客户权限的普通用户不能调用三条人工转化服务', async () => {
  // 直接调用服务：保证权限校验在读取或修改数据之前执行，不只依赖控制器装饰器。
  const service = Object.create(LeadsService.prototype) as LeadsService
  await assert.rejects(
    service.transform(integrationUser, { clueId: 'lead-a' }),
    (error: unknown) => error instanceof ForbiddenException && error.message === '无线索转化权限',
  )
  await assert.rejects(
    service.transitionCustomer(integrationUser, { clueId: 'lead-a' } as never),
    (error: unknown) => error instanceof ForbiddenException && error.message === '无线索转化权限',
  )
  await assert.rejects(
    service.retransitionCustomer(integrationUser, { clueIds: ['lead-a'], customerId: 'customer-a' }),
    (error: unknown) => error instanceof ForbiddenException && error.message === '无线索转化权限',
  )
})

test('接待系统自动转化准备流程仍只需要既有权限', async () => {
  // 自动接待走 prepareResolvedLeadConversion，不调用三个人工控制器方法。
  const service = Object.create(LeadsService.prototype) as unknown as {
    ensureInScope: (_user: AuthUser, _id: string, permission: string) => Promise<unknown>
    mapLeadCustomData: (...args: unknown[]) => Promise<Record<string, unknown>>
    customers: { prepareCreateForTransaction: (...args: unknown[]) => Promise<unknown> }
    prepareLeadAssociation: (...args: unknown[]) => Promise<unknown>
    prepareResolvedLeadConversion: LeadsService['prepareResolvedLeadConversion']
  }
  let scopePermission: unknown
  service.ensureInScope = async (_user, _id, permission) => {
    scopePermission = permission
    return { id: 'lead-a', name: '访客测试', owner: 'user-a', transitionId: null, transitionType: null }
  }
  service.mapLeadCustomData = async () => ({})
  service.customers = { prepareCreateForTransaction: async () => ({ owner: { id: 'user-a' } }) }
  service.prepareLeadAssociation = async () => ({ ownerMap: new Map() })
  const prepared = await service.prepareResolvedLeadConversion(integrationUser, 'lead-a')
  assert.equal(scopePermission, 'lead:update')
  assert.equal(prepared.customerCreateDto.name, '访客测试')
})
