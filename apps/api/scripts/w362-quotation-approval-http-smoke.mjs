import assert from 'node:assert/strict'

const base = process.env.W362_API_BASE ?? 'http://127.0.0.1:3012/api'

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${text}`)
  }
  return data
}

async function main() {
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@demo.com', password: 'admin123' },
  })
  const token = login.accessToken
  const userId = login.user.id
  const prefix = `W362_HTTP_${Date.now()}`

  const flowBody = {
    name: `${prefix}_FLOW`,
    enabled: true,
    createExecute: true,
    updateExecute: true,
    deleteExecute: true,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: false,
    allowAddSign: false,
    duplicateApproverRule: 'FIRST_ONLY',
    requireComment: false,
    condition: null,
    createNodes: [
      {
        name: '管理员审批',
        approverType: 'USER',
        approverIds: [userId],
        ccUserIds: [],
        mode: 'ANY',
        sameSubmitterAction: 'ALLOW',
      },
    ],
  }
  const existingFlows = await request('/approvals/flows?formType=quotation', { token })
  const flow = existingFlows.items.length
    ? await request(`/approvals/flows/${existingFlows.items[0].id}`, {
        method: 'PUT',
        token,
        body: flowBody,
      })
    : await request('/approvals/flows', {
        method: 'POST',
        token,
        body: { formType: 'quotation', ...flowBody },
      })

  const opportunity = await request('/opportunity/add', {
    method: 'POST',
    token,
    body: { name: `${prefix}_OPP`, amount: 100, owner: userId },
  })
  const product = await request('/product/add', {
    method: 'POST',
    token,
    body: { name: `${prefix}_PRODUCT`, price: 100, status: '1' },
  })
  const price = await request('/price/add', {
    method: 'POST',
    token,
    body: {
      name: `${prefix}_PRICE`,
      status: '1',
      products: [{ product: product.id, amount: 100 }],
    },
  })
  const form = await request('/opportunity/quotation/module/form', { token })
  const originalName = `${prefix}_QUOTE`
  const quotation = await request('/opportunity/quotation/add', {
    method: 'POST',
    token,
    body: {
      name: originalName,
      opportunityId: opportunity.id,
      untilTime: Date.now() + 86_400_000,
      amount: 100,
      moduleFields: [],
      moduleFormConfigDTO: form,
      products: [
        {
          product: product.id,
          priceId: price.id,
          productAmount: 100,
          discount: 100,
          tax: 0,
          amount: 100,
        },
      ],
    },
  })

  assert.equal(quotation.approvalStatus, 'APPROVING', 'CREATE 应自动进入审批')
  assert.equal(quotation.approved, false)

  const referencedPriceDelete = await fetch(`${base}/price/delete/${price.id}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(referencedPriceDelete.status, 400, '报价引用价格表后必须禁止删除价格表')
  assert.match(
    await referencedPriceDelete.text(),
    /价格表已被报价单关联，无法删除/,
    '价格表引用保护应返回 Cordys 同义错误',
  )

  await request('/opportunity/quotation/approve', {
    method: 'POST',
    token,
    body: { id: quotation.id, approvalStatus: 'APPROVED' },
  })
  let current = await request(`/opportunity/quotation/get/${quotation.id}`, { token })
  assert.equal(current.approvalStatus, 'APPROVED')
  assert.equal(current.approved, true, '审批通过后 approved 必须永久为 true')

  await request('/opportunity/quotation/update', {
    method: 'POST',
    token,
    body: {
      id: quotation.id,
      name: `${prefix}_EDIT_REJECT`,
      amount: 110,
      moduleFields: [],
      moduleFormConfigDTO: form,
      products: [],
    },
  })
  current = await request(`/opportunity/quotation/get/${quotation.id}`, { token })
  assert.equal(current.name, `${prefix}_EDIT_REJECT`)
  assert.equal(current.approvalStatus, 'APPROVING')

  await request('/opportunity/quotation/approve', {
    method: 'POST',
    token,
    body: { id: quotation.id, approvalStatus: 'UNAPPROVED' },
  })
  current = await request(`/opportunity/quotation/get/${quotation.id}`, { token })
  assert.equal(current.name, originalName, 'UPDATE 驳回应恢复编辑前业务数据')
  assert.equal(current.approvalStatus, 'UNAPPROVED')
  assert.equal(current.approved, true, 'UPDATE 驳回不能清理历史 approved')

  await request('/opportunity/quotation/update', {
    method: 'POST',
    token,
    body: {
      id: quotation.id,
      name: `${prefix}_EDIT_REVOKE`,
      amount: 120,
      moduleFields: [],
      moduleFormConfigDTO: form,
      products: [],
    },
  })
  await request(`/opportunity/quotation/revoke/${quotation.id}`, { token })
  current = await request(`/opportunity/quotation/get/${quotation.id}`, { token })
  assert.equal(current.name, originalName, 'UPDATE 撤回应恢复编辑前业务数据')
  assert.equal(current.approvalStatus, 'REVOKED')
  assert.equal(current.approved, true)

  const tab = await request('/opportunity/quotation/tab', { token })
  await request(`/opportunity/quotation/download/${quotation.id}`, { token })

  const deleteResult = await request(`/opportunity/quotation/delete/${quotation.id}`, { token })
  assert.equal(deleteResult.pendingApproval, true, 'DELETE 命中审批时不能直接删除')
  current = await request(`/opportunity/quotation/get/${quotation.id}`, { token })
  assert.equal(current.approvalStatus, 'APPROVING')

  await request('/opportunity/quotation/approve', {
    method: 'POST',
    token,
    body: { id: quotation.id, approvalStatus: 'APPROVED' },
  })
  const gone = await fetch(`${base}/opportunity/quotation/get/${quotation.id}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(gone.status, 404, 'DELETE 审批通过后必须真正删除报价')
  await request(`/price/delete/${price.id}`, { token })
  await request(`/product/delete/${product.id}`, { token })

  const batchQuotes = []
  for (const suffix of ['BATCH_A', 'BATCH_B']) {
    batchQuotes.push(
      await request('/opportunity/quotation/add', {
        method: 'POST',
        token,
        body: {
          name: `${prefix}_${suffix}`,
          opportunityId: opportunity.id,
          untilTime: Date.now() + 86_400_000,
          amount: 130,
          moduleFields: [],
          moduleFormConfigDTO: form,
          products: [],
        },
      }),
    )
  }
  const batchIds = batchQuotes.map((item) => item.id)
  const batchApprove = await request('/opportunity/quotation/batch/approve', {
    method: 'POST',
    token,
    body: { ids: batchIds, approvalStatus: 'APPROVED' },
  })
  assert.deepEqual(batchApprove, { success: 2, fail: 0, skip: 0 })

  const batchVoid = await request('/opportunity/quotation/batch/voided', {
    method: 'POST',
    token,
    body: { ids: batchIds },
  })
  assert.equal(batchVoid.success, 2)
  assert.equal(batchVoid.fail, 0)

  const userView = await request('/opportunity/quotation/view/add', {
    method: 'POST',
    token,
    body: {
      name: `${prefix}_VOIDED_VIEW`,
      searchMode: 'AND',
      conditions: [{ name: 'invalid', operator: 'eq', value: true, type: 'BOOLEAN' }],
    },
  })
  const viewList = await request('/opportunity/quotation/view/list', { token })
  assert(viewList.some((item) => item.id === userView.id), '报价 User View CRUD 路由必须可用')
  const filteredPage = await request('/opportunity/quotation/page', {
    method: 'POST',
    token,
    body: { current: 1, pageSize: 20, viewId: userView.id },
  })
  assert(batchIds.every((id) => filteredPage.list.some((item) => item.id === id)))

  console.log(
    JSON.stringify(
      {
        flowId: flow.id,
        opportunityId: opportunity.id,
        quotationId: quotation.id,
        createApproval: true,
        updateRejectRollback: true,
        updateRevokeRollback: true,
        deleteDelayedUntilApproval: true,
        referencedPriceDeleteProtected: true,
        tab,
        downloadLog: true,
        batchApprove,
        batchVoid: { success: batchVoid.success, fail: batchVoid.fail, skip: batchVoid.skip },
        userViewFilter: true,
        controllerRoutes: true,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
