import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { BiddingService } from './bidding.service'
import type { DemoBiddingProvider } from './providers/demo.provider'

test('Bidding production 路径完整使用 Prisma 8：配置、订阅、抓取、分页、手工导入与转线索', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const prisma = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await prisma.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await prisma.tenant.create({
    data: { name: `p8-bidding-${suffix}`, slug: `p8-bidding-${suffix}` },
  })
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `p8-bidding-${suffix}@example.com`,
      passwordHash: 'test-only',
      name: 'Bidding Owner',
      defaultPwd: false,
    },
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

    const infos = await prisma.biddingInfo.findMany({
      where: { tenantId: tenant.id },
      orderBy: { title: 'asc' },
    })
    assert.equal(infos.length, 2)
    assert.equal(Number(infos[0]?.budget), 123456.78)
    assert.equal(Number(infos[1]?.budget), 98765.43)
    assert.equal(infos[0]?.publishedAt?.toISOString(), publishedAt.toISOString())

    const refreshedSource = await prisma.biddingSource.findFirstOrThrow({
      where: { tenantId: tenant.id },
    })
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
    const storedLead = await prisma.clue.findUniqueOrThrow({ where: { id: lead.id } })
    assert.equal(storedLead.organizationId, tenant.id)
    assert.equal(storedLead.owner, owner.id)
    const converted = await prisma.biddingInfo.findUniqueOrThrow({ where: { id: manual.id } })
    assert.equal(converted.convertedLeadId, lead.id)
  } finally {
    await prisma.clue.deleteMany({ where: { organizationId: tenant.id } })
    await prisma.biddingInfo.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.biddingKeywordSub.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.biddingSource.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.user.deleteMany({ where: { tenantId: tenant.id } })
    await prisma.tenant.delete({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await prisma.$disconnect()
  }
})
