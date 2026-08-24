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
