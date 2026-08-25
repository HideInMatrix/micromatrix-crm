import assert from 'node:assert/strict'
import test from 'node:test'
import { WeComClient } from './wecom.client'

test('企微连接测试依次校验 token 和 agent', async (t) => {
  const originalFetch = globalThis.fetch
  try {
    await t.test('token 和 agent 都成功才返回成功', async () => {
      const urls: string[] = []
      globalThis.fetch = async (input) => {
        const url = String(input)
        urls.push(url)
        return new Response(
          JSON.stringify(
            url.includes('/gettoken')
              ? { errcode: 0, errmsg: 'ok', access_token: 'temporary-token' }
              : { errcode: 0, errmsg: 'ok' },
          ),
          { status: 200 },
        )
      }
      const result = await new WeComClient().testConnection({
        corpId: 'ww-a',
        agentId: '1000001',
        appSecret: 'secret',
      })
      assert.equal(result.success, true)
      assert.equal(urls.length, 2)
      assert.ok(urls[0]?.includes('/gettoken'))
      assert.ok(urls[1]?.includes('/agent/get'))
    })

    await t.test('token 失败时不再请求 agent', async () => {
      let calls = 0
      globalThis.fetch = async () => {
        calls += 1
        return new Response(JSON.stringify({ errcode: 40013, errmsg: 'invalid corpid' }), {
          status: 200,
        })
      }
      const result = await new WeComClient().testConnection({
        corpId: 'ww-bad',
        agentId: '1000001',
        appSecret: 'secret',
      })
      assert.equal(result.success, false)
      assert.equal(result.providerCode, 40013)
      assert.equal(calls, 1)
    })

    await t.test('agent 失败返回第二阶段错误', async () => {
      let calls = 0
      globalThis.fetch = async () => {
        calls += 1
        return new Response(
          JSON.stringify(
            calls === 1
              ? { errcode: 0, errmsg: 'ok', access_token: 'temporary-token' }
              : { errcode: 40014, errmsg: 'invalid agentid' },
          ),
          { status: 200 },
        )
      }
      const result = await new WeComClient().testConnection({
        corpId: 'ww-a',
        agentId: '0',
        appSecret: 'secret',
      })
      assert.equal(result.success, false)
      assert.equal(result.providerCode, 40014)
      assert.equal(calls, 2)
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('企微组织快照按主部门去重并正确解析负责人平行数组', async () => {
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/gettoken')) {
        return new Response(JSON.stringify({ errcode: 0, access_token: 'temporary-token' }))
      }
      if (url.includes('/department/list')) {
        return new Response(
          JSON.stringify({
            errcode: 0,
            department: [
              { id: 1, name: '示例企业', parentid: 0, order: 100 },
              { id: 2, name: '销售部', parentid: 1, order: 80 },
            ],
          }),
        )
      }
      const rootRequest = url.includes('department_id=1')
      return new Response(
        JSON.stringify({
          errcode: 0,
          userlist: rootRequest
            ? [
                {
                  userid: 'zhangsan',
                  name: '张三',
                  department: [1, 2],
                  main_department: 2,
                  is_leader_in_dept: [0, 1],
                },
              ]
            : [
                {
                  userid: 'zhangsan',
                  name: '张三',
                  email: 'zhangsan@example.com',
                  mobile: '13800000000',
                  position: '销售主管',
                  department: [1, 2],
                  main_department: 2,
                  is_leader_in_dept: [0, 1],
                },
              ],
        }),
      )
    }

    const snapshot = await new WeComClient().getOrganizationSnapshot({
      corpId: 'ww-a',
      agentId: '1000001',
      appSecret: 'secret',
    })
    assert.equal(snapshot.departments.length, 2)
    assert.equal(snapshot.users.length, 1)
    assert.equal(snapshot.users[0]?.mainDepartmentId, '2')
    assert.equal(snapshot.users[0]?.isLeader, true)
    assert.equal(snapshot.users[0]?.email, 'zhangsan@example.com')
    assert.equal(urls.filter((url) => url.includes('/user/list')).length, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('企微组织快照把唯一可见子树顶点规范化为同步根部门', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.includes('/gettoken')) {
        return new Response(JSON.stringify({ errcode: 0, access_token: 'temporary-token' }))
      }
      if (url.includes('/department/list')) {
        return new Response(
          JSON.stringify({
            errcode: 0,
            department: [
              { id: 42, name: '技术支持', parentid: 1, order: 100 },
              { id: 43, name: '一线支持', parentid: 42, order: 80 },
            ],
          }),
        )
      }
      return new Response(JSON.stringify({ errcode: 0, userlist: [] }))
    }

    const snapshot = await new WeComClient().getOrganizationSnapshot({
      corpId: 'ww-a',
      agentId: '1000034',
      appSecret: 'secret',
    })
    const visibleRoot = snapshot.departments.find((department) => department.id === '42')
    const child = snapshot.departments.find((department) => department.id === '43')
    assert.equal(visibleRoot?.parentId, '1')
    assert.equal(visibleRoot?.isRoot, true)
    assert.equal(child?.isRoot, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('企微组织快照会重试临时错误并拒绝不完整部门树', async (t) => {
  const originalFetch = globalThis.fetch
  try {
    await t.test('HTTP 429 后重试并返回完整快照', async () => {
      let tokenCalls = 0
      globalThis.fetch = async (input) => {
        const url = String(input)
        if (url.includes('/gettoken')) {
          tokenCalls += 1
          if (tokenCalls === 1) return new Response('{}', { status: 429 })
          return new Response(JSON.stringify({ errcode: 0, access_token: 'temporary-token' }))
        }
        if (url.includes('/department/list')) {
          return new Response(
            JSON.stringify({
              errcode: 0,
              department: [{ id: 1, name: '示例企业', parentid: 0, order: 100 }],
            }),
          )
        }
        return new Response(JSON.stringify({ errcode: 0, userlist: [] }))
      }

      const snapshot = await new WeComClient().getOrganizationSnapshot({
        corpId: 'ww-a',
        agentId: '1000001',
        appSecret: 'secret',
      })
      assert.equal(tokenCalls, 2)
      assert.equal(snapshot.departments.length, 1)
    })

    for (const fixture of [
      { name: '空部门', department: [], code: 'EMPTY_DEPARTMENTS' },
      {
        name: '重复部门 ID',
        department: [
          { id: 1, name: '示例企业', parentid: 0 },
          { id: 1, name: '重复企业', parentid: 0 },
        ],
        code: 'DUPLICATE_DEPARTMENT_ID',
      },
      {
        name: '多个互不相连的可见部门树',
        department: [
          { id: 42, name: '技术支持', parentid: 1 },
          { id: 77, name: '销售部', parentid: 1 },
        ],
        code: 'INVALID_ROOT_DEPARTMENT',
      },
      {
        name: '循环部门树',
        department: [
          { id: 1, name: '示例企业', parentid: 0 },
          { id: 2, name: '循环甲', parentid: 3 },
          { id: 3, name: '循环乙', parentid: 2 },
        ],
        code: 'DEPARTMENT_CYCLE',
      },
    ]) {
      await t.test(`拒绝${fixture.name}`, async () => {
        globalThis.fetch = async (input) =>
          new Response(
            JSON.stringify(
              String(input).includes('/gettoken')
                ? { errcode: 0, access_token: 'temporary-token' }
                : { errcode: 0, department: fixture.department },
            ),
          )
        await assert.rejects(
          () =>
            new WeComClient().getOrganizationSnapshot({
              corpId: 'ww-a',
              agentId: '1000001',
              appSecret: 'secret',
            }),
          (error: unknown) =>
            error instanceof Error && 'code' in error && error.code === fixture.code,
        )
      })
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('企微登录 code 只解析已认证成员 UserId', async (t) => {
  const originalFetch = globalThis.fetch
  try {
    await t.test('返回标准成员身份', async () => {
      globalThis.fetch = async (input) =>
        new Response(
          JSON.stringify(
            String(input).includes('/gettoken')
              ? { errcode: 0, access_token: 'temporary-token' }
              : { errcode: 0, UserId: 'ZhangSan' },
          ),
        )
      const identity = await new WeComClient().exchangeLoginCode(
        { corpId: 'ww-a', agentId: '1000001', appSecret: 'secret' },
        'single-use-code',
      )
      assert.deepEqual(identity, { userId: 'ZhangSan', externalKey: 'zhangsan' })
    })

    await t.test('拒绝访客或缺失 UserId 的响应', async () => {
      globalThis.fetch = async (input) =>
        new Response(
          JSON.stringify(
            String(input).includes('/gettoken')
              ? { errcode: 0, access_token: 'temporary-token' }
              : { errcode: 0, OpenId: 'visitor-open-id' },
          ),
        )
      await assert.rejects(
        () =>
          new WeComClient().exchangeLoginCode(
            { corpId: 'ww-a', agentId: '1000001', appSecret: 'secret' },
            'visitor-code',
          ),
        (error: unknown) =>
          error instanceof Error && 'code' in error && error.code === 'LOGIN_IDENTITY_MISSING',
      )
    })

    await t.test('工作台 OAuth 使用 user_ticket 获取成员授权资料', async () => {
      let detailBody = ''
      globalThis.fetch = async (input, init) => {
        const url = String(input)
        if (url.includes('/gettoken')) {
          return new Response(JSON.stringify({ errcode: 0, access_token: 'temporary-token' }))
        }
        if (url.includes('/auth/getuserinfo')) {
          return new Response(
            JSON.stringify({ errcode: 0, UserId: 'ZhangSan', user_ticket: 'user-ticket' }),
          )
        }
        if (url.includes('/auth/getuserdetail')) {
          detailBody = String(init?.body ?? '')
          return new Response(
            JSON.stringify({
              errcode: 0,
              userid: 'ZhangSan',
              biz_mail: 'zhangsan@example.com',
              mobile: '13800000000',
              avatar: 'https://example.com/avatar.png',
              gender: 1,
            }),
          )
        }
        return new Response(JSON.stringify({ errcode: 404, errmsg: 'not found' }))
      }
      const identity = await new WeComClient().exchangeOAuthLoginCode(
        { corpId: 'ww-a', agentId: '1000001', appSecret: 'secret' },
        'workbench-code',
      )
      assert.deepEqual(identity, {
        userId: 'ZhangSan',
        externalKey: 'zhangsan',
        email: 'zhangsan@example.com',
        phone: '13800000000',
        avatarUrl: 'https://example.com/avatar.png',
        gender: false,
      })
      assert.deepEqual(JSON.parse(detailBody), { user_ticket: 'user-ticket' })
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('企微应用消息区分成功、临时失败和永久失败', async (t) => {
  const originalFetch = globalThis.fetch
  try {
    for (const fixture of [
      {
        name: '成功',
        response: { errcode: 0, errmsg: 'ok', msgid: 'message-1' },
        success: true,
        transient: false,
      },
      {
        name: '频率受限可重试',
        response: { errcode: 45009, errmsg: 'api freq out of limit' },
        success: false,
        transient: true,
      },
      {
        name: '收件人无效不可重试',
        response: { errcode: 81013, errmsg: 'user not in app' },
        success: false,
        transient: false,
      },
    ]) {
      await t.test(fixture.name, async () => {
        let sentBody: Record<string, unknown> | undefined
        globalThis.fetch = async (input, init) => {
          if (String(input).includes('/gettoken')) {
            return new Response(JSON.stringify({ errcode: 0, access_token: 'temporary-token' }))
          }
          sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>
          return new Response(JSON.stringify(fixture.response))
        }
        const result = await new WeComClient().sendTextMessage({
          corpId: 'ww-a',
          agentId: '1000001',
          appSecret: 'secret',
          toUser: 'zhangsan',
          content: '客户已分配',
        })
        assert.equal(result.success, fixture.success)
        assert.equal(result.transient, fixture.transient)
        assert.equal(sentBody?.['touser'], 'zhangsan')
      })
    }

    await t.test('无效凭据为永久失败，不进入通道重试', async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ errcode: 40013, errmsg: 'invalid corpid' }))
      const result = await new WeComClient().sendTextMessage({
        corpId: 'ww-bad',
        agentId: '1000001',
        appSecret: 'bad-secret',
        toUser: 'zhangsan',
        content: '客户已分配',
      })
      assert.equal(result.success, false)
      assert.equal(result.providerCode, 40013)
      assert.equal(result.transient, false)
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
