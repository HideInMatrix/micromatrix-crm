import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import type { EnterpriseIntegration } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { CredentialCipherService } from './credential-cipher.service'
import { EnterpriseIntegrationsService } from './enterprise-integrations.service'
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

interface UpsertArgs {
  where: { tenantId_provider: { tenantId: string; provider: 'WECOM' } }
  update: Record<string, unknown>
  create: Record<string, unknown>
}

function createService(
  result: WeComConnectionResult = { success: true, message: '企业微信连接成功', providerCode: 0 },
) {
  const rows: EnterpriseIntegration[] = []
  const enterpriseIntegration = {
    findUnique: async ({ where }: UpsertArgs) =>
      rows.find(
        (row) =>
          row.tenantId === where.tenantId_provider.tenantId &&
          row.provider === where.tenantId_provider.provider,
      ) ?? null,
    upsert: async ({ where, update, create }: UpsertArgs) => {
      const existing = rows.find(
        (row) =>
          row.tenantId === where.tenantId_provider.tenantId &&
          row.provider === where.tenantId_provider.provider,
      )
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() })
        return existing
      }
      const now = new Date()
      const row = {
        lastTestSucceeded: null,
        lastTestMessage: null,
        lastTestedAt: null,
        ...create,
        id: `integration-${rows.length + 1}`,
        createdAt: now,
        updatedAt: now,
      } as EnterpriseIntegration
      rows.push(row)
      return row
    },
  }
  const prisma = { enterpriseIntegration } as unknown as PrismaService
  const cipher = new CredentialCipherService(
    new ConfigService({
      INTEGRATION_CREDENTIALS_KEY: 'test_integration_credentials_key_more_than_32_chars',
      JWT_ACCESS_SECRET: 'unused-test-jwt-secret',
    }),
  )
  const client = { testConnection: async () => result } as unknown as WeComClient
  return {
    service: new EnterpriseIntegrationsService(prisma, cipher, client),
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
    syncEnabled: false,
    lastTestSucceeded: null,
    lastTestMessage: null,
    lastTestedAt: null,
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
  })
  assert.equal(value.secretConfigured, true)
  assert.equal('secretCiphertext' in value, false)
  assert.notEqual(rows[0]?.secretCiphertext, 'plain-secret')
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

  await assert.rejects(
    () => failed.service.testWeCom(user, { corpId: 'ww-b', agentId: '1000001' }),
    BadRequestException,
  )
})
