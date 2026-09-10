import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import type { EnterpriseIntegration } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { CredentialCipherService } from '../../common/services/credential-cipher.service'
import type { DingTalkClient, DingTalkConnectionResult } from './dingtalk.client'
import { EnterpriseIntegrationsService } from './enterprise-integrations.service'
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
  result: DingTalkConnectionResult = { success: true, message: '钉钉连接成功', providerCode: 0 },
) {
  const rows: EnterpriseIntegration[] = []
  const enterpriseIntegration = {
    findUnique: async ({
      where,
    }: {
      where: { tenantId_provider: { tenantId: string; provider: 'DINGTALK' | 'WECOM' } }
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
      where: { tenantId_provider: { tenantId: string; provider: 'DINGTALK' } }
      update: Record<string, unknown>
      create: Record<string, unknown>
    }) => {
      const existing = rows.find(
        (row) => row.tenantId === where.tenantId_provider.tenantId && row.provider === 'DINGTALK',
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
  const dingTalkClient = { testConnection: async () => result } as unknown as DingTalkClient
  const service = new EnterpriseIntegrationsService(
    prismaRecord as unknown as PrismaService,
    cipher,
    {} as WeComClient,
    dingTalkClient,
  )
  return { service, rows }
}

test('钉钉首次配置必须保存 CorpId/AppKey/AgentId/Secret 且 Secret 加密', async () => {
  const { service, rows } = createService()
  await assert.rejects(
    () =>
      service.saveDingTalk(user, {
        corpId: 'ding-corp',
        clientId: 'app-key',
        agentId: '10001',
      }),
    BadRequestException,
  )
  const value = await service.saveDingTalk(user, {
    corpId: 'ding-corp',
    clientId: 'app-key',
    agentId: '10001',
    appSecret: 'plain-secret',
  })
  assert.equal(value.provider, 'DINGTALK')
  assert.equal(value.clientId, 'app-key')
  assert.equal(value.agentId, '10001')
  assert.equal(value.secretConfigured, true)
  assert.notEqual(rows[0]?.secretCiphertext, 'plain-secret')
  assert.deepEqual(await service.getDingTalkSecret(user.tenantId), { appSecret: 'plain-secret' })
})

test('钉钉凭据变化提升 credentialVersion、关闭同步并使旧预览失效', async () => {
  const { service, rows } = createService()
  await service.testDingTalk(user, {
    corpId: 'ding-corp',
    clientId: 'app-key',
    agentId: '10001',
    appSecret: 'first-secret',
  })
  await service.updateDingTalkSync(user, { enabled: true, defaultRoleId: 'role-a' })
  const beforeVersion = rows[0]!.credentialVersion

  const unchanged = await service.saveDingTalk(user, {
    corpId: 'ding-corp',
    clientId: 'app-key',
    agentId: '10001',
  })
  assert.equal(unchanged.syncEnabled, true)
  assert.equal(unchanged.credentialVersion, beforeVersion)

  const changed = await service.saveDingTalk(user, {
    corpId: 'ding-corp',
    clientId: 'new-app-key',
    agentId: '10001',
    appSecret: 'replacement-secret',
  })
  assert.equal(changed.syncEnabled, false)
  assert.equal(changed.lastTestSucceeded, null)
  assert.equal(changed.credentialVersion, beforeVersion + 1)
})

test('钉钉运行上下文不依赖同步开关，组织同步上下文要求 syncEnabled', async () => {
  const { service } = createService()
  await service.testDingTalk(user, {
    corpId: 'ding-corp',
    clientId: 'app-key',
    agentId: '10001',
    appSecret: 'secret',
  })
  const runtime = await service.getDingTalkRuntimeContext(user.tenantId)
  assert.equal(runtime.credentials.clientId, 'app-key')
  await assert.rejects(() => service.getDingTalkSyncContext(user.tenantId), BadRequestException)
  await service.updateDingTalkSync(user, { enabled: true, defaultRoleId: 'role-a' })
  const sync = await service.getDingTalkSyncContext(user.tenantId)
  assert.equal(sync.integration.syncEnabled, true)
})
