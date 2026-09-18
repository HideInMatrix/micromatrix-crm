import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthService } from '../../auth/auth.service'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { LarkClient } from '../enterprise-integrations/lark.client'
import { LarkSsoService } from './lark-sso.service'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

test('Lark SSO 使用 Prisma 8 保持 discovery、身份绑定与 OAuth state 持久化语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = {
    getOrThrow: () => databaseUrl,
    get: () => undefined,
  } as unknown as ConfigService
  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-lark')
  await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).update({
    enterpriseSyncResource: 'LARK',
    enterpriseSynced: true,
    updatedAt: prisma8Now(),
  })
  const user = await createPrismaTestUser(prisma8Client, {
    tenantId: tenant.id,
    email: `lark-${suffix}@example.test`,
    passwordHash: 'not-used',
    name: 'Lark Prisma8 用户',
  })
  const integration = await prisma8Client.orm.public.EnterpriseIntegrations
    .select('id', 'corpId', 'agentId', 'redirectUrl', 'syncEnabled')
    .create({
      tenantId: tenant.id,
      provider: 'LARK',
      corpId: `tenant-key-${suffix}`,
      agentId: `cli-${suffix}`,
      redirectUrl: 'https://crm.example.test/login/lark/callback',
      secretCiphertext: 'ciphertext',
      secretIv: 'iv',
      secretAuthTag: 'tag',
      syncEnabled: true,
      lastTestSucceeded: true,
      createdById: user.id,
      updatedById: user.id,
      updatedAt: prisma8Now(),
  })
  const mapping = await prisma8Client.orm.public.ExternalUserMappings
    .select('id', 'externalId')
    .create({
      tenantId: tenant.id,
      provider: 'LARK',
      externalId: `ou-${suffix}`,
      externalKey: `open-${suffix}`,
      userId: user.id,
      active: true,
      updatedAt: prisma8Now(),
  })

  const integrations = {
    getActivePlatform: async () => ({ syncResource: 'LARK', sync: true }),
    getLarkRuntimeContext: async () => ({
      integration,
      credentials: {
        corpId: integration.corpId,
        agentId: integration.agentId,
        appSecret: 'secret',
        redirectUrl: integration.redirectUrl!,
      },
    }),
  } as unknown as EnterpriseIntegrationsService
  const service = new LarkSsoService(
    prisma8,
    config,
    integrations,
    {} as LarkClient,
    {} as AuthService,
  )

  try {
    const discovery = await service.discovery(tenant.slug)
    assert.equal(discovery.available, true)
    assert.equal(discovery.tenantSlug, tenant.slug)
    assert.equal(discovery.appId, integration.agentId)
    assert.equal(discovery.corpId, integration.corpId)
    assert.equal(discovery.redirectUrl, integration.redirectUrl)

    const beforeBind = await service.getIdentity(tenant.id, user.id)
    assert.equal(beforeBind.mapped, true)
    assert.equal(beforeBind.externalSubject, mapping.externalId)
    assert.equal(beforeBind.status, null)

    const bound = await service.bindIdentity(tenant.id, user.id, user.id)
    assert.equal(bound.status, 'ACTIVE')
    assert.equal(bound.externalSubject, mapping.externalId)
    assert.ok(bound.boundAt)
    const persistedIdentity = await prisma8Client.orm.public.ExternalIdentities.where({
      tenantId: tenant.id,
      provider: 'LARK',
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
    assert.ok(started.value.state.startsWith('qr-lark.'))
    assert.equal(started.value.redirectUri, integration.redirectUrl)
    assert.equal(started.value.appId, integration.agentId)
    const stateRow = await prisma8Client.orm.public.ExternalOauthStates.where({
      stateHash: sha256(started.value.state),
    }).first()
    assert.ok(stateRow)
    assert.equal(stateRow.tenantId, tenant.id)
    assert.equal(stateRow.integrationId, integration.id)
    assert.equal(stateRow.flow, 'QR_LARK')
    assert.equal(stateRow.returnPath, '/customers')
    assert.equal(stateRow.browserNonceHash, sha256(started.browserNonce))
    assert.notEqual(stateRow.stateHash, started.value.state)
    assert.notEqual(stateRow.browserNonceHash, started.browserNonce)
  } finally {
    await prisma8Client.orm.public.ExternalOauthStates.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.ExternalIdentities.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.ExternalUserMappings.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.EnterpriseIntegrations.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
