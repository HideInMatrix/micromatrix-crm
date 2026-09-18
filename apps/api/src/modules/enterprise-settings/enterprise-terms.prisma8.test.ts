import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { EnterpriseTermsService } from './enterprise-terms.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'EnterpriseTerms 使用 Prisma 8 保持分类统计、关键词查询与 discovery 采纳事务',
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
        data: { name: `Prisma8 terms ${suffix}`, slug: `p8-terms-${suffix}` },
      })
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

      const discovery = await fixtureDb.enterpriseTermDiscovery.create({
        data: {
          tenantId: tenant.id,
          discovered: 'ARR',
          source: 'AI',
          context: '合同分析',
        },
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

      const storedDiscovery = await fixtureDb.enterpriseTermDiscovery.findUniqueOrThrow({
        where: { id: discovery.id },
      })
      assert.equal(storedDiscovery.status, 'ADOPTED')
      assert.equal(storedDiscovery.adoptedTermId, adopted.id)
      assert.equal(await fixtureDb.enterpriseTerm.count({ where: { tenantId: tenant.id } }), 2)
    } finally {
      if (tenantId) {
        await fixtureDb.enterpriseTermDiscovery.deleteMany({ where: { tenantId } })
        await fixtureDb.enterpriseTerm.deleteMany({ where: { tenantId } })
        await fixtureDb.enterpriseTermCategory.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
