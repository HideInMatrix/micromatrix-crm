import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'

const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api'
// Smoke assertions intentionally inspect heterogeneous JSON response shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

async function request(path: string, init: RequestInit = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, init)
  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer()
  assert.equal(response.status, expected, `${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`)
  return { response, body }
}

function json(token: string, body?: unknown): RequestInit {
  return { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }
}

function auth(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } }
}

async function workbook(headers: string[], values: unknown[]) {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('导入模板')
  sheet.addRow(headers)
  sheet.addRow(values)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

async function upload(token: string, path: string, data: Buffer) {
  const form = new FormData()
  form.append('importType', 'ADD')
  form.append('file', new Blob([new Uint8Array(data)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'smoke.xlsx')
  return request(path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }, 201)
}

async function cleanupStaleSmokeData(token: string) {
  const cleanup = async (kind: 'record' | 'plan') => {
    const page = (await request(
      `/contract/payment-${kind}/page`,
      json(token, { current: 1, pageSize: 500, keyword: 'W364' }),
      201,
    )).body as Json
    const stale = page.list.filter((item: Json) => /^W364 (Smoke|Imported)/.test(item.name))
    for (const item of stale) {
      await request(`/contract/payment-${kind}/delete/${item.id}`, auth(token))
    }
    return stale.length
  }

  // Records must be removed first because plans may still be referenced by them.
  const records = await cleanup('record')
  const plans = await cleanup('plan')
  if (records || plans) console.log(`cleaned stale W364 smoke data: records=${records}, plans=${plans}`)
}

async function main() {
  const login = (await request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.com', password: 'admin123' }) })).body as Json
  const token = login.accessToken as string
  const userId = login.user.id as string
  await cleanupStaleSmokeData(token)
  const contracts = (await request('/contract/page', json(token, { current: 1, pageSize: 20 }), 201)).body as Json
  assert.ok(contracts.list.length > 0, '至少需要一个合同种子数据')
  const contractId = contracts.list[0].id as string
  const customerId = contracts.list[0].customerId as string
  assert.ok(customerId, '合同种子数据必须关联客户')

  await request('/account/contract/payment-plan/page', json(token, { accountId: customerId, current: 1, pageSize: 10 }), 201)
  await request('/account/contract/payment-record/page', json(token, { accountId: customerId, current: 1, pageSize: 10 }), 201)
  await request(`/account/contract/payment-plan/statistic/${customerId}`, auth(token))
  await request(`/account/contract/payment-record/statistic/${customerId}`, auth(token))

  const planForm = (await request('/contract/payment-plan/module/form', auth(token))).body as Json
  const recordForm = (await request('/contract/payment-record/module/form', auth(token))).body as Json
  await request('/contract/payment-plan/view/list', auth(token))
  await request('/contract/payment-record/view/list', auth(token))
  assert.deepEqual(planForm.fields.filter((field: Json) => field.system).map((field: Json) => field.key), ['name', 'contractId', 'owner', 'planAmount', 'planEndTime'])
  assert.ok(recordForm.fields.some((field: Json) => field.key === 'contractPaymentRecordBank' && !field.system))
  assert.ok(recordForm.fields.some((field: Json) => field.key === 'contractPaymentRecordBankNo' && !field.system))

  const suffix = Date.now().toString(36)
  const plan = (await request('/contract/payment-plan/add', json(token, { name: `W364 Smoke Plan ${suffix}`, contractId, planAmount: 12345.67, planEndTime: Date.now() + 7 * 86400000 }), 201)).body as Json
  assert.equal(plan.owner, userId)
  assert.equal(plan.planStatus, 'PENDING')
  const planPage = (await request('/contract/payment-plan/page', json(token, { current: 1, pageSize: 100, contractId }), 201)).body as Json
  assert.ok(planPage.list.some((item: Json) => item.id === plan.id))
  const updatedPlan = (await request('/contract/payment-plan/update', json(token, { id: plan.id, planStatus: 'PARTIALLY_COMPLETED' }), 201)).body as Json
  assert.equal(updatedPlan.planStatus, 'PARTIALLY_COMPLETED')
  await request('/contract/payment-plan/batch/update', json(token, { ids: [plan.id], fieldId: 'owner', fieldValue: userId }), 201)

  const record = (await request('/contract/payment-record/add', json(token, {
    name: `W364 Smoke Record ${suffix}`, contractId, paymentPlanId: plan.id, recordAmount: 321.45, recordEndTime: Date.now(),
    moduleFields: [{ fieldId: 'contractPaymentRecordBank', fieldValue: '1' }, { fieldId: 'contractPaymentRecordBankNo', fieldValue: '1' }],
  }), 201)).body as Json
  assert.equal(record.owner, userId)
  assert.match(record.no, /^PAY-\d{6}-\d{6}$/)
  assert.equal(record.paymentPlanId, plan.id)
  const originalNo = record.no
  const updatedRecord = (await request('/contract/payment-record/update', json(token, { id: record.id, no: 'MUST-NOT-CHANGE', recordAmount: 654.32 }), 201)).body as Json
  assert.equal(updatedRecord.no, originalNo)
  assert.equal(updatedRecord.recordAmount, 654.32)

  const bankField = recordForm.fields.find((field: Json) => field.key === 'contractPaymentRecordBank')
  await request('/contract/payment-record/batch/update', json(token, { ids: [record.id], fieldId: bankField.id, fieldValue: '2' }), 201)
  const recordDetail = (await request(`/contract/payment-record/get/${record.id}`, auth(token))).body as Json
  assert.equal(recordDetail.moduleFields.find((field: Json) => field.fieldId === bankField.id)?.fieldValue, '2')
  const statistic = (await request('/contract/payment-record/statistic', json(token, { contractId }), 201)).body as Json
  assert.ok(statistic.count >= 1)
  assert.ok(statistic.recordAmount >= 654.32)

  for (const [path, headList] of [
    ['/contract/payment-plan/export-all', ['name', 'contractId', 'owner', 'planAmount', 'planEndTime', 'planStatus']],
    ['/contract/payment-record/export-all', ['name', 'no', 'contractId', 'owner', 'recordAmount', 'recordEndTime', 'contractPaymentRecordBank']],
  ] as const) {
    const task = (await request(path, json(token, { current: 1, pageSize: 100, contractId, fileName: `w364-${suffix}`, headList }), 201)).body as Json
    assert.equal(task.status, 'SUCCESS')
  }

  for (const path of ['/contract/payment-plan/template/download?importType=ADD', '/contract/payment-record/template/download?importType=ADD']) {
    const { response, body } = await request(path, auth(token))
    assert.match(response.headers.get('content-type') ?? '', /spreadsheetml/)
    assert.ok((body as ArrayBuffer).byteLength > 100)
  }

  const importedPlanName = `W364 Imported Plan ${suffix}`
  const planXlsx = await workbook(['回款计划名称', '合同', '负责人', '计划回款金额', '计划回款时间'], [importedPlanName, contractId, userId, 88.88, new Date(Date.now() + 86400000)])
  assert.equal(((await upload(token, '/contract/payment-plan/import/pre-check', planXlsx)).body as Json).successCount, 1)
  assert.equal(((await upload(token, '/contract/payment-plan/import', planXlsx)).body as Json).successCount, 1)
  const importedPlans = (await request('/contract/payment-plan/page', json(token, { current: 1, pageSize: 100, contractId, keyword: importedPlanName }), 201)).body as Json
  const importedPlan = importedPlans.list.find((item: Json) => item.name === importedPlanName)
  assert.ok(importedPlan)

  const importedRecordName = `W364 Imported Record ${suffix}`
  const recordXlsx = await workbook(
    ['回款记录名称', '合同名称', '回款计划', '负责人', '回款时间', '回款金额', '收款银行', '收款银行账号'],
    [importedRecordName, contractId, importedPlan.id, userId, new Date(), 66.66, '中国银行', '银行账号1'],
  )
  assert.equal(((await upload(token, '/contract/payment-record/import/pre-check', recordXlsx)).body as Json).successCount, 1)
  assert.equal(((await upload(token, '/contract/payment-record/import', recordXlsx)).body as Json).successCount, 1)
  const importedRecords = (await request('/contract/payment-record/page', json(token, { current: 1, pageSize: 100, contractId, keyword: importedRecordName }), 201)).body as Json
  const importedRecord = importedRecords.list.find((item: Json) => item.name === importedRecordName)
  assert.ok(importedRecord)
  assert.match(importedRecord.no, /^PAY-\d{6}-\d{6}$/)

  await request(`/contracts/${contractId}/receivable-plans`, auth(token), 404)
  await request(`/contracts/${contractId}/receivable-records`, auth(token), 404)
  await request(`/contract/payment-record/delete/${importedRecord.id}`, auth(token))
  await request(`/contract/payment-plan/delete/${importedPlan.id}`, auth(token))
  await request(`/contract/payment-record/delete/${record.id}`, auth(token))
  await request(`/contract/payment-plan/delete/${plan.id}`, auth(token))
  console.log('W3.6.4 contract payment smoke passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
