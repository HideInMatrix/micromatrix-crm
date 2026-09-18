import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import test from 'node:test'
import { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import { CredentialCipherService } from '../../common/services/credential-cipher.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import type { DingTalkClient } from './dingtalk.client'
import { EnterpriseIntegrationsService } from './enterprise-integrations.service'
import type { LarkClient } from './lark.client'
import type { WeComClient } from './wecom.client'

test('EnterpriseIntegrations 使用 Prisma 8 保持三 Provider 配置、版本失效与平台切换语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')
  const config = new ConfigService({
    DATABASE_URL: databaseUrl,
    INTEGRATION_CREDENTIALS_KEY: 'test_integration_credentials_key_more_than_32_chars',
    JWT_ACCESS_SECRET: 'unused-test-jwt-secret',
  })
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-integrations-${suffix}`, slug: `p8-integrations-${suffix}` },
  })
  const actor = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      email: `integration-${suffix}@example.test`,
      passwordHash: 'not-used',
      name: 'Integration Admin',
    },
  })
  const role = await fixtureDb.role.create({ data: { tenantId: tenant.id, name: `成员-${suffix}` } })
  const department = await fixtureDb.department.create({
    data: { tenantId: tenant.id, name: `同步目标-${suffix}` },
  })
  const user: AuthUser = {
    id: actor.id,
    tenantId: tenant.id,
    email: actor.email ?? '',
    name: actor.name,
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: ['system:setting', 'system:setting:update'],
  }
  const cipher = new CredentialCipherService(config)
  const success = { success: true, message: '连接成功', providerCode: 0 }
  const service = new EnterpriseIntegrationsService(
    prisma8,
    cipher,
    { testConnection: async () => success } as unknown as WeComClient,
    { testConnection: async () => success } as unknown as DingTalkClient,
    { testConnection: async () => success } as unknown as LarkClient,
  )

  try {
    assert.deepEqual(await service.getActivePlatform(tenant.id), {
      syncResource: 'WECOM',
      sync: false,
    })

    const first = await service.saveWeCom(user, {
      corpId: `ww-${suffix}`,
      agentId: '1000001',
      appSecret: 'wecom-secret-1',
      redirectUrl: '/teacher',
    })
    assert.equal(first.credentialVersion, 1)
    assert.equal(first.secretConfigured, true)
    const tested = await service.testWeCom(user, {
      corpId: `ww-${suffix}`,
      agentId: '1000001',
      redirectUrl: '/teacher',
    })
    assert.equal(tested.success, true)
    assert.equal(tested.integration.lastTestSucceeded, true)
    const enabled = await service.updateWeComSync(user, { enabled: true, defaultRoleId: role.id })
    assert.equal(enabled.syncEnabled, true)

    const wecomRow = await fixtureDb.enterpriseIntegration.findUniqueOrThrow({
      where: { tenantId_provider: { tenantId: tenant.id, provider: 'WECOM' } },
    })
    const batch = await fixtureDb.organizationSyncBatch.create({
      data: {
        tenantId: tenant.id,
        integrationId: wecomRow.id,
        provider: 'WECOM',
        status: 'PREVIEW_READY',
        targetDepartmentId: department.id,
        credentialVersion: wecomRow.credentialVersion,
        counts: { create: 0, update: 0, disable: 0, unchanged: 0, conflict: 0, skip: 0, failed: 0 },
        createdById: actor.id,
      },
    })
    const changed = await service.saveWeCom(user, {
      corpId: `ww-${suffix}`,
      agentId: '1000002',
      appSecret: 'wecom-secret-2',
      redirectUrl: '/teacher',
    })
    assert.equal(changed.credentialVersion, 2)
    assert.equal(changed.syncEnabled, false)
    assert.equal(changed.lastTestSucceeded, null)
    const invalidated = await fixtureDb.organizationSyncBatch.findUniqueOrThrow({ where: { id: batch.id } })
    assert.equal(invalidated.status, 'INVALIDATED')
    assert.equal(invalidated.errorCode, 'CREDENTIALS_CHANGED')
    assert.ok(invalidated.finishedAt)

    await service.saveDingTalk(user, {
      corpId: `ding-${suffix}`,
      clientId: `app-key-${suffix}`,
      agentId: '20001',
      appSecret: 'ding-secret',
    })
    await service.testDingTalk(user, {
      corpId: `ding-${suffix}`,
      clientId: `app-key-${suffix}`,
      agentId: '20001',
    })
    assert.deepEqual(await service.switchActivePlatform(user, 'DINGTALK'), {
      syncResource: 'DINGTALK',
      sync: false,
    })
    assert.equal(
      (await service.updateDingTalkSync(user, { enabled: true, defaultRoleId: role.id })).syncEnabled,
      true,
    )

    await service.saveLark(user, {
      corpId: `lark-${suffix}`,
      agentId: `cli-${suffix}`,
      redirectUrl: 'https://crm.example.test/login/lark/callback',
      appSecret: 'lark-secret',
    })
    await service.testLark(user, {
      corpId: `lark-${suffix}`,
      agentId: `cli-${suffix}`,
      redirectUrl: 'https://crm.example.test/login/lark/callback',
    })
    assert.deepEqual(await service.switchActivePlatform(user, 'LARK'), {
      syncResource: 'LARK',
      sync: false,
    })
    assert.equal(
      (await service.updateLarkSync(user, { enabled: true, defaultRoleId: role.id })).syncEnabled,
      true,
    )

    const rows = await fixtureDb.enterpriseIntegration.findMany({ where: { tenantId: tenant.id } })
    assert.equal(rows.length, 3)
    assert.equal(rows.filter((row) => row.syncEnabled).length, 1)
    assert.equal(rows.find((row) => row.provider === 'LARK')?.syncEnabled, true)
    assert.deepEqual(await service.getLarkSecret(tenant.id), { appSecret: 'lark-secret' })
  } finally {
    await fixtureDb.organizationSyncBatch.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.enterpriseIntegration.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.role.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.department.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.tenant.deleteMany({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
