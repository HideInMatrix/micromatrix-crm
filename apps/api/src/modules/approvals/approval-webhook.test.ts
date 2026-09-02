import assert from 'node:assert/strict'
import test from 'node:test'
import { flowNodesEqual, normalizeFlowNodes } from './approval-flow-config.utils'
import {
  ApprovalWebhookConfigError,
  isPublicWebhookAddress,
  parseApprovalWebhookHeaders,
  parseApprovalWebhookUrl,
  validateApprovalWebhookConfig,
} from './approval-webhook.utils'

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    webHookEnable: true,
    webHookUrl: 'https://hooks.example.com/approval',
    webHookMethod: 'POST' as const,
    webHookHeader: '{"Content-Type":"application/json","Authorization":"Bearer secret"}',
    webHookBody: '{"id":"${order.id}"}',
    webHookDescribe: '推送审批结果',
    ...overrides,
  }
}

test('Webhook 配置进入 ApprovalPostConfig 版本比较且支持 webhook-only post config', () => {
  const [node] = normalizeFlowNodes([{
    name: 'Webhook 审批',
    approverType: 'USER',
    approverIds: ['u1'],
    ccUserIds: [],
    mode: 'ANY',
    passPostConfig: {
      fieldUpdateConfigs: [],
      webHookConfig: webhook(),
    },
  }])
  assert.equal(node.passPostConfig?.fieldUpdateConfigs.length, 0)
  assert.equal(node.passPostConfig?.webHookConfig?.webHookDescribe, '推送审批结果')
  assert.equal(flowNodesEqual([node], [node]), true)
  assert.equal(
    flowNodesEqual([node], [{
      ...node,
      passPostConfig: {
        fieldUpdateConfigs: [],
        webHookConfig: webhook({ webHookUrl: 'https://hooks.example.com/v2' }),
      },
    }]),
    false,
  )
})

test('Webhook enabled 配置校验 GET/POST、URL、header 与 JSON body', () => {
  assert.doesNotThrow(() => validateApprovalWebhookConfig(webhook()))
  assert.throws(
    () => validateApprovalWebhookConfig(webhook({ webHookUrl: 'file:///tmp/hook' })),
    ApprovalWebhookConfigError,
  )
  assert.throws(
    () => validateApprovalWebhookConfig(webhook({ webHookBody: '{bad json' })),
    ApprovalWebhookConfigError,
  )
  assert.throws(
    () => validateApprovalWebhookConfig(webhook({ webHookBody: '' })),
    ApprovalWebhookConfigError,
  )
})

test('Webhook header 拒绝 framing/hop-by-hop 头但允许敏感业务头进入请求边界', () => {
  assert.deepEqual(parseApprovalWebhookHeaders('{"Authorization":"Bearer x","X-Sign":"abc"}'), {
    authorization: 'Bearer x',
    'x-sign': 'abc',
  })
  assert.throws(() => parseApprovalWebhookHeaders('{"Host":"evil.example"}'), ApprovalWebhookConfigError)
  assert.throws(
    () => parseApprovalWebhookHeaders('{"Transfer-Encoding":"chunked"}'),
    ApprovalWebhookConfigError,
  )
})

test('Webhook SSRF 地址分类拒绝本机、私网、保留地址并允许公网地址', () => {
  assert.equal(isPublicWebhookAddress('127.0.0.1'), false)
  assert.equal(isPublicWebhookAddress('10.0.0.1'), false)
  assert.equal(isPublicWebhookAddress('192.168.1.2'), false)
  assert.equal(isPublicWebhookAddress('169.254.169.254'), false)
  assert.equal(isPublicWebhookAddress('203.0.113.10'), false)
  assert.equal(isPublicWebhookAddress('::1'), false)
  assert.equal(isPublicWebhookAddress('::ffff:127.0.0.1'), false)
  assert.equal(isPublicWebhookAddress('64:ff9b::a00:1'), false)
  assert.equal(isPublicWebhookAddress('fc00::1'), false)
  assert.equal(isPublicWebhookAddress('8.8.8.8'), true)
  assert.throws(
    () => parseApprovalWebhookUrl('https://user:pass@example.com/hook'),
    ApprovalWebhookConfigError,
  )
})
