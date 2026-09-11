import assert from 'node:assert/strict'
import test from 'node:test'
import { UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { AuthService } from '../../auth/auth.service'
import type { ExternalIdentity, ExternalOAuthState } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { LarkClient } from '../enterprise-integrations/lark.client'
import { LarkSsoService } from './lark-sso.service'

test('飞书 QR/Web/Mobile OAuth state 绑定浏览器、只消费一次并按 open_id 映射本地账号', async () => {
  let oauthState: ExternalOAuthState | null = null
  let identity: ExternalIdentity | null = null
  let loginCalls = 0
  let failedAudits = 0
  let updatedProfile: Record<string, unknown> | null = null
  let updatedAvatar: string | null = null
  let lastRedirectUri = ''
  const tenant = { id: 'tenant-a', slug: 'acme', name: '示例企业', status: 'ACTIVE' }
  const integration = {
    id: 'integration-a',
    tenantId: tenant.id,
    provider: 'LARK',
    corpId: 'tenant-key',
    agentId: 'cli_aabbcc',
    redirectUrl: 'https://crm.example.com/login/lark/callback',
    lastTestSucceeded: true,
    syncEnabled: true,
  }
  const mapping = {
    id: 'mapping-a',
    tenantId: tenant.id,
    provider: 'LARK',
    externalId: 'ou_user_001',
    externalKey: 'ou_user_001',
    userId: 'user-a',
    active: true,
    user: {
      id: 'user-a',
      tenantId: tenant.id,
      email: 'zhangsan@example.com',
      name: '张三',
      status: 'ACTIVE',
      passwordLoginEnabled: false,
    },
  }

  const prismaRecord: Record<string, unknown> = {
    tenant: {
      findUnique: async () => tenant,
      findUniqueOrThrow: async () => tenant,
      findMany: async () => [tenant],
    },
    enterpriseIntegration: { findUnique: async () => integration },
    externalOAuthState: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({
        data,
      }: {
        data: Omit<ExternalOAuthState, 'id' | 'createdAt' | 'consumedAt'>
      }) => {
        oauthState = {
          ...data,
          id: 'state-a',
          consumedAt: null,
          createdAt: new Date(),
        }
        return oauthState
      },
      findUnique: async () => oauthState,
      updateMany: async () => {
        if (!oauthState || oauthState.consumedAt) return { count: 0 }
        oauthState = { ...oauthState, consumedAt: new Date() }
        return { count: 1 }
      },
    },
    externalUserMapping: { findUnique: async () => mapping },
    user: {
      findFirst: async () => null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updatedProfile = data
        return { ...mapping.user, ...data }
      },
    },
    userExtension: {
      upsert: async ({ create }: { create: { avatar: string } }) => {
        updatedAvatar = create.avatar
        return create
      },
    },
    externalIdentity: {
      findUnique: async () => identity,
      create: async ({ data }: { data: Partial<ExternalIdentity> }) => {
        const now = new Date()
        identity = {
          id: 'identity-a',
          tenantId: tenant.id,
          integrationId: integration.id,
          mappingId: mapping.id,
          provider: 'LARK',
          externalSubject: 'ou_user_001',
          userId: mapping.userId,
          status: 'ACTIVE',
          bindingSource: 'LOGIN',
          boundById: null,
          boundAt: now,
          revokedById: null,
          revokedAt: null,
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        }
        return identity
      },
      update: async ({ data }: { data: Partial<ExternalIdentity> }) => {
        assert.ok(identity)
        identity = { ...identity, ...data, updatedAt: new Date() }
        return identity
      },
    },
  }
  prismaRecord['$transaction'] = async (operation: unknown) => {
    if (Array.isArray(operation)) return Promise.all(operation)
    return (operation as (tx: Record<string, unknown>) => Promise<unknown>)(prismaRecord)
  }

  const config = { get: () => undefined } as unknown as ConfigService
  const integrations = {
    getLarkRuntimeContext: async () => ({
      integration,
      credentials: {
        corpId: integration.corpId,
        agentId: integration.agentId,
        appSecret: 'secret',
        redirectUrl: integration.redirectUrl,
      },
    }),
  } as unknown as EnterpriseIntegrationsService
  const client = {
    exchangeOAuthLoginCode: async (_credentials: unknown, _code: string, redirectUri: string) => {
      lastRedirectUri = redirectUri
      return {
        userId: 'ou_user_001',
        externalKey: 'ou_user_001',
        unionId: 'on_user_001',
        email: 'zhangsan@work.example.com',
        phone: '13800000001',
        avatarUrl: 'https://example.com/avatar.png',
        gender: null,
      }
    },
  } as unknown as LarkClient
  const auth = {
    loginExternal: async () => {
      loginCalls += 1
      return {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: mapping.userId },
      }
    },
    recordExternalLoginFailure: async () => {
      failedAudits += 1
    },
  } as unknown as AuthService
  const service = new LarkSsoService(
    prismaRecord as unknown as PrismaService,
    config,
    integrations,
    client,
    auth,
  )

  const started = await service.start({ returnPath: '/customers' })
  assert.ok(started.value.state.startsWith('qr-lark.'))
  const qrUrl = new URL(started.value.authorizationUrl)
  assert.equal(
    qrUrl.origin + qrUrl.pathname,
    'https://passport.feishu.cn/suite/passport/oauth/authorize',
  )
  assert.equal(qrUrl.searchParams.get('client_id'), integration.agentId)
  assert.equal(started.value.redirectUri, integration.redirectUrl)
  assert.notEqual((oauthState as unknown as ExternalOAuthState).stateHash, started.value.state)

  const result = await service.callback(
    { code: 'single-use-code', state: started.value.state },
    started.browserNonce,
    { ip: '127.0.0.1', userAgent: 'node-test' },
  )
  assert.equal(result.returnPath, '/customers')
  assert.equal(loginCalls, 1)
  assert.equal(lastRedirectUri, integration.redirectUrl)
  assert.equal((identity as unknown as ExternalIdentity).status, 'ACTIVE')
  assert.deepEqual(updatedProfile, { phone: '13800000001' })
  assert.equal(updatedAvatar, 'https://example.com/avatar.png')

  await assert.rejects(
    () =>
      service.callback(
        { code: 'replayed-code', state: started.value.state },
        started.browserNonce,
        { ip: '127.0.0.1', userAgent: 'node-test' },
      ),
    UnauthorizedException,
  )
  assert.equal(loginCalls, 1)
  assert.equal(failedAudits, 1)

  const oauth = await service.startOauth({ returnPath: '/dashboard' })
  assert.ok(oauth.value.state.startsWith('lark.'))
  assert.equal((oauthState as unknown as ExternalOAuthState).flow, 'LARK')
  const oauthUrl = new URL(oauth.value.authorizationUrl)
  assert.equal(oauthUrl.searchParams.get('app_id'), integration.agentId)
  const oauthResult = await service.callbackOauth(
    { code: 'oauth-code', state: oauth.value.state },
    oauth.browserNonce,
    { ip: '127.0.0.1', userAgent: 'Feishu node-test' },
  )
  assert.equal(oauthResult.returnPath, '/dashboard')
  assert.equal(loginCalls, 2)

  const mobile = await service.startMobile({ returnPath: '/mobile/home' })
  assert.ok(mobile.value.state.startsWith('lark-mobile.'))
  assert.equal((oauthState as unknown as ExternalOAuthState).flow, 'LARK_MOBILE')
  assert.equal(mobile.value.redirectUri, 'https://crm.example.com/mobile/lark/callback')
  const mobileResult = await service.callbackMobile(
    { code: 'mobile-code', state: mobile.value.state },
    mobile.browserNonce,
    { ip: '127.0.0.1', userAgent: 'Feishu Mobile' },
  )
  assert.equal(mobileResult.returnPath, '/mobile/home')
  assert.equal(loginCalls, 3)
  assert.equal(lastRedirectUri, 'https://crm.example.com/mobile/lark/callback')
})
