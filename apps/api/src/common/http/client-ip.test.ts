import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeClientIp, parseTrustProxyHops } from './client-ip'

test('trust proxy 默认关闭并接受受控 hop 数', () => {
  assert.equal(parseTrustProxyHops(undefined), false)
  assert.equal(parseTrustProxyHops(''), false)
  assert.equal(parseTrustProxyHops('0'), false)
  assert.equal(parseTrustProxyHops('1'), 1)
  assert.equal(parseTrustProxyHops(' 2 '), 2)
})

test('trust proxy 拒绝非法或过大的配置', () => {
  for (const value of ['true', '-1', '1.5', '11', 'abc']) {
    assert.throws(() => parseTrustProxyHops(value), /TRUST_PROXY_HOPS/)
  }
})

test('客户端 IP 只规范化 IPv4-mapped IPv6', () => {
  assert.equal(normalizeClientIp('::ffff:192.168.10.8'), '192.168.10.8')
  assert.equal(normalizeClientIp('203.0.113.10'), '203.0.113.10')
  assert.equal(normalizeClientIp('2001:db8::10'), '2001:db8::10')
  assert.equal(normalizeClientIp('::ffff:not-an-ip'), '::ffff:not-an-ip')
  assert.equal(normalizeClientIp(' 127.0.0.1 '), '127.0.0.1')
  assert.equal(normalizeClientIp(undefined), undefined)
})
