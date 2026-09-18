import assert from 'node:assert/strict'
import test from 'node:test'
import { UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { AuthService } from '../../auth/auth.service'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8TimestampFromDate } from '../../prisma/prisma8-temporal'
import type { DingTalkClient } from '../enterprise-integrations/dingtalk.client'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import { DingTalkSsoService } from './dingtalk-sso.service'

test('钉钉 OAuth state 绑定浏览器、只消费一次并按 userid 映射本地账号', async () => {
  let oauthState: any = null
  let identity: any = null
  let extension: any = null
  let loginCalls = 0
  let failedAudits = 0
  let updatedProfile: Record<string, unknown> | null = null
  let updatedAvatar: string | null = null
  const tenant = { id: 'tenant-a', slug: 'acme', name: '示例企业', status: 'ACTIVE' }
  const integration = {
    id: 'integration-a', tenantId: tenant.id, provider: 'DINGTALK', corpId: 'ding-corp',
    clientId: 'ding-app-key', agentId: '10001', lastTestSucceeded: true, syncEnabled: true,
  }
  const mappedUser: any = {
    id: 'user-a', tenantId: tenant.id, email: 'zhangsan@example.com', passwordHash: 'test',
    name: '张三', status: 'ACTIVE', deptId: null, leaderId: null, position: null, phone: null,
    gender: false, passwordLoginEnabled: false, defaultPwd: false, authVersion: 0, language: 'zh-CN',
    createdAt: prisma8TimestampFromDate(new Date()), updatedAt: prisma8TimestampFromDate(new Date()),
  }
  const mapping: any = {
    id: 'mapping-a', tenantId: tenant.id, provider: 'DINGTALK', externalId: 'User-001',
    externalKey: 'user-001', userId: mappedUser.id, active: true, lastSeenBatchId: null,
    createdAt: prisma8TimestampFromDate(new Date()), updatedAt: prisma8TimestampFromDate(new Date()),
  }
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value)
  const project = (row: Record<string, unknown>, fields: string[]) =>
    fields.length ? Object.fromEntries(fields.map((field) => [field, row[field]])) : row

  const tenants = (where: Record<string, unknown> = {}, fields: string[] = []): any => ({
    where: (next: any) => typeof next === 'function' ? tenants(where, fields) : tenants({ ...where, ...next }, fields),
    select: (...next: string[]) => tenants(where, next), orderBy: () => tenants(where, fields), limit: () => tenants(where, fields),
    first: async () => matches(tenant, where) ? project(tenant, fields) : null,
    all: async () => matches(tenant, where) ? [project(tenant, fields)] : [],
  })
  const integrationsCollection = (where: Record<string, unknown> = {}, fields: string[] = []): any => ({
    where: (next: Record<string, unknown>) => integrationsCollection({ ...where, ...next }, fields),
    select: (...next: string[]) => integrationsCollection(where, next),
    first: async () => matches(integration, where) ? project(integration, fields) : null,
    all: async () => matches(integration, where) ? [project(integration, fields)] : [],
  })
  const oauthStates = (where: Record<string, unknown> = {}): any => ({
    where: (next: any) => typeof next === 'function' ? oauthStates(where) : oauthStates({ ...where, ...next }),
    first: async () => oauthState && matches(oauthState, where) ? oauthState : null,
    deleteAndCount: async () => {
      if (!oauthState) return 0
      const expired = oauthState.expiresAt.epochMilliseconds < Date.now()
      if (oauthState.consumedAt || expired || Object.keys(where).length === 0) { oauthState = null; return 1 }
      return 0
    },
    updateAndCount: async (data: Record<string, unknown>) => {
      if (!oauthState || !matches(oauthState, where) || oauthState.consumedAt) return 0
      oauthState = { ...oauthState, ...data }; return 1
    },
    create: async (data: Record<string, unknown>) => {
      oauthState = { id: 'state-a', consumedAt: null, createdAt: prisma8TimestampFromDate(new Date()), ...data }
      return oauthState
    },
  })
  const mappings = (where: Record<string, unknown> = {}): any => ({
    where: (next: Record<string, unknown>) => mappings({ ...where, ...next }),
    first: async () => matches(mapping, where) ? mapping : null,
  })
  const users = (where: Record<string, unknown> = {}, fields: string[] = []): any => ({
    where: (next: Record<string, unknown>) => users({ ...where, ...next }, fields),
    select: (...next: string[]) => users(where, next),
    first: async () => matches(mappedUser, where) ? project(mappedUser, fields) : null,
    update: async (data: Record<string, unknown>) => {
      if (!matches(mappedUser, where)) return null
      const { updatedAt: _updatedAt, ...profile } = data; updatedProfile = profile
      Object.assign(mappedUser, data); return mappedUser
    },
  })
  const identities = (where: Record<string, unknown> = {}, fields: string[] = []): any => ({
    where: (next: any) => typeof next === 'function' ? identities(where, fields) : identities({ ...where, ...next }, fields),
    select: (...next: string[]) => identities(where, next),
    first: async () => identity && matches(identity, where) ? project(identity, fields) : null,
    update: async (data: Record<string, unknown>) => { if (!identity || !matches(identity, where)) return null; identity = { ...identity, ...data }; return identity },
    create: async (data: Record<string, unknown>) => {
      const now = prisma8TimestampFromDate(new Date())
      identity = { id: 'identity-a', status: 'ACTIVE', boundAt: now, revokedAt: null, lastLoginAt: null, createdAt: now, ...data }
      return identity
    },
  })
  const extensions = (where: Record<string, unknown> = {}, fields: string[] = []): any => ({
    where: (next: Record<string, unknown>) => extensions({ ...where, ...next }, fields),
    select: (...next: string[]) => extensions(where, next), first: async () => extension && matches(extension, where) ? project(extension, fields) : null,
    update: async (data: Record<string, unknown>) => { extension = { ...extension, ...data }; updatedAvatar = extension.avatar; return extension },
    create: async (data: Record<string, unknown>) => { extension = { ...data, platformInfo: null }; updatedAvatar = extension.avatar; return extension },
  })
  const publicOrm = { Tenants: tenants(), EnterpriseIntegrations: integrationsCollection(), ExternalOauthStates: oauthStates(), ExternalUserMappings: mappings(), Users: users(), ExternalIdentities: identities(), UserExtensions: extensions() }
  const prisma8 = { client: { orm: { public: publicOrm }, transaction: async (callback: (tx: any) => Promise<unknown>) => callback({ orm: { public: publicOrm } }) } } as unknown as Prisma8Service
  const config = {
    get: (key: string) => key === 'DINGTALK_DEFAULT_TENANT_SLUG' ? tenant.slug : key === 'WEB_PUBLIC_URL' ? 'http://localhost:5173' : key === 'NODE_ENV' ? 'test' : undefined,
  } as unknown as ConfigService
  const integrations = {
    getActivePlatform: async () => ({ syncResource: 'DINGTALK', sync: true }),
    getDingTalkRuntimeContext: async () => ({ integration, credentials: { corpId: integration.corpId, clientId: integration.clientId, agentId: integration.agentId, appSecret: 'secret' } }),
  } as unknown as EnterpriseIntegrationsService
  const client = { exchangeOAuthLoginCode: async () => ({
    userId: 'User-001', externalKey: 'user-001', unionId: 'union-001', email: 'zhangsan@work.example.com',
    phone: '13800000001', avatarUrl: 'https://example.com/avatar.png', gender: null,
  }) } as unknown as DingTalkClient
  const auth = {
    loginExternal: async () => { loginCalls += 1; return { accessToken: 'access-token', refreshToken: 'refresh-token', user: { id: mapping.userId } } },
    recordExternalLoginFailure: async () => { failedAudits += 1 },
  } as unknown as AuthService
  const service = new DingTalkSsoService(prisma8, config, integrations, client, auth)

  const started = await service.start({ returnPath: '/customers' })
  assert.ok(started.value.state.startsWith('qr-dingtalk.'))
  const authUrl = new URL(started.value.authorizationUrl)
  assert.equal(authUrl.origin + authUrl.pathname, 'https://login.dingtalk.com/oauth2/auth')
  assert.equal(authUrl.searchParams.get('client_id'), integration.clientId)
  assert.equal(authUrl.searchParams.get('corpid'), integration.corpId)
  assert.notEqual(oauthState.stateHash, started.value.state)
  const result = await service.callback({ code: 'single-use-code', state: started.value.state }, started.browserNonce, { ip: '127.0.0.1', userAgent: 'node-test' })
  assert.equal(result.returnPath, '/customers'); assert.equal(loginCalls, 1); assert.equal(identity.status, 'ACTIVE')
  assert.deepEqual(updatedProfile, { phone: '13800000001' }); assert.equal(updatedAvatar, 'https://example.com/avatar.png')
  await assert.rejects(() => service.callback({ code: 'replayed-code', state: started.value.state }, started.browserNonce, { ip: '127.0.0.1', userAgent: 'node-test' }), UnauthorizedException)
  assert.equal(loginCalls, 1); assert.equal(failedAudits, 1)
  const workbench = await service.startWorkbench({ returnPath: '/mobile/home' })
  assert.ok(workbench.value.state.startsWith('dingtalk.')); assert.equal(oauthState.flow, 'DINGTALK')
  assert.equal((await service.callbackWorkbench({ code: 'workbench-code', state: workbench.value.state }, workbench.browserNonce, { ip: '127.0.0.1', userAgent: 'DingTalk node-test' })).returnPath, '/mobile/home')
  assert.equal(loginCalls, 2)
})
