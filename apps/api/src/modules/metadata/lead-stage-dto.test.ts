import assert from 'node:assert/strict'
import test from 'node:test'
import { ValidationPipe } from '@nestjs/common'
import { UpdateFormPropDto } from './dto/field.dto'

const validationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
})

test('线索状态 PATCH DTO 保留每个状态对象的字段，不会将对象转换为空数组', async () => {
  const input = {
    leadStages: [
      { key: 'STAGE_ALPHA', name: '进行中', kind: 'ACTIVE', enabled: true },
      { key: 'STAGE_BETA', name: '成功', kind: 'SUCCESS', enabled: false },
    ],
  }

  const result = (await validationPipe.transform(input, {
    type: 'body',
    metatype: UpdateFormPropDto,
    data: undefined,
  })) as UpdateFormPropDto

  assert.deepEqual(JSON.parse(JSON.stringify(result.leadStages)), input.leadStages)
  assert.ok(result.leadStages?.every((stage) => !Array.isArray(stage)))
})

test('线索状态 PATCH DTO 拒绝缺少标识或非法类型的状态', async () => {
  await assert.rejects(
    validationPipe.transform(
      { leadStages: [{ key: 'bad key', name: '进行中', kind: 'ACTIVE', enabled: true }] },
      { type: 'body', metatype: UpdateFormPropDto, data: undefined },
    ),
  )
  await assert.rejects(
    validationPipe.transform(
      { leadStages: [{ key: 'STAGE_ALPHA', name: '进行中', kind: 'UNKNOWN', enabled: true }] },
      { type: 'body', metatype: UpdateFormPropDto, data: undefined },
    ),
  )
})
