import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthService } from '../../auth/auth.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import type { DingTalkClient } from '../enterprise-integrations/dingtalk.client'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import { DingTalkSsoService } from './dingtalk-sso.service'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

test('DingTalk SSO 使用 Prisma 8 保持 discovery、身份绑定与 OAuth state 持久化语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = {
    getOrThrow: () => databaseUrl,
    get: (key: string) =>
      key === 'DINGTALK_OAUTH_REDIRECT_URI'
        ? 'https://crm.example.test/login/dingtalk/callback'
        : undefined,
  } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: {
      name: `p8-dingtalk-${suffix}`,
      slug: `p8-dingtalk-${suffix}`,
      enterpriseSyncResource: 'DINGTALK',
      enterpriseSynced: true,
    },
  })
  const user = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      email: `dingtalk-${suffix}@example.test`,
      passwordHash: 'not-used',
      name: 'DingTalk Prisma8 用户',
      passwordLoginEnabled: true,
    },
  })
  const integration = await fixtureDb.enterpriseIntegration.create({
    data: {
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
    },
  })
  const mapping = await fixtureDb.externalUserMapping.create({
    data: {
      tenantId: tenant.id,
      provider: 'DINGTALK',
      externalId: `User-${suffix}`,
      externalKey: `user-${suffix}`,
      userId: user.id,
      active: true,
    },
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
    prisma8,
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
    const persistedIdentity = await fixtureDb.externalIdentity.findUniqueOrThrow({
      where: {
        tenantId_provider_userId: { tenantId: tenant.id, provider: 'DINGTALK', userId: user.id },
      },
    })
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
    const stateRow = await fixtureDb.externalOAuthState.findUniqueOrThrow({
      where: { stateHash: sha256(started.value.state) },
    })
    assert.equal(stateRow.tenantId, tenant.id)
    assert.equal(stateRow.integrationId, integration.id)
    assert.equal(stateRow.flow, 'QR_DINGTALK')
    assert.equal(stateRow.returnPath, '/customers')
    assert.equal(stateRow.browserNonceHash, sha256(started.browserNonce))
    assert.notEqual(stateRow.stateHash, started.value.state)
    assert.notEqual(stateRow.browserNonceHash, started.browserNonce)
  } finally {
    await fixtureDb.externalOAuthState.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.externalIdentity.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.externalUserMapping.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.enterpriseIntegration.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.tenant.deleteMany({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
