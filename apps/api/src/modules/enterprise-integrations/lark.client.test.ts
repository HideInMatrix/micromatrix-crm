import assert from 'node:assert/strict'
import test from 'node:test'
import { LarkClient } from './lark.client'

const credentials = {
  corpId: 'lark-tenant',
  agentId: 'cli_aabbcc',
  appSecret: 'lark-secret',
  redirectUrl: 'https://crm.example.com/login/lark/callback',
}

test('飞书连接测试通过 App ID/App Secret 获取 tenant access token', async () => {
  const originalFetch = globalThis.fetch
  try {
    let requestBody: Record<string, unknown> = {}
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }), {
        status: 200,
      })
    }
    const result = await new LarkClient().testConnection(credentials)
    assert.equal(result.success, true)
    assert.equal(requestBody['app_id'], credentials.agentId)
    assert.equal(requestBody['app_secret'], credentials.appSecret)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('飞书组织快照使用 open_department_id/open_id，并以 is_primary_dept 过滤主部门', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.includes('/tenant_access_token/internal')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }))
      }
      if (url.includes('/tenant/v2/tenant/query')) {
        return new Response(JSON.stringify({ code: 0, data: { tenant: { name: '飞书示例企业' } } }))
      }
      if (url.includes('/contact/v3/departments/0/children')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              has_more: false,
              items: [
                {
                  open_department_id: 'od-sales',
                  parent_department_id: '0',
                  name: '销售部',
                  order: 80,
                },
              ],
            },
          }),
        )
      }
      if (url.includes('/contact/v3/users/find_by_department')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              has_more: false,
              items: [
                {
                  open_id: 'ou_zhangsan',
                  union_id: 'on_zhangsan',
                  user_id: 'local-lark-id',
                  name: '张三',
                  email: 'zhangsan@example.com',
                  mobile: '+8613800000000',
                  work_station: '销售主管',
                  leader_user_id: 'local-lark-id',
                  status: { is_activated: true, is_resigned: false },
                  orders: [
                    {
                      department_id: 'od-sales',
                      is_primary_dept: true,
                    },
                  ],
                },
              ],
            },
          }),
        )
      }
      throw new Error(`unexpected Lark URL: ${url}`)
    }

    const snapshot = await new LarkClient().getOrganizationSnapshot(credentials)
    assert.equal(snapshot.departments.length, 2)
    assert.equal(snapshot.departments.find((item) => item.id === '0')?.name, '飞书示例企业')
    assert.equal(
      snapshot.departments.find((item) => item.id === 'od-sales')?.parentExternalKey,
      '0',
    )
    assert.equal(snapshot.users.length, 1)
    assert.equal(snapshot.users[0]?.externalKey, 'ou_zhangsan')
    assert.equal(snapshot.users[0]?.unionId, 'on_zhangsan')
    assert.equal(snapshot.users[0]?.mainDepartmentExternalKey, 'od-sales')
    assert.equal(snapshot.users[0]?.mobile, '13800000000')
    assert.equal(snapshot.users[0]?.isLeader, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('飞书 OAuth 由 code 直接解析 open_id 身份', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('/authen/v2/oauth/token')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        assert.equal(body['code'], 'oauth-code')
        assert.equal(body['client_id'], credentials.agentId)
        assert.equal(body['redirect_uri'], credentials.redirectUrl)
        return new Response(
          JSON.stringify({ code: 0, data: { access_token: 'user-access-token' } }),
        )
      }
      if (url.includes('/authen/v1/user_info')) {
        assert.equal(
          (init?.headers as Record<string, string>)['Authorization'],
          'Bearer user-access-token',
        )
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              open_id: 'ou_oauth_user',
              union_id: 'on_oauth_user',
              email: 'oauth@example.com',
              mobile: '+8613900000000',
              avatar_url: 'https://example.com/avatar.png',
              gender: 1,
            },
          }),
        )
      }
      throw new Error(`unexpected Lark URL: ${url}`)
    }

    const identity = await new LarkClient().exchangeOAuthLoginCode(credentials, 'oauth-code')
    assert.equal(identity.userId, 'ou_oauth_user')
    assert.equal(identity.externalKey, 'ou_oauth_user')
    assert.equal(identity.unionId, 'on_oauth_user')
    assert.equal(identity.phone, '13900000000')
    assert.equal(identity.gender, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('飞书文本消息按 open_id 投递并回写 message_id', async () => {
  const originalFetch = globalThis.fetch
  try {
    let messageBody: Record<string, unknown> = {}
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('/tenant_access_token/internal')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }))
      }
      if (url.includes('/im/v1/messages')) {
        assert.equal(new URL(url).searchParams.get('receive_id_type'), 'open_id')
        messageBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({ code: 0, data: { message_id: 'om_message_1' } }))
      }
      throw new Error(`unexpected Lark URL: ${url}`)
    }

    const result = await new LarkClient().sendTextMessage({
      ...credentials,
      toUser: 'ou_zhangsan',
      content: '测试通知',
    })
    assert.equal(result.success, true)
    assert.equal(result.providerMessageId, 'om_message_1')
    assert.equal(messageBody['receive_id'], 'ou_zhangsan')
    assert.equal(messageBody['msg_type'], 'text')
    assert.equal(messageBody['content'], JSON.stringify({ text: '测试通知' }))
  } finally {
    globalThis.fetch = originalFetch
  }
})
