import assert from 'node:assert/strict'
import test from 'node:test'
import { auditExternalEventRequest } from './external-event-audit-payload'

test('外部事件审计保留普通请求参数但递归屏蔽密钥及凭证', () => {
  const request = {
    source: 'reception',
    eventType: 'DONE',
    externalEventId: 'evt-1',
    data: {
      phone: '13800000000',
      studentName: '张三',
      custom: [{ amount: 1200, secret: 'should-not-leak' }],
      token: 'access-token',
      accessKey: 'ak_secret',
      metadata: { password: 'hidden', department: '招生一部' },
    },
  }
  assert.deepEqual(auditExternalEventRequest(request), {
    source: 'reception',
    eventType: 'DONE',
    externalEventId: 'evt-1',
    data: {
      phone: '13800000000',
      studentName: '张三',
      custom: [{ amount: 1200, secret: '[已脱敏]' }],
      token: '[已脱敏]',
      accessKey: '[已脱敏]',
      metadata: { password: '[已脱敏]', department: '招生一部' },
    },
  })
  assert.equal(
    JSON.stringify(auditExternalEventRequest(request)).includes('should-not-leak'),
    false,
  )
})

test('超大请求参数快照有上限并标记截断，不影响业务幂等索引', () => {
  const audit = auditExternalEventRequest({ data: { description: 'X'.repeat(150_000) } })
  const data = audit as { data?: { description?: string } }
  assert.ok(JSON.stringify(audit).length < 130_000)
  assert.match(JSON.stringify(data), /内容已截断/)
})
