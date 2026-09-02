/* eslint-disable @typescript-eslint/no-explicit-any, no-empty */
import assert from 'node:assert/strict'

const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000/api'
type Json = Record<string, any>

async function request(path: string, init: RequestInit = {}, expected = 200) {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: any = text
  try { body = text ? JSON.parse(text) : null } catch {}
  assert.equal(
    response.status,
    expected,
    `${path}: expected ${expected}, got ${response.status}: ${text}`,
  )
  return body
}

function json(token: string, body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

function auth(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } }
}

async function login(email: string, password = 'admin123') {
  return request('/auth/login', json('', { email, password })) as Promise<Json>
}

async function pendingTask(token: string, targetId: string) {
  const page = await request('/approvals/my-pending?page=1&pageSize=100', auth(token)) as Json
  const item = (page.items as Json[]).find(
    (entry) => entry.targetId === targetId && entry.module === 'order',
  )
  assert.ok(item?.myPendingTaskId, `order ${targetId} should have a pending approval task`)
  return item.myPendingTaskId as string
}

async function approve(token: string, targetId: string) {
  await request(`/approvals/tasks/${await pendingTask(token, targetId)}/approve`, json(token, {}), 201)
}

async function reject(token: string, targetId: string, comment = 'W365D reject smoke') {
  await request(
    `/approvals/tasks/${await pendingTask(token, targetId)}/reject`,
    json(token, { comment }),
    201,
  )
}

function flowWrite(detail: Json, enabled = detail.enabled) {
  return {
    name: detail.name,
    description: detail.description,
    enabled,
    createExecute: detail.createExecute,
    updateExecute: detail.updateExecute,
    deleteExecute: detail.deleteExecute,
    submitterCanRevoke: detail.submitterCanRevoke,
    allowBatchProcess: detail.allowBatchProcess,
    allowWithdraw: detail.allowWithdraw,
    allowAddSign: detail.allowAddSign,
    duplicateApproverRule: detail.duplicateApproverRule,
    requireComment: detail.requireComment,
    condition: detail.condition,
    createNodes: (detail.createNodes ?? [])
      .filter((node: Json) => node.nodeType === 'APPROVER' && node.approverType && node.mode)
      .map((node: Json) => ({
        clientId: node.id,
        name: node.name,
        approverType: node.approverType,
        approverIds: [...(node.approverIds ?? [])],
        ccUserIds: [...(node.ccUserIds ?? [])],
        mode: node.mode,
      })),
  }
}

async function cleanupOrders(token: string) {
  const page = await request(
    '/order/page',
    json(token, { current: 1, pageSize: 500, keyword: 'W365D_' }),
    201,
  ) as Json
  for (const order of page.list as Json[]) {
    if (order.approvalStatus === 'APPROVING') {
      try {
        await request(
          '/approval-resource/revoke',
          json(token, { resourceId: order.id, formKey: 'order' }),
          201,
        )
      } catch {}
    }
    try { await request(`/order/delete/${order.id}`, auth(token)) } catch {}
  }
}

function dynamicValue(order: Json, fieldId: string) {
  return (order.moduleFields ?? []).find((item: Json) => item.fieldId === fieldId)?.fieldValue
}

function snapshotField(snapshot: Json, fieldId: string) {
  return (snapshot.moduleFields ?? []).find((item: Json) => item.fieldId === fieldId)?.fieldValue
}

async function main() {
  const [admin, approver] = await Promise.all([
    login('admin@demo.com'),
    login('zhangwei@demo.com'),
  ])
  const token = admin.accessToken as string
  const approverToken = approver.accessToken as string
  const adminId = admin.user.id as string
  const approverId = approver.user.id as string
  assert.ok(token && approverToken && adminId && approverId, '审批 Smoke 登录结果不完整')

  const suffix = Date.now().toString(36)
  const flows = await request('/approvals/flows?formType=order&page=1&pageSize=100', auth(token)) as Json
  const originals: Array<{ id: string; body: Json }> = []
  for (const item of flows.items as Json[]) {
    const detail = await request(`/approvals/flows/${item.id}`, auth(token)) as Json
    originals.push({ id: item.id, body: flowWrite(detail) })
    await request(
      `/approvals/flows/${item.id}`,
      { ...json(token, flowWrite(detail, false)), method: 'PUT' },
    )
  }

  let flowId = originals[0]?.id
  let createdFlow = false
  const testFlowBody = {
    name: `W365D_ORDER_FLOW_${suffix}`,
    description: 'W3.6.5 order approval smoke',
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
        name: '订单审批',
        approverType: 'USER',
        approverIds: [adminId, approverId],
        ccUserIds: [],
        mode: 'ANY',
        sameSubmitterAction: 'ALLOW',
      },
    ],
  }

  if (flowId) {
    await request(`/approvals/flows/${flowId}`, {
      ...json(token, testFlowBody),
      method: 'PUT',
    })
  } else {
    const created = await request(
      '/approvals/flows',
      json(token, { formType: 'order', ...testFlowBody }),
      201,
    ) as Json
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
    await request(`/approvals/flows/${flowId}`, {
      ...json(token, { ...testFlowBody, enabled: false }),
      method: 'PUT',
    })
    await cleanupOrders(token)
    await request(`/approvals/flows/${flowId}`, {
      ...json(token, testFlowBody),
      method: 'PUT',
    })

    const form = await request('/order/module/form', auth(token)) as Json
    const consigneeField = (form.fields as Json[]).find((field) => field.key === 'orderConsignee')
    assert.ok(consigneeField?.id, '订单表单缺少 orderConsignee 字段')

    const contracts = await request(
      '/contract/page',
      json(token, { current: 1, pageSize: 50 }),
      201,
    ) as Json
    const contract = (contracts.list as Json[]).find((item) => item.customerId)
    assert.ok(contract?.id && contract?.customerId, '订单审批 Smoke 缺少可用合同/客户种子')

    const originalName = `W365D_MAIN_${suffix}`
    const originalAmount = 88.5
    const originalConsignee = `W365D_CONSIGNEE_${suffix}`
    const order = await request(
      '/order/add',
      json(token, {
        name: originalName,
        customerId: contract.customerId,
        contractId: contract.id,
        owner: adminId,
        amount: originalAmount,
        moduleFields: [{ fieldId: consigneeField.id, fieldValue: originalConsignee }],
      }),
      201,
    ) as Json
    touched.add(order.id)
    assert.equal(order.approvalStatus, 'APPROVING', 'CREATE 应自动进入审批')
    assert.equal(order.approved, false)

    const simple = await request(`/approval-resource/simple-detail/${order.id}`, auth(token)) as Json
    assert.equal(simple.resourceId, order.id)
    assert.equal(simple.approveStatus, 'APPROVING')
    assert.ok(Array.isArray(simple.approveUserList))
    const detail = await request(`/approval-resource/detail/${order.id}`, auth(token)) as Json
    assert.equal(detail.targetId, order.id)
    assert.equal(detail.module, 'order')

    await reject(approverToken, order.id, 'W365D create reject')
    let current = await request(`/order/get/${order.id}`, auth(token)) as Json
    assert.equal(current.approvalStatus, 'UNAPPROVED')
    assert.equal(current.approved, false)

    await request(
      '/approval-resource/push',
      json(token, { resourceId: order.id, formKey: 'order' }),
      201,
    )
    current = await request(`/order/get/${order.id}`, auth(token)) as Json
    assert.equal(current.approvalStatus, 'APPROVING')

    await approve(approverToken, order.id)
    current = await request(`/order/get/${order.id}`, auth(token)) as Json
    assert.equal(current.approvalStatus, 'APPROVED')
    assert.equal(current.approved, true, '审批通过后 approved 必须永久为 true')
    let snapshot = await request(`/order/get/snapshot/${order.id}`, auth(token)) as Json
    assert.equal(snapshot.approvalStatus, 'APPROVED')
    assert.equal(snapshot.approved, true)

    const notifications = await request('/notifications?page=1&pageSize=100', auth(token)) as Json
    assert.ok(
      (notifications.items as Json[]).some(
        (item) => item.title === '审批已通过' && String(item.content ?? '').includes(originalName),
      ),
      'ORDER_APPROVAL 应向提交人生成审批通过业务消息',
    )

    const rejectedName = `W365D_EDIT_REJECT_${suffix}`
    const rejectedConsignee = `W365D_REJECT_VALUE_${suffix}`
    await request(
      '/order/update',
      json(token, {
        id: order.id,
        name: rejectedName,
        amount: 99.5,
        moduleFields: [{ fieldId: consigneeField.id, fieldValue: rejectedConsignee }],
      }),
      201,
    )
    current = await request(`/order/get/${order.id}`, auth(token)) as Json
    assert.equal(current.name, rejectedName)
    assert.equal(current.amount, 99.5)
    assert.equal(dynamicValue(current, consigneeField.id), rejectedConsignee)
    assert.equal(current.approvalStatus, 'APPROVING')
    await reject(approverToken, order.id, 'W365D update reject')

    current = await request(`/order/get/${order.id}`, auth(token)) as Json
    assert.equal(current.name, originalName, 'UPDATE 驳回应恢复编辑前名称')
    assert.equal(current.amount, originalAmount, 'UPDATE 驳回应恢复编辑前金额')
    assert.equal(dynamicValue(current, consigneeField.id), originalConsignee, 'UPDATE 驳回应恢复动态字段')
    assert.equal(current.approvalStatus, 'UNAPPROVED')
    assert.equal(current.approved, true)
    snapshot = await request(`/order/get/snapshot/${order.id}`, auth(token)) as Json
    assert.equal(snapshot.name, originalName)
    assert.equal(snapshot.amount, originalAmount)
    assert.equal(snapshotField(snapshot, consigneeField.id), originalConsignee)
    assert.equal(snapshot.approvalStatus, 'UNAPPROVED')
    assert.equal(snapshot.approved, true)

    const revokedName = `W365D_EDIT_REVOKE_${suffix}`
    await request(
      '/order/update',
      json(token, {
        id: order.id,
        name: revokedName,
        amount: 111.5,
        moduleFields: [{ fieldId: consigneeField.id, fieldValue: `W365D_REVOKE_${suffix}` }],
      }),
      201,
    )
    await request(
      '/approval-resource/revoke',
      json(token, { resourceId: order.id, formKey: 'order' }),
      201,
    )
    current = await request(`/order/get/${order.id}`, auth(token)) as Json
    assert.equal(current.name, originalName, 'UPDATE 撤回应恢复编辑前名称')
    assert.equal(current.amount, originalAmount)
    assert.equal(dynamicValue(current, consigneeField.id), originalConsignee)
    assert.equal(current.approvalStatus, 'REVOKED')
    assert.equal(current.approved, true)

    const deleteResult = await request(`/order/delete/${order.id}`, auth(token)) as Json
    assert.equal(deleteResult.pendingApproval, true, 'DELETE 命中审批时不能直接删除')
    current = await request(`/order/get/${order.id}`, auth(token)) as Json
    assert.equal(current.approvalStatus, 'APPROVING')
    await approve(approverToken, order.id)
    await request(`/order/get/${order.id}`, auth(token), 404)
    touched.delete(order.id)

    console.log('W3.6.5 order approval smoke passed')
  } finally {
    if (flowId) {
      try {
        await request(`/approvals/flows/${flowId}`, {
          ...json(token, { ...testFlowBody, enabled: false }),
          method: 'PUT',
        })
      } catch {}
    }
    for (const id of touched) {
      try {
        const current = await request(`/order/get/${id}`, auth(token)) as Json
        if (current.approvalStatus === 'APPROVING') {
          try {
            await request(
              '/approval-resource/revoke',
              json(token, { resourceId: id, formKey: 'order' }),
              201,
            )
          } catch {}
        }
        await request(`/order/delete/${id}`, auth(token))
      } catch {}
    }
    if (createdFlow && flowId) {
      try {
        await request(`/approvals/flows/${flowId}`, { ...auth(token), method: 'DELETE' })
      } catch {}
    }
    for (const original of originals) {
      try {
        await request(`/approvals/flows/${original.id}`, {
          ...json(token, original.body),
          method: 'PUT',
        })
      } catch {}
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
