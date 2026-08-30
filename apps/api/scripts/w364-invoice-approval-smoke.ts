/* eslint-disable @typescript-eslint/no-explicit-any, no-empty */
import assert from 'node:assert/strict'

const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api'
type Json = Record<string, any>

async function request(path: string, init: RequestInit = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: any = text
  try { body = text ? JSON.parse(text) : null } catch {}
  assert.equal(response.status, expected, `${path}: expected ${expected}, got ${response.status}: ${text}`)
  return body
}

function json(token: string, body?: unknown): RequestInit {
  return { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }
}

function auth(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } }
}

async function pendingTask(token: string, targetId: string) {
  const page = await request('/approvals/my-pending?page=1&pageSize=100', auth(token)) as Json
  const item = page.items.find((entry: Json) => entry.targetId === targetId && entry.module === 'invoice')
  assert.ok(item?.myPendingTaskId, `invoice ${targetId} should have a pending approval task`)
  return item.myPendingTaskId as string
}

async function approve(token: string, targetId: string) {
  await request(`/approvals/tasks/${await pendingTask(token, targetId)}/approve`, json(token, {}), 201)
}

async function reject(token: string, targetId: string) {
  await request(`/approvals/tasks/${await pendingTask(token, targetId)}/reject`, json(token, { comment: 'W364D reject smoke' }), 201)
}

function flowWrite(detail: Json, enabled = detail.enabled) {
  return {
    name: detail.name, description: detail.description, enabled,
    createExecute: detail.createExecute, updateExecute: detail.updateExecute, deleteExecute: detail.deleteExecute,
    submitterCanRevoke: detail.submitterCanRevoke, allowBatchProcess: detail.allowBatchProcess,
    allowWithdraw: detail.allowWithdraw, allowAddSign: detail.allowAddSign,
    duplicateApproverRule: detail.duplicateApproverRule, requireComment: detail.requireComment,
    condition: detail.condition,
    createNodes: (detail.createNodes ?? [])
      .filter((node: Json) => node.nodeType === 'APPROVER' && node.approverType && node.mode)
      .map((node: Json) => ({ clientId: node.id, name: node.name, approverType: node.approverType,
        approverIds: [...(node.approverIds ?? [])], ccUserIds: [...(node.ccUserIds ?? [])], mode: node.mode })),
  }
}

async function cleanupInvoices(token: string) {
  const page = await request('/invoice/page', json(token, { current: 1, pageSize: 500, keyword: 'W364D_' }), 201) as Json
  for (const invoice of page.list as Json[]) {
    if (invoice.approvalStatus === 'APPROVING') {
      try { await request('/approval-resource/revoke', json(token, { resourceId: invoice.id, formKey: 'invoice' }), 201) } catch {}
    }
    try { await request(`/invoice/delete/${invoice.id}`, auth(token)) } catch {}
  }
}

async function findContract(token: string) {
  const contracts = await request('/contract/page', json(token, { current: 1, pageSize: 100 }), 201) as Json
  for (const contract of contracts.list as Json[]) {
    const invoices = await request('/invoice/page', json(token, { current: 1, pageSize: 500, contractId: contract.id }), 201) as Json
    const occupied = (invoices.list as Json[]).filter((item) => ['APPROVED', 'APPROVING'].includes(item.approvalStatus)).reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    const available = Number(contract.amount ?? 0) - occupied
    if (available >= 100) return { contract, available }
  }
  throw new Error('没有可用于 W364D 审批 Smoke 的可开票额度 >= 100 的合同')
}

function amountSum(items: Json[], approvedOnly = false) {
  return Math.round(items
    .filter((item) => !approvedOnly || item.approvalStatus === 'APPROVED')
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0) * 100) / 100
}

async function customerInvoices(token: string, accountId: string) {
  const all: Json[] = []
  let current = 1
  while (true) {
    const page = await request('/account/invoice/page', json(token, {
      accountId,
      current,
      pageSize: 100,
    }), 201) as Json
    all.push(...(page.list ?? []))
    if (all.length >= Number(page.total ?? 0) || !(page.list ?? []).length) return all
    current += 1
  }
}

async function main() {
  const login = await request('/auth/login', json('', { email: 'admin@demo.com', password: 'admin123' })) as Json
  const token = login.accessToken as string
  const userId = login.user.id as string
  const suffix = Date.now().toString(36)
  const flows = await request('/approvals/flows?formType=invoice&page=1&pageSize=100', auth(token)) as Json
  const originals: Array<{ id: string; body: Json }> = []
  for (const item of flows.items as Json[]) {
    const detail = await request(`/approvals/flows/${item.id}`, auth(token)) as Json
    originals.push({ id: item.id, body: flowWrite(detail) })
    await request(`/approvals/flows/${item.id}`, { ...json(token, flowWrite(detail, false)), method: 'PUT' })
  }

  let flowId = originals[0]?.id
  let createdFlow = false
  const testFlowBody = {
    name: `W364D_INVOICE_FLOW_${suffix}`, description: 'W3.6.4 invoice approval smoke', enabled: true,
    createExecute: true, updateExecute: true, deleteExecute: true, submitterCanRevoke: true,
    allowBatchProcess: false, allowWithdraw: false, allowAddSign: false,
    duplicateApproverRule: 'FIRST_ONLY', requireComment: false, condition: null,
    createNodes: [{ name: '管理员审批', approverType: 'USER', approverIds: [userId], ccUserIds: [], mode: 'ANY' }],
  }

  if (flowId) {
    await request(`/approvals/flows/${flowId}`, { ...json(token, testFlowBody), method: 'PUT' })
  } else {
    const created = await request('/approvals/flows', json(token, { formType: 'invoice', ...testFlowBody }), 201) as Json
    flowId = created.id
    createdFlow = true
  }

  const flowDetail = await request(`/approvals/flows/${flowId}`, auth(token)) as Json
  assert.equal(flowDetail.runtimeReady, true)
  assert.equal(flowDetail.enabled, true)
  assert.equal(flowDetail.createExecute, true)
  assert.equal(flowDetail.updateExecute, true)
  assert.equal(flowDetail.deleteExecute, true)

  const touched = new Set<string>()
  try {
    await request(`/approvals/flows/${flowId}`, { ...json(token, { ...testFlowBody, enabled: false }), method: 'PUT' })
    await cleanupInvoices(token)
    await request(`/approvals/flows/${flowId}`, { ...json(token, testFlowBody), method: 'PUT' })
    const { contract, available } = await findContract(token)
    const reserveAmount = Math.max(20, Math.floor(available * 0.6 * 100) / 100)
    const reserve = await request('/invoice/add', json(token, {
      name: `W364D_RESERVE_${suffix}`, contractId: contract.id, amount: reserveAmount, invoiceType: '增值税普通发票', taxRate: 1,
    }), 201) as Json
    touched.add(reserve.id)
    assert.equal(reserve.approvalStatus, 'APPROVING', 'CREATE 应自动进入审批')

    const contractInvoices = await request('/invoice/page', json(token, {
      current: 1, pageSize: 500, contractId: contract.id,
    }), 201) as Json
    const enabledContractStatistic = await request(`/contract/invoice/statistic/${contract.id}`, auth(token)) as Json
    assert.equal(enabledContractStatistic.invoicedAmount, amountSum(contractInvoices.list, true), '审批启用时合同统计只计算 APPROVED')

    assert.ok(contract.customerId, '审批 Smoke 合同必须关联客户')
    const customerInvoiceRows = await customerInvoices(token, contract.customerId)
    const enabledCustomerStatistic = await request(`/account/invoice/statistic/${contract.customerId}`, auth(token)) as Json
    assert.equal(enabledCustomerStatistic.invoicedAmount, amountSum(customerInvoiceRows, true), '审批启用时客户统计只计算 APPROVED')

    await request(`/approvals/flows/${flowId}`, {
      ...json(token, { ...testFlowBody, enabled: false }), method: 'PUT',
    })
    const disabledContractStatistic = await request(`/contract/invoice/statistic/${contract.id}`, auth(token)) as Json
    assert.equal(disabledContractStatistic.invoicedAmount, amountSum(contractInvoices.list), '审批关闭时合同统计计算全部发票')
    const disabledCustomerStatistic = await request(`/account/invoice/statistic/${contract.customerId}`, auth(token)) as Json
    assert.equal(disabledCustomerStatistic.invoicedAmount, amountSum(customerInvoiceRows), '审批关闭时客户统计计算全部发票')
    await request(`/approvals/flows/${flowId}`, { ...json(token, testFlowBody), method: 'PUT' })

    const overAmount = Math.max(20, Math.floor(available * 0.5 * 100) / 100)
    await request('/invoice/add', json(token, {
      name: `W364D_OVER_${suffix}`, contractId: contract.id, amount: overAmount, invoiceType: '增值税普通发票', taxRate: 1,
    }), 400)
    await request('/approval-resource/revoke', json(token, { resourceId: reserve.id, formKey: 'invoice' }), 201)
    const reserveCurrent = await request(`/invoice/get/${reserve.id}`, auth(token)) as Json
    assert.equal(reserveCurrent.approvalStatus, 'REVOKED')

    const amount = Math.max(10, Math.floor(available * 0.1 * 100) / 100)
    const originalName = `W364D_MAIN_${suffix}`
    const invoice = await request('/invoice/add', json(token, {
      name: originalName, contractId: contract.id, amount, invoiceType: '增值税普通发票', taxRate: 3,
    }), 201) as Json
    touched.add(invoice.id)
    assert.equal(invoice.approvalStatus, 'APPROVING')
    assert.equal(invoice.approved, false)

    const simple = await request(`/approval-resource/simple-detail/${invoice.id}`, auth(token)) as Json
    assert.equal(simple.resourceId, invoice.id)
    assert.equal(simple.approveStatus, 'APPROVING')
    assert.ok(Array.isArray(simple.approveUserList))
    const detail = await request(`/approval-resource/detail/${invoice.id}`, auth(token)) as Json
    assert.equal(detail.targetId, invoice.id)
    assert.equal(detail.module, 'invoice')

    await reject(token, invoice.id)
    let current = await request(`/invoice/get/${invoice.id}`, auth(token)) as Json
    assert.equal(current.approvalStatus, 'UNAPPROVED')
    assert.equal(current.approved, false)

    await request('/approval-resource/push', json(token, { resourceId: invoice.id, formKey: 'invoice' }), 201)
    current = await request(`/invoice/get/${invoice.id}`, auth(token)) as Json
    assert.equal(current.approvalStatus, 'APPROVING')
    await approve(token, invoice.id)
    current = await request(`/invoice/get/${invoice.id}`, auth(token)) as Json
    assert.equal(current.approvalStatus, 'APPROVED')
    assert.equal(current.approved, true, '审批通过后 approved 必须永久为 true')

    const changedAmount = Math.round(amount * 1.2 * 100) / 100
    await request('/invoice/update', json(token, {
      id: invoice.id, name: `W364D_EDIT_REJECT_${suffix}`, amount: changedAmount, taxRate: 6,
    }), 201)
    current = await request(`/invoice/get/${invoice.id}`, auth(token)) as Json
    assert.equal(current.name, `W364D_EDIT_REJECT_${suffix}`)
    assert.equal(current.approvalStatus, 'APPROVING')
    await reject(token, invoice.id)
    current = await request(`/invoice/get/${invoice.id}`, auth(token)) as Json
    assert.equal(current.name, originalName, 'UPDATE 驳回应恢复编辑前业务数据')
    assert.equal(current.amount, amount, 'UPDATE 驳回应恢复编辑前金额')
    assert.equal(current.taxRate, 3, 'UPDATE 驳回应恢复编辑前税率')
    assert.equal(current.approvalStatus, 'UNAPPROVED')
    assert.equal(current.approved, true)

    await request('/invoice/update', json(token, {
      id: invoice.id, name: `W364D_EDIT_REVOKE_${suffix}`, amount: changedAmount, taxRate: 9,
    }), 201)
    await request('/approval-resource/revoke', json(token, { resourceId: invoice.id, formKey: 'invoice' }), 201)
    current = await request(`/invoice/get/${invoice.id}`, auth(token)) as Json
    assert.equal(current.name, originalName, 'UPDATE 撤回应恢复编辑前业务数据')
    assert.equal(current.amount, amount)
    assert.equal(current.taxRate, 3)
    assert.equal(current.approvalStatus, 'REVOKED')
    assert.equal(current.approved, true)

    const deleteResult = await request(`/invoice/delete/${invoice.id}`, auth(token)) as Json
    assert.equal(deleteResult.pendingApproval, true, 'DELETE 命中审批时不能直接删除')
    current = await request(`/invoice/get/${invoice.id}`, auth(token)) as Json
    assert.equal(current.approvalStatus, 'APPROVING')
    await approve(token, invoice.id)
    await request(`/invoice/get/${invoice.id}`, auth(token), 404)
    touched.delete(invoice.id)

    const batchAmount = Math.max(5, Math.floor(available * 0.05 * 100) / 100)
    const batchIds: string[] = []
    for (const label of ['A', 'B']) {
      const item = await request('/invoice/add', json(token, {
        name: `W364D_BATCH_${label}_${suffix}`, contractId: contract.id, amount: batchAmount,
        invoiceType: '增值税普通发票', taxRate: 1,
      }), 201) as Json
      touched.add(item.id)
      batchIds.push(item.id)
      await approve(token, item.id)
    }
    const batch = await request('/invoice/batch/delete', json(token, batchIds), 201) as Json
    assert.equal(batch.success, 2)
    for (const id of batchIds) {
      const pending = await request(`/invoice/get/${id}`, auth(token)) as Json
      assert.equal(pending.approvalStatus, 'APPROVING', 'batch delete 命中审批时资源必须保留')
      await approve(token, id)
      await request(`/invoice/get/${id}`, auth(token), 404)
      touched.delete(id)
    }

    console.log('W3.6.4 invoice approval smoke passed')
  } finally {
    if (flowId) {
      try { await request(`/approvals/flows/${flowId}`, { ...json(token, { ...testFlowBody, enabled: false }), method: 'PUT' }) } catch {}
    }
    for (const id of touched) {
      try {
        const current = await request(`/invoice/get/${id}`, auth(token)) as Json
        if (current.approvalStatus === 'APPROVING') {
          try { await request('/approval-resource/revoke', json(token, { resourceId: id, formKey: 'invoice' }), 201) } catch {}
        }
        await request(`/invoice/delete/${id}`, auth(token))
      } catch {}
    }
    if (createdFlow && flowId) {
      try { await request(`/approvals/flows/${flowId}`, { ...auth(token), method: 'DELETE' }) } catch {}
    }
    for (const original of originals) {
      try { await request(`/approvals/flows/${original.id}`, { ...json(token, original.body), method: 'PUT' }) } catch {}
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
