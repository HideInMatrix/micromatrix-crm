import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { AttachmentsService } from '../attachments/attachments.service'
import { EnterpriseUiSettingsService } from './enterprise-ui-settings.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'EnterpriseUiSettings 使用 Prisma 创建默认配置并保持公开 branding 跨 runtime 一致',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-ui')
      tenantId = tenant.id
      const service = new EnterpriseUiSettingsService(
        { client: prismaClient } as PrismaService,
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
        title: 'Prisma 品牌',
        slogan: 'Prisma 迁移验证',
        helpDoc: 'https://example.com/help',
      })
      assert.equal(updated.title, 'Prisma 品牌')

      const stored = await prismaClient.orm.public.EnterpriseUiSettings.where({
        tenantId: tenant.id,
      }).first()
      assert.ok(stored)
      assert.equal(stored.title, 'Prisma 品牌')
      assert.ok(stored.updatedAt)

      const branding = await service.getBranding(tenant.slug)
      assert.equal(branding.title, 'Prisma 品牌')
      assert.equal(branding.tenantSlug, tenant.slug)
    } finally {
      if (tenantId) {
        await prismaClient.orm.public.EnterpriseUiSettings.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
