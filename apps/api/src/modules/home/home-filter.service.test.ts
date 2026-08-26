/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { HomeFilterService } from './home-filter.service'

const user = { id: 'user-a', tenantId: 'tenant-a' } as any

function createService() {
  const clues = {
    whereForPeriod: async (_user: unknown, payload: unknown, period: string) => ({
      payload,
      period,
    }),
  }
  const opportunities = {
    whereForPeriod: async (_user: unknown, payload: unknown, period: string, scenario: string) => ({
      payload,
      period,
      scenario,
    }),
  }
  return new HomeFilterService(clues as any, opportunities as any)
}

test('首页一次性筛选协议拒绝目标模块不匹配、非法周期和非法状态', () => {
  const service = createService()
  assert.throws(
    () =>
      service.parse(
        JSON.stringify({ module: 'opportunity', period: 'TODAY', searchType: 'SELF', deptIds: [] }),
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
  assert.throws(
    () =>
      service.parse(
        JSON.stringify({
          module: 'opportunity',
          period: 'TODAY',
          searchType: 'SELF',
          deptIds: [],
          status: 'FAIL',
        }),
        'opportunity',
      ),
    BadRequestException,
  )
})

test('线索创建人维度仅展示统计，后端拒绝伪造跳转列表', () => {
  const service = createService()
  assert.throws(
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

test('商机首页筛选把 SUCCESS/AFOOT 分别映射到与统计相同的场景查询', async () => {
  const service = createService()
  const base = {
    module: 'opportunity' as const,
    period: 'THIS_MONTH' as const,
    searchType: 'DEPARTMENT' as const,
    deptIds: ['sales'],
    timeField: 'EXPECTED_END_TIME' as const,
  }
  const success = await service.opportunityWhere(user, { ...base, status: 'SUCCESS' })
  const underway = await service.opportunityWhere(user, { ...base, status: 'AFOOT' })
  assert.equal((success as any).scenario, 'SUCCESS')
  assert.equal((underway as any).scenario, 'UNDERWAY')
  assert.equal((success as any).period, 'THIS_MONTH')
})
