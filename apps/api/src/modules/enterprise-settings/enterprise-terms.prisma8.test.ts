import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { EnterpriseTermsService } from './enterprise-terms.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'EnterpriseTerms 使用 Prisma 8 保持分类统计、关键词查询与 discovery 采纳事务',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-terms')
      tenantId = tenant.id
      const user = { id: `user-${suffix}`, tenantId: tenant.id } as AuthUser
      const service = new EnterpriseTermsService({ client: prisma8Client } as Prisma8Service)

      const category = await service.createCategory(tenant.id, { name: '销售指标' })
      const gmv = await service.createTerm(user, {
        categoryId: category.id,
        standardTerm: 'GMV',
        alsoCalled: '成交总额',
        avoidThese: '总流水',
        enable: true,
      })
      assert.equal(gmv.categoryName, '销售指标')
      assert.equal((await service.terms(tenant.id, undefined, '成交')).length, 1)

      const discovery = await prisma8Client.orm.public.EnterpriseTermDiscoveries
        .select('id')
        .create({
          tenantId: tenant.id,
          discovered: 'ARR',
          source: 'AI',
          context: '合同分析',
          updatedAt: prisma8Now(),
      })
      const adopted = await service.adoptDiscovery(user, discovery.id, {
        categoryId: category.id,
        standardTerm: 'ARR',
        alsoCalled: '年度经常性收入',
        enable: true,
      })
      assert.equal(adopted.categoryName, '销售指标')

      const categories = await service.categories(tenant.id)
      assert.equal(categories.length, 1)
      assert.equal(categories[0]?.termCount, 2)

      const storedDiscovery = await prisma8Client.orm.public.EnterpriseTermDiscoveries.where({
        id: discovery.id,
      }).first()
      assert.ok(storedDiscovery)
      assert.equal(storedDiscovery.status, 'ADOPTED')
      assert.equal(storedDiscovery.adoptedTermId, adopted.id)
      assert.equal(
        (await prisma8Client.orm.public.EnterpriseTerms.where({ tenantId: tenant.id }).select('id').all())
          .length,
        2,
      )
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.EnterpriseTermDiscoveries.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.EnterpriseTerms.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.EnterpriseTermCategories.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
