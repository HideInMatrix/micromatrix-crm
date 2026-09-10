import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldAttemptAuthRefresh } from '../src/http'

test('普通业务接口 401 允许进入 refresh-token 自愈', () => {
  assert.equal(shouldAttemptAuthRefresh({ status: 401, url: '/customers', retried: false }), true)
})

test('/auth/me 401 允许恢复页面会话', () => {
  assert.equal(shouldAttemptAuthRefresh({ status: 401, url: '/auth/me', retried: false }), true)
})

test('登录与 refresh 等认证接口 401 不递归刷新', () => {
  assert.equal(shouldAttemptAuthRefresh({ status: 401, url: '/auth/login', retried: false }), false)
  assert.equal(
    shouldAttemptAuthRefresh({ status: 401, url: '/auth/refresh', retried: false }),
    false,
  )
})

test('非 401 或已经重试过的请求不再 refresh', () => {
  assert.equal(shouldAttemptAuthRefresh({ status: 500, url: '/customers' }), false)
  assert.equal(shouldAttemptAuthRefresh({ status: 401, url: '/auth/me', retried: true }), false)
})
