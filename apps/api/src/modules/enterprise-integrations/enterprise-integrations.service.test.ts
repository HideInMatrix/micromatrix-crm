import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import { CredentialCipherService } from '../../common/services/credential-cipher.service'
import { EnterpriseIntegrationsService } from './enterprise-integrations.service'
import { createIntegrationPrisma8Harness } from './enterprise-integrations.prisma8-test-harness'
import type { WeComClient, WeComConnectionResult } from './wecom.client'

const user: AuthUser = {
  id: 'user-a',
  tenantId: 'tenant-a',
  email: 'admin@example.com',
  name: '管理员',
  deptId: null,
  leaderId: null,
  roles: [],
  permissions: ['system:setting', 'system:setting:update'],
}

function createService(
  result: WeComConnectionResult = { success: true, message: '企业微信连接成功', providerCode: 0 },
) {
  const { prisma8, rows } = createIntegrationPrisma8Harness('WECOM')
  const cipher = new CredentialCipherService(
    new ConfigService({
      INTEGRATION_CREDENTIALS_KEY: 'test_integration_credentials_key_more_than_32_chars',
      JWT_ACCESS_SECRET: 'unused-test-jwt-secret',
    }),
  )
  const client = { testConnection: async () => result } as unknown as WeComClient
  return {
    service: new EnterpriseIntegrationsService(prisma8, cipher, client),
    rows,
  }
}

test('未配置时返回稳定空状态且租户隔离', async () => {
  const { service } = createService()
  assert.deepEqual(await service.getWeCom('tenant-a'), {
    id: null,
    provider: 'WECOM',
    configured: false,
    corpId: '',
    agentId: '',
    secretConfigured: false,
    credentialVersion: 0,
    syncEnabled: false,
    syncDefaultRoleId: null,
    lastTestSucceeded: null,
    lastTestMessage: null,
    lastTestedAt: null,
    lastSyncStatus: null,
    lastSyncMessage: null,
    lastSyncedAt: null,
    createdAt: null,
    updatedAt: null,
  })
})

test('首次保存必须提供 Secret，响应不回显秘密材料', async () => {
  const { service, rows } = createService()
  await assert.rejects(
    () => service.saveWeCom(user, { corpId: 'ww-a', agentId: '1000001' }),
    BadRequestException,
  )

  const value = await service.saveWeCom(user, {
    corpId: 'ww-a',
    agentId: '1000001',
    appSecret: 'plain-secret',
    redirectUrl: '/teacher',
  })
  assert.equal(value.secretConfigured, true)
  assert.equal(value.redirectUrl, '/teacher')
  assert.equal('secretCiphertext' in value, false)
  assert.notEqual(rows[0]?.secretCiphertext, 'plain-secret')
  assert.deepEqual(await service.getWeComSecret('tenant-a'), { appSecret: 'plain-secret' })
  assert.equal((await service.getWeCom('tenant-b')).configured, false)
})

test('留空保留旧 Secret，替换凭据清除验证状态', async () => {
  const { service, rows } = createService()
  await service.testWeCom(user, {
    corpId: 'ww-a',
    agentId: '1000001',
    appSecret: 'first-secret',
  })
  const originalCiphertext = rows[0]?.secretCiphertext

  const unchanged = await service.saveWeCom(user, { corpId: 'ww-a', agentId: '1000001' })
  assert.equal(rows[0]?.secretCiphertext, originalCiphertext)
  assert.equal(unchanged.lastTestSucceeded, true)

  const changed = await service.saveWeCom(user, {
    corpId: 'ww-a',
    agentId: '1000001',
    appSecret: 'replacement-secret',
  })
  assert.notEqual(rows[0]?.secretCiphertext, originalCiphertext)
  assert.equal(changed.lastTestSucceeded, null)
  assert.equal(changed.syncEnabled, false)
})

test('连接测试持久化成功或失败状态，企业 ID 变化要求重新填写 Secret', async () => {
  const failed = createService({
    success: false,
    message: '企业微信连接失败（40013）',
    providerCode: 40013,
  })
  const response = await failed.service.testWeCom(user, {
    corpId: 'ww-a',
    agentId: '1000001',
    appSecret: 'first-secret',
  })
  assert.equal(response.success, false)
  assert.equal(response.integration.lastTestSucceeded, false)
  assert.equal(response.integration.lastTestMessage, '企业微信连接失败（40013）')

  const retried = await failed.service.testWeCom(user, {
    corpId: 'ww-a',
    agentId: '1000001',
  })
  assert.equal(retried.success, false)

  await assert.rejects(
    () => failed.service.testWeCom(user, { corpId: 'ww-b', agentId: '1000001' }),
    BadRequestException,
  )
})

test('开启同步后直接测试或提交相同 Secret 不会关闭同步', async () => {
  const { service, rows } = createService()
  await service.testWeCom(user, {
    corpId: 'ww-a',
    agentId: '1000001',
    appSecret: 'same-secret',
  })
  await service.updateWeComSync(user, { enabled: true, defaultRoleId: 'role-a' })
  const version = rows[0]?.credentialVersion

  const returnPageChanged = await service.saveWeCom(user, {
    corpId: 'ww-a',
    agentId: '1000001',
    redirectUrl: '/teacher',
  })
  assert.equal(returnPageChanged.redirectUrl, '/teacher')
  assert.equal(returnPageChanged.syncEnabled, true)
  assert.equal(returnPageChanged.credentialVersion, version)

  const direct = await service.testWeCom(user, { corpId: 'ww-a', agentId: '1000001' })
  assert.equal(direct.integration.syncEnabled, true)
  assert.equal(direct.integration.credentialVersion, version)

  const drawer = await service.testWeCom(user, {
    corpId: 'ww-a',
    agentId: '1000001',
    appSecret: 'same-secret',
  })
  assert.equal(drawer.integration.syncEnabled, true)
  assert.equal(drawer.integration.credentialVersion, version)
})
