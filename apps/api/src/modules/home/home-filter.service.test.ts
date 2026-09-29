/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { HomeFilterService } from './home-filter.service'

const user = { id: 'user-a', tenantId: 'tenant-a' } as any

function createService(options?: {
  scope?: { all: boolean; userIds: string[] | null }
  overdue?: Array<{ id: string }>
}) {
  const clues = {
    whereForPeriod: async (_user: unknown, payload: unknown, period: string) => ({
      payload,
      period,
    }),
  }
  const scopes = {
    resolve: async () => options?.scope ?? ({ all: true, userIds: null } as const),
  }
  const leadSla = {
    overdue: async () => options?.overdue ?? [],
  }
  return new HomeFilterService(clues as any, scopes as any, leadSla as any)
}

test('首页一次性筛选协议拒绝目标模块不匹配和非法周期', () => {
  const service = createService()
  assert.throws(
    () =>
      service.parse(
        JSON.stringify({ module: 'customer', period: 'TODAY', searchType: 'SELF', deptIds: [] }),
        'lead',
      ),
    BadRequestException,
  )
  assert.throws(
    () =>
      service.parse(
        JSON.stringify({ module: 'lead', period: 'LAST_WEEK', searchType: 'SELF', deptIds: [] }),
        'lead',
      ),
    BadRequestException,
  )
})

test('线索创建人维度仅展示统计，后端拒绝伪造跳转列表', async () => {
  const service = createService()
  await assert.rejects(
    () =>
      service.clueWhere(user, {
        module: 'lead',
        period: 'THIS_MONTH',
        searchType: 'SELF',
        deptIds: [],
        userField: 'CREATE_USER',
      }),
    /创建人维度仅用于首页展示/,
  )
})

test('线索工作台筛选支持阶段、已转客户和 SLA 超时真实列表', async () => {
  const service = createService({
    scope: { all: false, userIds: ['owner-a'] },
    overdue: [{ id: 'lead-overdue-1' }],
  })
  const where = await service.clueWhere(user, {
    module: 'lead',
    searchType: 'DEPARTMENT',
    deptIds: ['dept-a'],
    userField: 'OWNER',
    leadStageKey: 'VISITED',
    converted: true,
    overdue: true,
  })

  assert.equal((where as any).stage, 'VISITED')
  assert.equal((where as any).converted, true)
  assert.deepEqual((where as any).ids, ['lead-overdue-1'])
})

test('Customer 工作台筛选复用当前部门范围，不继承 Lead 专用条件', async () => {
  const service = createService({
    scope: { all: false, userIds: ['customer-owner-a'] },
  })
  const where = await service.customerWhere(user, {
    module: 'customer',
    searchType: 'DEPARTMENT',
    deptIds: ['dept-a'],
    filters: [{ key: 'cf_status', op: 'eq', value: 'PAID' }],
  })

  assert.equal((where as any).organizationId, 'tenant-a')
  assert.equal((where as any).inSharedPool, false)
  assert.deepEqual((where as any).owner, { in: ['customer-owner-a'] })
})
