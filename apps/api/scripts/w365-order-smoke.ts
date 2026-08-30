import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'

const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api'
// Smoke intentionally inspects heterogeneous JSON response shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

async function request(path: string, init: RequestInit = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, init)
  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer()
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

async function upload(token: string, path: string, data: Buffer, importType: 'ADD' | 'UPDATE' = 'ADD') {
  const form = new FormData()
  form.append('importType', importType)
  form.append(
    'file',
    new Blob([new Uint8Array(data)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'w365-order-smoke.xlsx',
  )
  return request(path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }, 201)
}

async function fillOrderTemplate(
  template: ArrayBuffer,
  values: Record<string, unknown>,
  productRows: Array<Record<string, unknown>>,
) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(template as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const sheet = workbook.worksheets[0]
  assert.ok(sheet, '订单导入模板缺少工作表')

  const columns = new Map<string, number>()
  for (let column = 1; column <= sheet.columnCount; column++) {
    const top = String(sheet.getCell(1, column).value ?? '').trim()
    const bottom = String(sheet.getCell(2, column).value ?? '').trim()
    if (bottom && bottom !== '产品明细') columns.set(bottom, column)
    if (top && top !== '产品明细') columns.set(top, column)
  }
  for (const [label, value] of Object.entries(values)) {
    const column = columns.get(label)
    assert.ok(column, `订单导入模板缺少主字段「${label}」`)
    sheet.getCell(3, column).value = value as ExcelJS.CellValue
  }
  for (const [index, product] of productRows.entries()) {
    const rowNumber = 3 + index
    for (const [label, value] of Object.entries(product)) {
      const column = columns.get(label)
      assert.ok(column, `订单导入模板缺少产品字段「${label}」`)
      sheet.getCell(rowNumber, column).value = value as ExcelJS.CellValue
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function cleanupStale(token: string) {
  const page = (await request('/order/page', json(token, { current: 1, pageSize: 500, keyword: 'W365 ' }), 201)).body as Json
  for (const item of page.list.filter((row: Json) => /^W365 (Smoke|Imported)/.test(row.name))) {
    await request(`/order/delete/${item.id}`, auth(token))
  }
  const views = (await request('/order/view/list', auth(token))).body as Json[]
  for (const view of views.filter((row) => /^W365 Smoke View/.test(row.name))) {
    await request(`/order/view/delete/${view.id}`, auth(token))
  }
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
  const userEmail = login.user.email as string
  await cleanupStale(token)

  const contracts = (await request('/contract/page', json(token, { current: 1, pageSize: 20 }), 201)).body as Json
  assert.ok(contracts.list.length > 0, '至少需要一个合同种子数据')
  const contract = contracts.list[0] as Json
  const contractId = contract.id as string
  const contractNumber = contract.number as string
  const customerId = contract.customerId as string
  const customerName = contract.customerName as string
  assert.ok(customerId && customerName, '合同必须关联客户')

  const products = (await request('/product/page', json(token, { current: 1, pageSize: 20 }), 201)).body as Json
  assert.ok(products.list.length > 0, '至少需要一个产品种子数据')
  const product = products.list[0] as Json

  const form = (await request('/order/module/form', auth(token))).body as Json
  const keys = form.fields.map((field: Json) => field.key)
  assert.deepEqual(keys.slice(0, 14), [
    'name',
    'number',
    'customerId',
    'contractId',
    'owner',
    'amount',
    'orderProducts',
    'orderProduct',
    'orderProductPrice',
    'orderProductNumber',
    'orderProductAmount',
    'orderDeliveryAddress',
    'orderConsignee',
    'orderPhone',
  ])
  assert.deepEqual(form.fields.slice(0, 14).map((field: Json) => field.sort), [...Array(14).keys()])
  assert.equal(form.fields.find((field: Json) => field.key === 'amount')?.type, 'formula')
  assert.equal(form.fields.find((field: Json) => field.key === 'orderProducts')?.hidden, true)
  assert.equal(form.fields.find((field: Json) => field.key === 'orderDeliveryAddress')?.system, false)
  assert.equal(form.fields.find((field: Json) => field.key === 'orderPhone')?.type, 'phone')
  const consigneeField = form.fields.find((field: Json) => field.key === 'orderConsignee') as Json
  await request('/order/view/list', auth(token))

  const suffix = Date.now().toString(36)
  const name = `W365 Smoke Order ${suffix}`
  const created = (
    await request(
      '/order/add',
      json(token, {
        name,
        customerId,
        contractId,
        owner: userId,
        moduleFields: [
          { fieldId: 'orderDeliveryAddress', fieldValue: 'W365 Smoke Address' },
          { fieldId: 'orderConsignee', fieldValue: 'W365 Consignee' },
          { fieldId: 'orderPhone', fieldValue: '13800138000' },
        ],
        products: [
          { product: product.id, productPrice: 10, productNumber: 2 },
          { product: product.id, productPrice: 5, productNumber: 3 },
        ],
      }),
      201,
    )
  ).body as Json
  assert.equal(created.name, name)
  assert.match(created.number, /^DD/)
  assert.equal(created.customerId, customerId)
  assert.equal(created.contractId, contractId)
  assert.equal(created.owner, userId)
  assert.equal(created.stageName, '新建')
  assert.equal(created.amount, 35)
  assert.equal(created.products.length, 2)
  assert.deepEqual(created.products.map((row: Json) => row.amount).sort((a: number, b: number) => a - b), [15, 20])

  const page = (await request('/order/page', json(token, { current: 1, pageSize: 100, keyword: name }), 201)).body as Json
  assert.ok(page.list.some((row: Json) => row.id === created.id))
  assert.equal(page.stages.length, 7)

  const detail = (await request(`/order/get/${created.id}`, auth(token))).body as Json
  assert.equal(detail.products.length, 2)
  assert.equal(
    detail.moduleFields.find((field: Json) => field.fieldId === consigneeField.id)?.fieldValue,
    'W365 Consignee',
  )
  const snapshot = (await request(`/order/get/snapshot/${created.id}`, auth(token))).body as Json
  assert.equal(snapshot.products.length, 2)
  assert.ok(snapshot.moduleFields.some((field: Json) => field.fieldValue === 'W365 Consignee'))
  await request(`/order/module/form/snapshot/${created.id}`, auth(token))

  const accountOrders = (
    await request('/account/order/page', json(token, { accountId: customerId, current: 1, pageSize: 100 }), 201)
  ).body as Json
  assert.ok(accountOrders.list.some((row: Json) => row.id === created.id))

  const view = (
    await request(
      '/order/view/add',
      json(token, {
        name: `W365 Smoke View ${suffix}`,
        searchMode: 'AND',
        conditions: [{ name: 'name', operator: 'contains', value: name, type: 'text' }],
      }),
      201,
    )
  ).body as Json
  assert.ok(view.id)
  const viewPage = (
    await request('/order/page', json(token, { current: 1, pageSize: 100, viewId: view.id }), 201)
  ).body as Json
  assert.ok(viewPage.list.some((row: Json) => row.id === created.id))

  await request(
    '/order/batch/update',
    json(token, { ids: [created.id], fieldId: consigneeField.id, fieldValue: 'W365 Batch Consignee' }),
    201,
  )
  const batchDetail = (await request(`/order/get/${created.id}`, auth(token))).body as Json
  assert.equal(
    batchDetail.moduleFields.find((field: Json) => field.fieldId === consigneeField.id)?.fieldValue,
    'W365 Batch Consignee',
  )

  await request('/order/sort', json(token, { id: created.id, stage: created.stage, pos: 1 }), 201)
  const statistic = (await request('/order/statistic', json(token, { keyword: name }), 201)).body as Json
  assert.equal(statistic.count, 1)
  assert.equal(statistic.amount, 35)
  await request(`/order/download/${created.id}`, auth(token))

  const templateResult = await request('/order/template/download?importType=ADD', auth(token))
  assert.match(templateResult.response.headers.get('content-type') ?? '', /spreadsheetml/)
  assert.ok((templateResult.body as ArrayBuffer).byteLength > 100)
  const importedName = `W365 Imported Order ${suffix}`
  const importFile = await fillOrderTemplate(
    templateResult.body as ArrayBuffer,
    {
      '订单名称': importedName,
      '关联客户': customerName,
      '关联合同': contractNumber,
      '负责人': userEmail,
      '收货地址': 'W365 Imported Address',
      '收货人': 'W365 Imported Consignee',
      '收货人联系方式': '13900139000',
    },
    [
      { '产品名称': product.name, '产品单价': 12.5, '数量': 2 },
      { '产品名称': product.name, '产品单价': 3, '数量': 4 },
    ],
  )
  assert.equal(((await upload(token, '/order/import/pre-check', importFile)).body as Json).successCount, 1)
  assert.equal(((await upload(token, '/order/import', importFile)).body as Json).successCount, 1)
  const importedPage = (
    await request('/order/page', json(token, { current: 1, pageSize: 100, keyword: importedName }), 201)
  ).body as Json
  const imported = importedPage.list.find((row: Json) => row.name === importedName) as Json
  assert.ok(imported)
  assert.equal(imported.products.length, 2)
  assert.equal(imported.amount, 37)
  assert.equal(
    imported.moduleFields.find((field: Json) => field.fieldId === consigneeField.id)?.fieldValue,
    'W365 Imported Consignee',
  )

  const task = (
    await request(
      '/order/export-all',
      json(token, {
        current: 1,
        pageSize: 100,
        keyword: 'W365 ',
        fileName: `w365-order-${suffix}`,
        headList: [
          'name',
          'number',
          'customerId',
          'contractId',
          'owner',
          'amount',
          'orderProduct',
          'orderProductPrice',
          'orderProductNumber',
          'orderProductAmount',
        ],
      }),
      201,
    )
  ).body as Json
  assert.equal(task.status, 'SUCCESS')

  await request('/orders', auth(token), 404)

  await request(`/order/view/delete/${view.id}`, auth(token))
  await request(`/order/delete/${imported.id}`, auth(token))
  await request(`/order/delete/${created.id}`, auth(token))
  console.log('W3.6.5 order direct smoke passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
