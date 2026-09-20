import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthService } from '../../auth/auth.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { DingTalkClient } from '../enterprise-integrations/dingtalk.client'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import { DingTalkSsoService } from './dingtalk-sso.service'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

test('DingTalk SSO 使用 Prisma 保持 discovery、身份绑定与 OAuth state 持久化语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = {
    getOrThrow: () => databaseUrl,
    get: (key: string) =>
      key === 'DINGTALK_OAUTH_REDIRECT_URI'
        ? 'https://crm.example.test/login/dingtalk/callback'
        : undefined,
  } as unknown as ConfigService
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prismaClient = testDb.client
  const prisma = { client: prismaClient } as PrismaService

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prismaClient, 'p8-dingtalk')
  await prismaClient.orm.public.Tenants.where({ id: tenant.id }).update({
    enterpriseSyncResource: 'DINGTALK',
    enterpriseSynced: true,
    updatedAt: nowInstant(),
  })
  const user = await createPrismaTestUser(prismaClient, {
    tenantId: tenant.id,
    email: `dingtalk-${suffix}@example.test`,
    passwordHash: 'not-used',
    name: 'DingTalk Prisma 用户',
  })
  const integration = await prismaClient.orm.public.EnterpriseIntegrations.select(
    'id',
    'corpId',
    'clientId',
    'agentId',
    'syncEnabled',
  ).create({
    tenantId: tenant.id,
    provider: 'DINGTALK',
    corpId: `ding-corp-${suffix}`,
    clientId: `ding-client-${suffix}`,
    agentId: '10001',
    secretCiphertext: 'ciphertext',
    secretIv: 'iv',
    secretAuthTag: 'tag',
    syncEnabled: true,
    lastTestSucceeded: true,
    createdById: user.id,
    updatedById: user.id,
    updatedAt: nowInstant(),
  })
  const mapping = await prismaClient.orm.public.ExternalUserMappings.select(
    'id',
    'externalId',
  ).create({
    tenantId: tenant.id,
    provider: 'DINGTALK',
    externalId: `User-${suffix}`,
    externalKey: `user-${suffix}`,
    userId: user.id,
    active: true,
    updatedAt: nowInstant(),
  })

  const integrations = {
    getActivePlatform: async () => ({ syncResource: 'DINGTALK', sync: true }),
    getDingTalkRuntimeContext: async () => ({
      integration,
      credentials: {
        corpId: integration.corpId,
        clientId: integration.clientId!,
        agentId: integration.agentId,
        appSecret: 'secret',
      },
    }),
  } as unknown as EnterpriseIntegrationsService
  const service = new DingTalkSsoService(
    prisma,
    config,
    integrations,
    {} as DingTalkClient,
    {} as AuthService,
  )

  try {
    const discovery = await service.discovery(tenant.slug)
    assert.equal(discovery.available, true)
    assert.equal(discovery.tenantSlug, tenant.slug)
    assert.equal(discovery.clientId, integration.clientId)
    assert.equal(discovery.corpId, integration.corpId)

    const beforeBind = await service.getIdentity(tenant.id, user.id)
    assert.equal(beforeBind.mapped, true)
    assert.equal(beforeBind.externalSubject, mapping.externalId)
    assert.equal(beforeBind.status, null)

    const bound = await service.bindIdentity(tenant.id, user.id, user.id)
    assert.equal(bound.status, 'ACTIVE')
    assert.equal(bound.externalSubject, mapping.externalId)
    const persistedIdentity = await prismaClient.orm.public.ExternalIdentities.where({
      tenantId: tenant.id,
      provider: 'DINGTALK',
      userId: user.id,
    })
      .select('mappingId', 'integrationId')
      .first()
    assert.ok(persistedIdentity)
    assert.equal(persistedIdentity.mappingId, mapping.id)
    assert.equal(persistedIdentity.integrationId, integration.id)

    const revoked = await service.unbindIdentity(tenant.id, user.id, user.id)
    assert.equal(revoked.status, 'REVOKED')
    assert.ok(revoked.revokedAt)
    const rebound = await service.bindIdentity(tenant.id, user.id, user.id)
    assert.equal(rebound.status, 'ACTIVE')
    assert.equal(rebound.revokedAt, null)

    const started = await service.start({ tenantSlug: tenant.slug, returnPath: '/customers' })
    assert.ok(started.value.state.startsWith('qr-dingtalk.'))
    assert.equal(started.value.clientId, integration.clientId)
    assert.equal(started.value.redirectUri, 'https://crm.example.test/login/dingtalk/callback')
    const stateRow = await prismaClient.orm.public.ExternalOauthStates.where({
      stateHash: sha256(started.value.state),
    }).first()
    assert.ok(stateRow)
    assert.equal(stateRow.tenantId, tenant.id)
    assert.equal(stateRow.integrationId, integration.id)
    assert.equal(stateRow.flow, 'QR_DINGTALK')
    assert.equal(stateRow.returnPath, '/customers')
    assert.equal(stateRow.browserNonceHash, sha256(started.browserNonce))
    assert.notEqual(stateRow.stateHash, started.value.state)
    assert.notEqual(stateRow.browserNonceHash, started.browserNonce)
  } finally {
    await prismaClient.orm.public.ExternalOauthStates.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.ExternalIdentities.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.ExternalUserMappings.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.EnterpriseIntegrations.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prismaClient.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
