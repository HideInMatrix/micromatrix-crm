import assert from 'node:assert/strict'
import test from 'node:test'
import { UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { AuthService } from '../../auth/auth.service'
import type { ExternalIdentity, ExternalOAuthState } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { WeComClient } from '../enterprise-integrations/wecom.client'
import { WeComSsoService } from './wecom-sso.service'

test('企微 OAuth state 绑定浏览器、只消费一次并复用本地账号', async () => {
  let oauthState: ExternalOAuthState | null = null
  let identity: ExternalIdentity | null = null
  let loginCalls = 0
  let failedAudits = 0
  let updatedProfile: Record<string, unknown> | null = null
  let updatedAvatar: string | null = null
  const tenant = { id: 'tenant-a', slug: 'acme', name: '示例企业', status: 'ACTIVE' }
  const integration = {
    id: 'integration-a',
    tenantId: tenant.id,
    corpId: 'ww-a',
    agentId: '1000001',
    lastTestSucceeded: true,
    syncEnabled: true,
  }
  const mapping = {
    id: 'mapping-a',
    tenantId: tenant.id,
    provider: 'WECOM',
    externalId: 'ZhangSan',
    externalKey: 'zhangsan',
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
          provider: 'WECOM',
          externalSubject: 'ZhangSan',
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

  const config = {
    get: (key: string) =>
      key === 'WEB_PUBLIC_URL' ? 'http://localhost:5173' : key === 'NODE_ENV' ? 'test' : undefined,
  } as unknown as ConfigService
  const integrations = {
    getWeComRuntimeContext: async () => ({
      integration,
      credentials: { corpId: 'ww-a', agentId: '1000001', appSecret: 'secret' },
    }),
  } as unknown as EnterpriseIntegrationsService
  const client = {
    exchangeLoginCode: async () => ({ userId: 'ZhangSan', externalKey: 'zhangsan' }),
    exchangeOAuthLoginCode: async () => ({
      userId: 'ZhangSan',
      externalKey: 'zhangsan',
      email: 'zhangsan@work.example.com',
      phone: '13800000001',
      avatarUrl: 'https://example.com/avatar.png',
      gender: true,
    }),
  } as unknown as WeComClient
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
  const service = new WeComSsoService(
    prismaRecord as unknown as PrismaService,
    config,
    integrations,
    client,
    auth,
  )

  const started = await service.start({ returnPath: '/customers' })
  assert.equal(started.value.corpId, integration.corpId)
  assert.ok(started.value.state.startsWith('qr-wecom.'))
  const storedState = oauthState as unknown as ExternalOAuthState
  assert.ok(storedState)
  assert.notEqual(storedState.stateHash, started.value.state)

  const result = await service.callback(
    { code: 'single-use-code', state: started.value.state },
    started.browserNonce,
    { ip: '127.0.0.1', userAgent: 'node-test' },
  )
  assert.equal(result.returnPath, '/customers')
  assert.equal(loginCalls, 1)
  assert.equal((identity as unknown as ExternalIdentity).status, 'ACTIVE')

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

  const workbench = await service.startWorkbench({ returnPath: '/home' })
  assert.ok(workbench.value.state.startsWith('wecom.'))
  assert.equal((oauthState as unknown as ExternalOAuthState).flow, 'WECOM')
  const workbenchUrl = new URL(workbench.value.authorizationUrl.replace('#wechat_redirect', ''))
  assert.equal(
    workbenchUrl.origin + workbenchUrl.pathname,
    'https://open.weixin.qq.com/connect/oauth2/authorize',
  )
  assert.equal(workbenchUrl.searchParams.get('scope'), 'snsapi_privateinfo')

  await assert.rejects(
    () =>
      service.callback(
        { code: 'wrong-flow-code', state: workbench.value.state },
        workbench.browserNonce,
        { ip: '127.0.0.1', userAgent: 'node-test' },
      ),
    UnauthorizedException,
  )
  const workbenchResult = await service.callbackWorkbench(
    { code: 'workbench-code', state: workbench.value.state },
    workbench.browserNonce,
    { ip: '127.0.0.1', userAgent: 'wxwork node-test' },
  )
  assert.equal(workbenchResult.returnPath, '/home')
  assert.equal(loginCalls, 2)
  assert.deepEqual(updatedProfile, {
    phone: '13800000001',
    gender: true,
  })
  assert.equal(updatedAvatar, 'https://example.com/avatar.png')
})
