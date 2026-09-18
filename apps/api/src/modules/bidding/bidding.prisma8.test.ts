import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8TimestampToISOString } from '../../prisma/prisma8-temporal'
import { prisma8Varchar } from '../../prisma/prisma8-varchar'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { BiddingService } from './bidding.service'
import type { DemoBiddingProvider } from './providers/demo.provider'

test('Bidding production 路径完整使用 Prisma 8：配置、订阅、抓取、分页、手工导入与转线索', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-bidding')
  const owner = await createPrismaTestUser(prisma8Client, {
    tenantId: tenant.id,
    email: `p8-bidding-${suffix}@example.com`,
    passwordHash: 'test-only',
    name: 'Bidding Owner',
  })
  const user = { id: owner.id, tenantId: tenant.id } as AuthUser

  const publishedAt = new Date('2026-09-16T00:00:00.000Z')
  const provider = {
    key: 'demo',
    label: 'Prisma 8 Demo Source',
    requiresCredentials: false,
    fetch: async () => [
      {
        title: 'Prisma 8 标讯 A',
        type: '招标公告',
        region: '广东省',
        buyer: '测试采购方 A',
        budget: 123456.78,
        publishedAt,
        deadline: new Date('2026-09-30T00:00:00.000Z'),
        sourceUrl: 'https://example.com/a',
        content: 'A',
      },
      {
        title: 'Prisma 8 标讯 B',
        type: '中标公告',
        region: '北京市',
        buyer: '测试采购方 B',
        budget: 98765.43,
        publishedAt,
        sourceUrl: 'https://example.com/b',
        content: 'B',
      },
    ],
  } as unknown as DemoBiddingProvider
  const service = new BiddingService(
    prisma8,
    { save: async () => undefined } as never,
    provider,
  )

  try {
    assert.deepEqual(
      await service.saveSource(user, 'demo', true, { apiKey: 'prisma8-test' }),
      { name: 'Prisma 8 Demo Source' },
    )
    const sources = await service.listSources(tenant.id)
    assert.equal(sources.length, 1)
    assert.equal(sources[0]?.enabled, true)
    assert.equal(sources[0]?.hasCredentials, true)

    assert.deepEqual(await service.addKeyword(user, ' Prisma8 '), { name: 'Prisma8' })
    let keywords = await service.listKeywords(tenant.id)
    assert.equal(keywords.length, 1)
    assert.equal(keywords[0]?.keyword, 'Prisma8')
    await service.toggleKeyword(user, keywords[0]!.id)
    keywords = await service.listKeywords(tenant.id)
    assert.equal(keywords[0]?.enabled, false)
    await service.toggleKeyword(user, keywords[0]!.id)

    assert.deepEqual(await service.fetchTenant(tenant.id), { fetched: 2, inserted: 2 })
    assert.deepEqual(await service.fetchTenant(tenant.id), { fetched: 2, inserted: 0 })

    const infos = await prisma8Client.orm.public.BiddingInfos.where({ tenantId: tenant.id })
      .orderBy((row) => row.title.asc())
      .all()
    assert.equal(infos.length, 2)
    assert.equal(Number(infos[0]?.budget), 123456.78)
    assert.equal(Number(infos[1]?.budget), 98765.43)
    assert.equal(
      infos[0]?.publishedAt ? prisma8TimestampToISOString(infos[0].publishedAt) : null,
      publishedAt.toISOString(),
    )

    const refreshedSource = await prisma8Client.orm.public.BiddingSources.where({
      tenantId: tenant.id,
    }).first()
    assert.ok(refreshedSource)
    assert.ok(refreshedSource.lastFetchAt)
    assert.deepEqual(refreshedSource.credentials, { apiKey: 'prisma8-test' })

    await service.addKeyword(user, '临时关键词')
    const temporary = (await service.listKeywords(tenant.id)).find(
      (item) => item.keyword === '临时关键词',
    )
    assert.ok(temporary)
    assert.deepEqual(await service.removeKeyword(user, temporary.id), { name: '临时关键词' })

    const manual = await service.manualImport(user, {
      title: 'Prisma 8 手工标讯',
      type: '招标公告',
      buyer: '手工采购方',
      budget: 8888.66,
      publishedAt: '2026-09-17T00:00:00.000Z',
      keyword: '手工',
    })
    await assert.rejects(
      () =>
        service.manualImport(user, {
          title: 'Prisma 8 手工标讯',
          publishedAt: '2026-09-17T00:00:00.000Z',
        }),
      /该标讯已存在/,
    )

    const filtered = await service.findAll(user, {
      page: 1,
      pageSize: 10,
      keyword: '采购方 A',
      type: '招标公告',
    })
    assert.equal(filtered.total, 1)
    assert.equal(filtered.items[0]?.title, 'Prisma 8 标讯 A')
    assert.equal(filtered.items[0]?.budget, 123456.78)

    const lead = await service.convertToLead(user, manual.id)
    const storedLead = await prisma8Client.orm.public.Clue.where({
      id: prisma8Varchar(lead.id, 32),
    }).first()
    assert.ok(storedLead)
    assert.equal(storedLead.organizationId, tenant.id)
    assert.equal(storedLead.owner, owner.id)
    const converted = await prisma8Client.orm.public.BiddingInfos.where({ id: manual.id }).first()
    assert.ok(converted)
    assert.equal(converted.convertedLeadId, lead.id)
  } finally {
    await prisma8Client.orm.public.Clue
      .where({ organizationId: prisma8Varchar(tenant.id, 32) })
      .deleteAll()
    await prisma8Client.orm.public.BiddingInfos.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.BiddingKeywordSubs.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.BiddingSources.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
