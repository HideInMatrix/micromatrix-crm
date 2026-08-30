import assert from 'node:assert/strict'

const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api'
// Smoke intentionally inspects heterogeneous JSON response shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

async function request(path: string, init: RequestInit = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, init)
  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text()
  assert.equal(
    response.status,
    expected,
    `${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`,
  )
  return { response, body }
}

function json(token: string, body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

function auth(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } }
}

async function main() {
  const login = (
    await request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@demo.com', password: 'admin123' }),
    })
  ).body as Json
  const token = login.accessToken as string
  const userId = login.user.id as string
  assert.ok(token && userId, '管理员登录结果缺少 token/userId')

  const original = (await request('/order/stage/get', auth(token))).body as Json
  const originalStages = original.stageConfigList as Json[]
  assert.ok(originalStages.length >= 3, '订单阶段至少需要 3 个用于专项 Smoke')
  const originalIds = originalStages.map((stage) => stage.id as string)
  const originalRollback = {
    afootRollBack: Boolean(original.afootRollBack),
    endRollBack: Boolean(original.endRollBack),
  }
  const originalCirculationType = String(original.circulationType ?? 'NORMAL')
  const originalAdvanced = ((original.advancedConfigs ?? []) as Json[]).map((row) => ({
    originId: row.originId,
    targets: row.targets ?? [],
  }))

  const form = (await request('/order/module/form', auth(token))).body as Json
  const consigneeField = form.fields.find((field: Json) => field.key === 'orderConsignee') as Json
  assert.ok(consigneeField?.id, '订单表单缺少 orderConsignee 动态字段')

  const contracts = (
    await request('/contract/page', json(token, { current: 1, pageSize: 20 }), 201)
  ).body as Json
  assert.ok(contracts.list.length > 0, '订单状态 Smoke 至少需要一条合同种子')
  const contract = contracts.list[0] as Json
  const customerId = contract.customerId as string
  const contractId = contract.id as string
  assert.ok(customerId && contractId, '合同种子必须关联客户')

  const suffix = Date.now().toString(36)
  let orderId: string | null = null
  let tempStageId: string | null = null

  try {
    const added = await request(
      '/order/stage/add',
      json(token, {
        name: `W365 Stage ${suffix}`,
        type: 'AFOOT',
        targetId: originalStages[0].id,
        dropPosition: 1,
      }),
      201,
    )
    tempStageId = String(added.body)
    assert.ok(tempStageId, '新增订单阶段未返回 ID')

    await request(
      '/order/stage/update',
      json(token, { id: tempStageId, name: `W365 Stage Renamed ${suffix}` }),
      201,
    )
    await request('/order/stage/sort', json(token, [...originalIds, tempStageId]), 201)
    const afterStageCrud = (await request('/order/stage/get', auth(token))).body as Json
    const temp = afterStageCrud.stageConfigList.find((stage: Json) => stage.id === tempStageId)
    assert.equal(temp?.name, `W365 Stage Renamed ${suffix}`)
    assert.equal(temp?.pos, originalIds.length + 1)

    await request(
      '/order/stage/update-rollback',
      json(token, { afootRollBack: false, endRollBack: false }),
      201,
    )
    await request('/order/stage/circulation-type/NORMAL', auth(token))

    const normalStages = (await request('/order/stage/get', auth(token))).body as Json
    const [first, second, third] = normalStages.stageConfigList as Json[]
    assert.equal(normalStages.circulationType, 'NORMAL')
    assert.equal(normalStages.afootRollBack, false)

    const order = (
      await request(
        '/order/add',
        json(token, {
          name: `W365 Stage Order ${suffix}`,
          customerId,
          contractId,
          owner: userId,
          amount: 10,
        }),
        201,
      )
    ).body as Json
    orderId = order.id as string
    assert.equal(order.stage, first.id)
    assert.equal(order.stageName, first.name)

    const withData = (await request('/order/stage/get', auth(token))).body as Json
    assert.equal(
      withData.stageConfigList.find((stage: Json) => stage.id === first.id)?.stageHasData,
      true,
    )
    await request(`/order/stage/delete/${first.id}`, auth(token), 400)

    const forward = (
      await request(
        '/order/update/stage',
        json(token, { id: orderId, stage: second.id }),
        201,
      )
    ).body as Json
    assert.equal(forward.stage, second.id)
    await request('/order/update/stage', json(token, { id: orderId, stage: first.id }), 400)

    await request(
      '/order/stage/update-rollback',
      json(token, { afootRollBack: true, endRollBack: false }),
      201,
    )
    const rolledBack = (
      await request(
        '/order/update/stage',
        json(token, { id: orderId, stage: first.id }),
        201,
      )
    ).body as Json
    assert.equal(rolledBack.stage, first.id)

    await request(
      '/order/stage/advanced/config',
      json(token, {
        circulationType: 'ADVANCED',
        circulationSettings: [
          {
            originId: first.id,
            targets: [
              {
                targetId: second.id,
                enable: true,
                circulationFieldValues: [
                  { fieldId: consigneeField.id, required: true, valueType: 'FIELD_VALUE' },
                ],
              },
            ],
          },
        ],
      }),
      201,
    )
    const advanced = (await request('/order/stage/get', auth(token))).body as Json
    assert.equal(advanced.circulationType, 'ADVANCED')
    assert.equal(advanced.advancedConfigs.length, 1)
    assert.equal(advanced.advancedConfigs[0].originId, first.id)

    await request('/order/update/stage', json(token, { id: orderId, stage: second.id }), 400)
    const advancedMoved = (
      await request(
        '/order/update/stage',
        json(token, {
          id: orderId,
          stage: second.id,
          fields: [{ fieldId: consigneeField.id, fieldValue: 'W365 Stage Required' }],
        }),
        201,
      )
    ).body as Json
    assert.equal(advancedMoved.stage, second.id)
    assert.equal(
      advancedMoved.moduleFields.find((field: Json) => field.fieldId === consigneeField.id)?.fieldValue,
      'W365 Stage Required',
    )
    assert.ok(Number(advancedMoved.pos) >= 1)

    await request('/order/update/stage', json(token, { id: orderId, stage: third.id }), 400)
    const detail = (await request(`/order/get/${orderId}`, auth(token))).body as Json
    assert.equal(detail.stage, second.id)
    assert.equal(
      detail.moduleFields.find((field: Json) => field.fieldId === consigneeField.id)?.fieldValue,
      'W365 Stage Required',
    )

    await request(`/order/delete/${orderId}`, auth(token))
    orderId = null
    await request(`/order/stage/delete/${tempStageId}`, auth(token))
    tempStageId = null
    console.log('W3.6.5 order stage smoke passed')
  } finally {
    if (orderId) {
      await request(`/order/delete/${orderId}`, auth(token)).catch(() => undefined)
    }

    await request(
      '/order/stage/advanced/config',
      json(token, {
        circulationType: originalCirculationType,
        circulationSettings: originalAdvanced,
      }),
      201,
    ).catch(() => undefined)
    await request('/order/stage/update-rollback', json(token, originalRollback), 201).catch(
      () => undefined,
    )

    if (tempStageId) {
      await request(`/order/stage/delete/${tempStageId}`, auth(token)).catch(() => undefined)
    }
    await request('/order/stage/sort', json(token, originalIds), 201).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
