import assert from 'node:assert/strict'
import test from 'node:test'
import { ApprovalsService } from './approvals.service'

test('审批结果业务事件按 Cordys 映射 invoice -> INVOICE_APPROVAL', () => {
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const resolve = (service as unknown as {
    approvalResultEvent(module: string): string | undefined
  }).approvalResultEvent.bind(service)

  assert.equal(resolve('quote'), 'BUSINESS_QUOTATION_APPROVAL')
  assert.equal(resolve('contract'), 'CONTRACT_APPROVAL')
  assert.equal(resolve('order'), 'ORDER_APPROVAL')
  assert.equal(resolve('invoice'), 'INVOICE_APPROVAL')
  assert.equal(resolve('unknown'), undefined)
})

test('发票审批结束真实走 INVOICE_APPROVAL 业务消息并通知提交人', async () => {
  const sent: Array<Record<string, unknown>> = []
  const service = Object.create(ApprovalsService.prototype) as ApprovalsService
  const runtime = service as unknown as {
    businessNotifications: { send(input: Record<string, unknown>): Promise<number> }
    notifications: { notify(): Promise<void> }
    sendApprovalResult(
      instance: Record<string, unknown>,
      operatorId: string | undefined,
      message: { title: string; content: string },
    ): Promise<void>
  }
  runtime.businessNotifications = {
    send: async (input) => {
      sent.push(input)
      return 1
    },
  }
  runtime.notifications = {
    notify: async () => {
      throw new Error('invoice approval should not fall back to generic notification')
    },
  }

  await runtime.sendApprovalResult(
    { module: 'invoice', tenantId: 'tenant-a', submitterId: 'submitter-a' },
    'approver-a',
    { title: '审批已通过', content: '发票已审批通过' },
  )

  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.event, 'INVOICE_APPROVAL')
  assert.deepEqual(sent[0]?.recipientIds, ['submitter-a'])
  assert.equal(sent[0]?.operatorId, 'approver-a')
  assert.equal(sent[0]?.excludeSelf, true)
})
