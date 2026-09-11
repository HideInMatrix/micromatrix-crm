import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import { CredentialCipherService } from '../../common/services/credential-cipher.service'
import type { EnterpriseIntegration } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import type { DingTalkClient } from './dingtalk.client'
import { EnterpriseIntegrationsService } from './enterprise-integrations.service'
import type { LarkClient, LarkConnectionResult } from './lark.client'
import type { WeComClient } from './wecom.client'

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
  result: LarkConnectionResult = { success: true, message: '飞书连接成功', providerCode: 0 },
) {
  const rows: EnterpriseIntegration[] = []
  const enterpriseIntegration = {
    findUnique: async ({
      where,
    }: {
      where: { tenantId_provider: { tenantId: string; provider: 'WECOM' | 'DINGTALK' | 'LARK' } }
    }) =>
      rows.find(
        (row) =>
          row.tenantId === where.tenantId_provider.tenantId &&
          row.provider === where.tenantId_provider.provider,
      ) ?? null,
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { tenantId_provider: { tenantId: string; provider: 'LARK' } }
      update: Record<string, unknown>
      create: Record<string, unknown>
    }) => {
      const existing = rows.find(
        (row) => row.tenantId === where.tenantId_provider.tenantId && row.provider === 'LARK',
      )
      if (existing) {
        for (const [key, value] of Object.entries(update)) {
          if (
            value &&
            typeof value === 'object' &&
            'increment' in value &&
            typeof value.increment === 'number'
          ) {
            const current = existing[key as keyof EnterpriseIntegration]
            Object.assign(existing, {
              [key]: (typeof current === 'number' ? current : 0) + value.increment,
            })
          } else {
            Object.assign(existing, { [key]: value })
          }
        }
        existing.updatedAt = new Date()
        return existing
      }
      const now = new Date()
      const row = {
        lastTestSucceeded: null,
        lastTestMessage: null,
        lastTestedAt: null,
        lastSyncStatus: null,
        lastSyncMessage: null,
        lastSyncedAt: null,
        syncDefaultRoleId: null,
        clientId: null,
        ...create,
        id: `integration-${rows.length + 1}`,
        createdAt: now,
        updatedAt: now,
      } as EnterpriseIntegration
      rows.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find((item) => item.id === where.id)
      assert.ok(row)
      Object.assign(row, data, { updatedAt: new Date() })
      return row
    },
  }
  const prismaRecord: Record<string, unknown> = {
    enterpriseIntegration,
    organizationSyncBatch: { updateMany: async () => ({ count: 0 }) },
    role: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        where.id === 'role-a' && where.tenantId === user.tenantId ? { id: 'role-a' } : null,
    },
  }
  prismaRecord['$transaction'] = async (operation: unknown) => {
    if (Array.isArray(operation)) return Promise.all(operation)
    return (operation as (tx: Record<string, unknown>) => Promise<unknown>)(prismaRecord)
  }
  const cipher = new CredentialCipherService(
    new ConfigService({
      INTEGRATION_CREDENTIALS_KEY: 'test_integration_credentials_key_more_than_32_chars',
      JWT_ACCESS_SECRET: 'unused-test-jwt-secret',
    }),
  )
  const larkClient = { testConnection: async () => result } as unknown as LarkClient
  const service = new EnterpriseIntegrationsService(
    prismaRecord as unknown as PrismaService,
    cipher,
    {} as WeComClient,
    {} as DingTalkClient,
    larkClient,
  )
  return { service, rows }
}

test('飞书首次配置必须保存企业 ID/App ID/redirectUrl/Secret 且 Secret 加密', async () => {
  const { service, rows } = createService()
  await assert.rejects(
    () =>
      service.saveLark(user, {
        corpId: 'tenant-key',
        agentId: 'cli_aabbcc',
        redirectUrl: 'https://crm.example.com/login/lark/callback',
      }),
    BadRequestException,
  )
  const value = await service.saveLark(user, {
    corpId: 'tenant-key',
    agentId: 'cli_aabbcc',
    redirectUrl: 'https://crm.example.com/login/lark/callback',
    appSecret: 'plain-secret',
  })
  assert.equal(value.provider, 'LARK')
  assert.equal(value.agentId, 'cli_aabbcc')
  assert.equal(value.redirectUrl, 'https://crm.example.com/login/lark/callback')
  assert.equal(value.secretConfigured, true)
  assert.notEqual(rows[0]?.secretCiphertext, 'plain-secret')
  assert.deepEqual(await service.getLarkSecret(user.tenantId), { appSecret: 'plain-secret' })
})

test('飞书凭据或回调地址变化提升 credentialVersion、关闭同步并使旧预览失效', async () => {
  const { service, rows } = createService()
  await service.testLark(user, {
    corpId: 'tenant-key',
    agentId: 'cli_aabbcc',
    redirectUrl: 'https://crm.example.com/login/lark/callback',
    appSecret: 'first-secret',
  })
  await service.updateLarkSync(user, { enabled: true, defaultRoleId: 'role-a' })
  const beforeVersion = rows[0]!.credentialVersion

  const unchanged = await service.saveLark(user, {
    corpId: 'tenant-key',
    agentId: 'cli_aabbcc',
    redirectUrl: 'https://crm.example.com/login/lark/callback',
  })
  assert.equal(unchanged.syncEnabled, true)
  assert.equal(unchanged.credentialVersion, beforeVersion)

  const changed = await service.saveLark(user, {
    corpId: 'tenant-key',
    agentId: 'cli_aabbcc',
    redirectUrl: 'https://crm.example.com/login/lark/callback-v2',
    appSecret: 'replacement-secret',
  })
  assert.equal(changed.syncEnabled, false)
  assert.equal(changed.lastTestSucceeded, null)
  assert.equal(changed.credentialVersion, beforeVersion + 1)
})

test('飞书运行上下文不依赖同步开关，组织同步上下文要求 syncEnabled', async () => {
  const { service } = createService()
  await service.testLark(user, {
    corpId: 'tenant-key',
    agentId: 'cli_aabbcc',
    redirectUrl: 'https://crm.example.com/login/lark/callback',
    appSecret: 'secret',
  })
  const runtime = await service.getLarkRuntimeContext(user.tenantId)
  assert.equal(runtime.credentials.agentId, 'cli_aabbcc')
  assert.equal(runtime.credentials.redirectUrl, 'https://crm.example.com/login/lark/callback')
  await assert.rejects(() => service.getLarkSyncContext(user.tenantId), BadRequestException)
  await service.updateLarkSync(user, { enabled: true, defaultRoleId: 'role-a' })
  const sync = await service.getLarkSyncContext(user.tenantId)
  assert.equal(sync.integration.syncEnabled, true)
})
