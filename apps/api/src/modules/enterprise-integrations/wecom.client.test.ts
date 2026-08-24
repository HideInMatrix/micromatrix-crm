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
