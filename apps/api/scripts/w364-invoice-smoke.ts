import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'

const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api'
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
function auth(token: string): RequestInit { return { headers: { authorization: `Bearer ${token}` } } }
function asBoolean(body: unknown) {
  if (typeof body === 'boolean') return body
  if (typeof body === 'string') return body.trim() === 'true'
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body).trim() === 'true'
  return false
}
async function workbook(headers: string[], values: unknown[]) {
  const wb = new ExcelJS.Workbook(); const sheet = wb.addWorksheet('导入模板'); sheet.addRow(headers); sheet.addRow(values)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
async function upload(token: string, path: string, data: Buffer) {
  const form = new FormData(); form.append('importType', 'ADD')
  form.append('file', new Blob([new Uint8Array(data)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'invoice-smoke.xlsx')
  return request(path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }, 201)
}
async function cleanupStale(token: string) {
  const page = (await request('/invoice/page', json(token, { current: 1, pageSize: 500, keyword: 'W364 Invoice' }), 201)).body as Json
  for (const row of page.list.filter((item: Json) => /^W364 Invoice (Smoke|Imported)/.test(item.name))) await request(`/invoice/delete/${row.id}`, auth(token))
  const titles = (await request('/contract/business-title/page', json(token, { current: 1, pageSize: 500, keyword: 'W364 Invoice Title' }), 201)).body as Json
  for (const row of titles.list.filter((item: Json) => /^W364 Invoice Title/.test(item.name))) {
    const used = (await request(`/contract/business-title/invoice/check/${row.id}`, auth(token))).body
    if (!asBoolean(used)) await request(`/contract/business-title/delete/${row.id}`, auth(token))
  }
}
function titlePayload(name: string) {
  const stamp = Date.now().toString()
  return { name, type: 'CUSTOM', identificationNumber: `91310000${stamp.slice(-10)}`, openingBank: '中国银行上海分行', bankAccount: '6222000000000000000', registrationAddress: '上海市浦东新区测试路1号', phoneNumber: '021-12345678', registeredCapital: '1000万人民币', companySize: '100-499人', registrationNumber: `REG-${Date.now().toString(36)}`, province: '上海市', city: '上海市', scale: '中型', industry: '软件与信息服务', remark: 'W3.6.4 invoice smoke' }
}

async function main() {
  const login = (await request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.com', password: 'admin123' }) })).body as Json
  const token = login.accessToken as string; const userId = login.user.id as string
  await cleanupStale(token)
  const contracts = (await request('/contract/page', json(token, { current: 1, pageSize: 100 }), 201)).body as Json
  const contract = contracts.list.find((item: Json) => Number(item.amount ?? 0) >= 100)
  assert.ok(contract, '至少需要一个金额不小于100的合同种子数据')
  const contractId = contract.id as string; const customerId = contract.customerId as string
  assert.ok(customerId, '合同必须关联客户')

  const form = (await request('/invoice/module/form', auth(token))).body as Json
  assert.deepEqual(form.fields.filter((field: Json) => field.system).map((field: Json) => field.key), ['name', 'contractId', 'owner', 'amount', 'invoiceType', 'taxRate', 'businessTitleId'])
  await request('/invoice/view/list', auth(token)); await request('/invoice/tab', auth(token))
  const configs = (await request('/business-title/config/get', auth(token))).body as Json[]
  assert.equal(configs.length, 14); assert.ok(configs.some((item) => item.field === 'name' && item.required === true))
  const businessTitleForm = (await request('/contract/business-title/module/form', auth(token))).body as Json
  assert.ok(Array.isArray(businessTitleForm.fields)); assert.ok(businessTitleForm.fields.some((field: Json) => field.key === 'name' && field.required === true))

  const suffix = Date.now().toString(36)
  const title = (await request('/contract/business-title/add', json(token, titlePayload(`W364 Invoice Title ${suffix}`)), 201)).body as Json
  assert.equal(title.approvalStatus, 'APPROVING')
  const approvedTitle = (await request('/contract/business-title/approval', json(token, { id: title.id, approvalStatus: 'APPROVED' }), 201)).body as Json
  assert.equal(approvedTitle.approvalStatus, 'APPROVED')
  const options = (await request('/contract/business-title/option', auth(token))).body as Json[]
  assert.ok(options.some((item) => item.id === title.id))

  const titleExport = (await request('/contract/business-title/export-all', json(token, {
    current: 1,
    pageSize: 100,
    keyword: title.name,
    fileName: `w364-business-title-${suffix}`,
    headList: ['name', 'type', 'identificationNumber', 'approvalStatus'],
  }), 201)).body as Json
  assert.equal(titleExport.status, 'SUCCESS')
  const titleTemplate = await request('/contract/business-title/template/download?importType=ADD', auth(token))
  assert.match(titleTemplate.response.headers.get('content-type') ?? '', /spreadsheetml/)
  assert.ok((titleTemplate.body as ArrayBuffer).byteLength > 100)

  const importedTitleName = `W364 Invoice Title Imported ${suffix}`
  const importedTitlePayload = titlePayload(importedTitleName)
  const titleXlsx = await workbook(
    ['工商抬头名称', '抬头类型', '纳税人识别号', '开户行', '银行账号', '注册地址', '电话', '注册资本', '企业规模', '注册号', '省份', '城市', '规模', '行业', '备注'],
    [
      importedTitlePayload.name,
      'THIRD_PARTY',
      importedTitlePayload.identificationNumber,
      importedTitlePayload.openingBank,
      importedTitlePayload.bankAccount,
      importedTitlePayload.registrationAddress,
      importedTitlePayload.phoneNumber,
      importedTitlePayload.registeredCapital,
      importedTitlePayload.companySize,
      importedTitlePayload.registrationNumber,
      importedTitlePayload.province,
      importedTitlePayload.city,
      importedTitlePayload.scale,
      importedTitlePayload.industry,
      importedTitlePayload.remark,
    ],
  )
  assert.equal(((await upload(token, '/contract/business-title/import/pre-check', titleXlsx)).body as Json).successCount, 1)
  assert.equal(((await upload(token, '/contract/business-title/import', titleXlsx)).body as Json).successCount, 1)
  const importedTitles = (await request('/contract/business-title/page', json(token, {
    current: 1,
    pageSize: 100,
    keyword: importedTitleName,
  }), 201)).body as Json
  const importedTitle = importedTitles.list.find((item: Json) => item.name === importedTitleName)
  assert.ok(importedTitle); assert.equal(importedTitle.approvalStatus, 'APPROVED')

  const invoice = (await request('/invoice/add', json(token, { name: `W364 Invoice Smoke ${suffix}`, contractId, amount: 12.34, invoiceType: '增值税普通发票', taxRate: 6, businessTitleId: title.id }), 201)).body as Json
  assert.equal(invoice.owner, userId); assert.equal(invoice.approvalStatus, 'NONE'); assert.equal(invoice.businessTitleId, title.id)
  const detail = (await request(`/invoice/get/${invoice.id}`, auth(token))).body as Json
  assert.equal(detail.businessTitleName, title.name)
  const updated = (await request('/invoice/update', json(token, { id: invoice.id, amount: 23.45, taxRate: 13 }), 201)).body as Json
  assert.equal(updated.amount, 23.45); assert.equal(updated.taxRate, 13)

  const invoicePage = (await request('/invoice/page', json(token, { current: 1, pageSize: 100, contractId, keyword: invoice.name }), 201)).body as Json
  assert.ok(invoicePage.list.some((item: Json) => item.id === invoice.id))
  const contractPage = (await request('/contract/invoice/page', json(token, { current: 1, pageSize: 100, contractId }), 201)).body as Json
  assert.ok(contractPage.list.some((item: Json) => item.id === invoice.id))
  const snapshot = (await request(`/invoice/get/snapshot/${invoice.id}`, auth(token))).body as Json
  assert.equal(snapshot.id, invoice.id)
  const snapshotForm = (await request(`/invoice/module/form/snapshot/${invoice.id}`, auth(token))).body as Json
  assert.ok(Array.isArray(snapshotForm.fields))

  const contractStatistic = (await request(`/contract/invoice/statistic/${contractId}`, auth(token))).body as Json
  assert.equal(typeof contractStatistic.contractAmount, 'number')
  const customerPage = (await request('/account/invoice/page', json(token, { accountId: customerId, current: 1, pageSize: 100 }), 201)).body as Json
  const customerInvoice = customerPage.list.find((item: Json) => item.id === invoice.id)
  assert.ok(customerInvoice); assert.equal(customerInvoice.businessTitleName, title.name); assert.equal(customerInvoice.approvalStatus, 'NONE'); assert.equal('status' in customerInvoice, false)
  const customerStatistic = (await request(`/account/invoice/statistic/${customerId}`, auth(token))).body as Json
  assert.equal(typeof customerStatistic.contractAmount, 'number')

  const task = (await request('/invoice/export-all', json(token, { current: 1, pageSize: 100, contractId, fileName: `w364-invoice-${suffix}`, headList: ['name', 'contractName', 'amount', 'invoiceType', 'taxRate', 'businessTitleName', 'approvalStatus'] }), 201)).body as Json
  assert.equal(task.status, 'SUCCESS')
  const template = await request('/invoice/template/download?importType=ADD', auth(token))
  assert.match(template.response.headers.get('content-type') ?? '', /spreadsheetml/); assert.ok((template.body as ArrayBuffer).byteLength > 100)

  const importedName = `W364 Invoice Imported ${suffix}`
  const xlsx = await workbook(['发票名称', '合同', '负责人', '开票金额', '发票类型', '税率', '工商抬头'], [importedName, contractId, userId, 9.87, '增值税普通发票', 6, title.id])
  assert.equal(((await upload(token, '/invoice/import/pre-check', xlsx)).body as Json).successCount, 1)
  assert.equal(((await upload(token, '/invoice/import', xlsx)).body as Json).successCount, 1)
  const importedPage = (await request('/invoice/page', json(token, { current: 1, pageSize: 100, contractId, keyword: importedName }), 201)).body as Json
  const imported = importedPage.list.find((item: Json) => item.name === importedName); assert.ok(imported)

  await request(`/contracts/invoices/${invoice.id}/issue`, json(token, { invoiceNo: 'LEGACY-NO' }), 404)
  assert.equal(asBoolean((await request(`/contract/business-title/invoice/check/${title.id}`, auth(token))).body), true)
  await request('/invoice/batch/delete', json(token, [imported.id]), 201); await request(`/invoice/delete/${invoice.id}`, auth(token))
  assert.equal(asBoolean((await request(`/contract/business-title/invoice/check/${title.id}`, auth(token))).body), false)
  await request(`/contract/business-title/delete/${importedTitle.id}`, auth(token))
  await request(`/contract/business-title/delete/${title.id}`, auth(token))
  console.log('W3.6.4 invoice direct smoke passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
