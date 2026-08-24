import assert from 'node:assert/strict'
import test from 'node:test'
import { ConfigService } from '@nestjs/config'
import { CredentialCipherService } from './credential-cipher.service'

function createCipher(key = 'test_integration_credentials_key_more_than_32_chars') {
  return new CredentialCipherService(
    new ConfigService({
      INTEGRATION_CREDENTIALS_KEY: key,
      JWT_ACCESS_SECRET: 'unused-test-jwt-secret',
    }),
  )
}

test('AES-256-GCM 加密可往返且同一明文每次产生不同密文', () => {
  const cipher = createCipher()
  const first = cipher.encrypt('wecom-secret')
  const second = cipher.encrypt('wecom-secret')

  assert.equal(cipher.decrypt(first), 'wecom-secret')
  assert.equal(cipher.decrypt(second), 'wecom-secret')
  assert.notEqual(first.ciphertext, second.ciphertext)
  assert.notEqual(first.iv, second.iv)
})

test('密文被篡改或使用不同密钥时拒绝解密', () => {
  const encrypted = createCipher().encrypt('wecom-secret')
  assert.throws(() =>
    createCipher().decrypt({ ...encrypted, authTag: Buffer.alloc(16).toString('base64') }),
  )
  assert.throws(() =>
    createCipher('another_integration_credentials_key_over_32_chars').decrypt(encrypted),
  )
})
