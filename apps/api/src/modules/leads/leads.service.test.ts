import assert from 'node:assert/strict'
import test from 'node:test'
import { LeadsService } from './leads.service'

interface LeadsServiceTestHarness {
  fieldValues: {
    load: () => Promise<Map<string, Record<string, unknown>>>
  }
  moduleForms: {
    resolveFormLink: (...args: unknown[]) => Promise<Record<string, unknown>>
  }
  metadata: {
    fieldsMap: () => Promise<Map<string, { key: string; system: boolean; type: string }>>
  }
  mapLeadCustomData: (
    tenantId: string,
    module: 'customer' | 'contact' | 'opportunity',
    lead: never,
    requireAll: boolean,
  ) => Promise<Record<string, unknown>>
}

function serviceForFormLink(options?: {
  linkedValues?: Record<string, unknown>
  onResolve?: (args: unknown[]) => void
}) {
  const service = Object.create(LeadsService.prototype) as unknown as LeadsServiceTestHarness
  service.fieldValues = {
    load: async () => new Map([['lead-1', { cf_source: '标讯' }]]),
  }
  service.moduleForms = {
    resolveFormLink: async (...args: unknown[]) => {
      options?.onResolve?.(args)
      return options?.linkedValues ?? {}
    },
  }
  service.metadata = {
    fieldsMap: async () =>
      new Map([
        ['name', { key: 'name', system: true, type: 'text' }],
        ['cf_source', { key: 'cf_source', system: false, type: 'select' }],
        ['cf_target', { key: 'cf_target', system: false, type: 'select' }],
      ]),
  }
  return service
}

const lead = {
  id: 'lead-1',
  name: '测试线索',
  contact: '测试联系人',
  phone: '13800138000',
  owner: 'user-1',
} as never

test('线索转客户没有显式 CLUE_TO_CUSTOMER formLink 时不再按同 key 复制动态字段', async () => {
  let captured: unknown[] = []
  const service = serviceForFormLink({ onResolve: (args) => (captured = args) })

  const result = await service.mapLeadCustomData('tenant-1', 'customer', lead, true)

  assert.deepEqual(result, {})
  assert.equal(captured[0], 'tenant-1')
  assert.equal(captured[1], 'customer')
  assert.equal(captured[2], 'lead')
  assert.equal(captured[3], 'CLUE_TO_CUSTOMER')
  assert.deepEqual(captured[4], {
    name: '测试线索',
    contact: '测试联系人',
    phone: '13800138000',
    owner: 'user-1',
    cf_source: '标讯',
  })
})

test('线索转换仅保存显式 formLink 解析出的目标自定义字段', async () => {
  const service = serviceForFormLink({
    linkedValues: {
      name: '联动客户名称',
      cf_source: '有效来源',
      cf_target: 'mapped-value',
      unknown: 'ignored',
    },
  })

  const result = await service.mapLeadCustomData('tenant-1', 'customer', lead, true)

  assert.deepEqual(result, {
    cf_source: '有效来源',
    cf_target: 'mapped-value',
  })
})

test('联系人和商机转换使用 Cordys 对应 formLink 场景', async () => {
  const calls: unknown[][] = []
  const service = serviceForFormLink({ onResolve: (args) => calls.push(args) })

  await service.mapLeadCustomData('tenant-1', 'contact', lead, true)
  await service.mapLeadCustomData('tenant-1', 'opportunity', lead, true)

  assert.equal(calls[0]?.[3], 'CLUE_TO_CONTACT')
  assert.equal(calls[1]?.[3], 'CLUE_TO_OPPORTUNITY')
})
