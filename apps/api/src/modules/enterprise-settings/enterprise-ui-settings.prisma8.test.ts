import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { AttachmentsService } from '../attachments/attachments.service'
import { EnterpriseUiSettingsService } from './enterprise-ui-settings.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'EnterpriseUiSettings 使用 Prisma 8 创建默认配置并保持公开 branding 跨 runtime 一致',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 UI ${suffix}`, slug: `p8-ui-${suffix}` },
      })
      tenantId = tenant.id
      const service = new EnterpriseUiSettingsService(
        { client: prisma8Client } as Prisma8Service,
        {} as AttachmentsService,
      )
      const user = { id: `user-${suffix}`, tenantId: tenant.id } as AuthUser

      const initial = await service.get(user)
      assert.equal(initial.title, 'MicroMatrix CRM')
      assert.ok(initial.updatedAt)

      const updated = await service.update(user, {
        theme: 'default',
        customTheme: '#008d91',
        style: 'default',
        customStyle: '#f9fbfb',
        title: 'Prisma 8 品牌',
        slogan: 'Prisma 8 迁移验证',
        helpDoc: 'https://example.com/help',
      })
      assert.equal(updated.title, 'Prisma 8 品牌')

      const stored = await fixtureDb.enterpriseUiSetting.findUniqueOrThrow({
        where: { tenantId: tenant.id },
      })
      assert.equal(stored.title, 'Prisma 8 品牌')
      assert.ok(stored.updatedAt)

      const branding = await service.getBranding(tenant.slug)
      assert.equal(branding.title, 'Prisma 8 品牌')
      assert.equal(branding.tenantSlug, tenant.slug)
    } finally {
      if (tenantId) {
        await fixtureDb.enterpriseUiSetting.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
