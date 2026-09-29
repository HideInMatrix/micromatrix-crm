import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { FieldVO } from '@micromatrix/shared'
import { CustomersService } from './customers.service'

function field(input: Partial<FieldVO> & Pick<FieldVO, 'id' | 'key' | 'label' | 'type'>): FieldVO {
  return {
    module: 'customer',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: null,
    ...input,
  }
}

test('Customer 外部动态字段写入同时支持 field id 和稳定 key，并归一为 key', async () => {
  const service = Object.create(CustomersService.prototype) as unknown as {
    metadata: {
      listFields: () => Promise<FieldVO[]>
      validateBatchFieldValue: (field: FieldVO, value: unknown) => void
    }
    normalizeWritableDynamicFields: CustomersService['normalizeWritableDynamicFields']
  }
  service.metadata = {
    listFields: async () => [
      field({ id: 'status-id', key: 'cf_status', label: '报名状态', type: 'select' }),
      field({ id: 'amount-id', key: 'cf_amount', label: '实收金额', type: 'currency' }),
    ],
    validateBatchFieldValue: () => undefined,
  }

  const values = await service.normalizeWritableDynamicFields(
    { tenantId: 'tenant-1' } as never,
    { 'status-id': '已缴费', cf_amount: 1000 },
  )
  assert.deepEqual(values, { cf_status: '已缴费', cf_amount: 1000 })
})

test('Customer 外部动态字段写入拒绝系统字段和同一字段重复身份', async () => {
  const status = field({ id: 'status-id', key: 'cf_status', label: '报名状态', type: 'select' })
  const service = Object.create(CustomersService.prototype) as unknown as {
    metadata: {
      listFields: () => Promise<FieldVO[]>
      validateBatchFieldValue: (field: FieldVO, value: unknown) => void
    }
    normalizeWritableDynamicFields: CustomersService['normalizeWritableDynamicFields']
  }
  service.metadata = {
    listFields: async () => [
      status,
      field({ id: 'name-id', key: 'name', label: '客户名称', type: 'text', system: true }),
    ],
    validateBatchFieldValue: () => undefined,
  }
  const user = { tenantId: 'tenant-1' } as never

  await assert.rejects(
    () => service.normalizeWritableDynamicFields(user, { name: '张三' }),
    BadRequestException,
  )
  await assert.rejects(
    () => service.normalizeWritableDynamicFields(user, { 'status-id': '已缴费', cf_status: '已报名' }),
    BadRequestException,
  )
})
