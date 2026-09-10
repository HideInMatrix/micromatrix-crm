import assert from 'node:assert/strict'
import test from 'node:test'
import { DingTalkClient } from './dingtalk.client'

const credentials = {
  corpId: 'ding-corp',
  clientId: 'ding-app-key',
  agentId: '10001',
  appSecret: 'ding-secret',
}

test('钉钉连接测试通过 AppKey/AppSecret 获取企业 access token', async () => {
  const originalFetch = globalThis.fetch
  try {
    let requestBody: Record<string, unknown> = {}
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ accessToken: 'tenant-token' }), { status: 200 })
    }
    const result = await new DingTalkClient().testConnection(credentials)
    assert.equal(result.success, true)
    assert.equal(requestBody['appKey'], credentials.clientId)
    assert.equal(requestBody['appSecret'], credentials.appSecret)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('钉钉组织快照递归部门、按第一个 dept_id_list 作为主部门并去重成员', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      if (url.includes('/v1.0/oauth2/accessToken')) {
        return new Response(JSON.stringify({ accessToken: 'tenant-token' }))
      }
      if (url.includes('/department/listsubid')) {
        const deptId = Number(body['dept_id'])
        return new Response(
          JSON.stringify({
            errcode: 0,
            result: { dept_id_list: deptId === 1 ? [2] : [] },
          }),
        )
      }
      if (url.includes('/department/get')) {
        const deptId = Number(body['dept_id'])
        return new Response(
          JSON.stringify({
            errcode: 0,
            result:
              deptId === 1
                ? { name: '示例企业', parent_id: 0, order: 100 }
                : { name: '销售部', parent_id: 1, order: 80 },
          }),
        )
      }
      if (url.includes('/user/list')) {
        const deptId = Number(body['dept_id'])
        return new Response(
          JSON.stringify({
            errcode: 0,
            result: {
              has_more: false,
              list: [
                {
                  userid: 'zhangsan',
                  unionid: 'union-zhangsan',
                  name: '张三',
                  email: deptId === 2 ? 'zhangsan@example.com' : '',
                  mobile: '13800000000',
                  title: '销售主管',
                  dept_id_list: [2, 1],
                  leader: deptId === 2,
                },
              ],
            },
          }),
        )
      }
      throw new Error(`unexpected DingTalk URL: ${url}`)
    }

    const snapshot = await new DingTalkClient().getOrganizationSnapshot(credentials)
    assert.equal(snapshot.departments.length, 2)
    assert.equal(snapshot.departments.find((item) => item.id === '1')?.isRoot, true)
    assert.equal(snapshot.departments.find((item) => item.id === '2')?.parentExternalKey, '1')
    assert.equal(snapshot.users.length, 1)
    assert.equal(snapshot.users[0]?.externalKey, 'zhangsan')
    assert.equal(snapshot.users[0]?.unionId, 'union-zhangsan')
    assert.equal(snapshot.users[0]?.mainDepartmentExternalKey, '2')
    assert.equal(snapshot.users[0]?.isLeader, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('钉钉 OAuth 由 code 换 user token，再以 unionId 解析企业 userid', async () => {
  const originalFetch = globalThis.fetch
  try {
    const calls: string[] = []
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/oauth2/userAccessToken')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        assert.equal(body['code'], 'oauth-code')
        return new Response(JSON.stringify({ accessToken: 'user-token' }))
      }
      if (url.includes('/contact/users/me')) {
        assert.equal(
          (init?.headers as Record<string, string>)['Authorization'],
          'Bearer user-token',
        )
        return new Response(
          JSON.stringify({
            unionId: 'union-1',
            mobile: '13800000000',
            avatarUrl: 'https://a.test/a',
          }),
        )
      }
      if (url.includes('/oauth2/accessToken')) {
        return new Response(JSON.stringify({ accessToken: 'tenant-token' }))
      }
      if (url.includes('/user/getbyunionid')) {
        return new Response(JSON.stringify({ errcode: 0, result: { userid: 'User-001' } }))
      }
      throw new Error(`unexpected DingTalk URL: ${url}`)
    }

    const identity = await new DingTalkClient().exchangeOAuthLoginCode(credentials, 'oauth-code')
    assert.equal(identity.userId, 'User-001')
    assert.equal(identity.externalKey, 'user-001')
    assert.equal(identity.unionId, 'union-1')
    assert.equal(identity.phone, '13800000000')
    assert.equal(calls.length, 4)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('钉钉工作通知使用内部应用 AgentId 和 userid_list', async () => {
  const originalFetch = globalThis.fetch
  try {
    let noticeBody: Record<string, unknown> = {}
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('/v1.0/oauth2/accessToken')) {
        return new Response(JSON.stringify({ accessToken: 'tenant-token' }))
      }
      noticeBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok', task_id: 9988 }))
    }
    const result = await new DingTalkClient().sendTextMessage({
      ...credentials,
      toUser: 'zhangsan',
      content: '测试通知',
    })
    assert.equal(result.success, true)
    assert.equal(result.providerMessageId, '9988')
    assert.equal(noticeBody['agent_id'], credentials.agentId)
    assert.equal(noticeBody['userid_list'], 'zhangsan')
    assert.deepEqual(noticeBody['msg'], {
      msgtype: 'text',
      text: { content: '测试通知' },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
