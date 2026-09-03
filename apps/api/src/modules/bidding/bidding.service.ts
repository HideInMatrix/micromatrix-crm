import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  BiddingInfoVO,
  BiddingKeywordVO,
  BiddingSourceVO,
  PaginatedResult,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { BiddingInfo, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { BiddingItem, BiddingProvider } from './providers/bidding-provider.interface'
import { DemoBiddingProvider } from './providers/demo.provider'
import { ImportBiddingDto, QueryBiddingDto } from './dto/bidding.dto'

@Injectable()
export class BiddingService {
  private readonly logger = new Logger(BiddingService.name)
  /** 适配器注册表：接入真实数据源时在此注册 */
  private readonly providers: Map<string, BiddingProvider>

  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldValues: ResourceFieldValueService,
    demoProvider: DemoBiddingProvider,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {
    this.providers = new Map([[demoProvider.key, demoProvider]])
  }

  // ===== 数据源配置 =====

  async listSources(tenantId: string): Promise<BiddingSourceVO[]> {
    const rows = await this.prisma.biddingSource.findMany({ where: { tenantId } })
    return [...this.providers.values()].map((provider) => {
      const row = rows.find((r) => r.provider === provider.key)
      return {
        id: row?.id ?? provider.key,
        provider: provider.key,
        name: provider.label,
        enabled: row?.enabled ?? false,
        hasCredentials: Boolean(row?.credentials),
        lastFetchAt: row?.lastFetchAt?.toISOString() ?? null,
      }
    })
  }

  async saveSource(
    user: AuthUser,
    provider: string,
    enabled: boolean,
    credentials?: Record<string, unknown>,
  ) {
    const adapter = this.providers.get(provider)
    if (!adapter) throw new BadRequestException('不支持的数据源')
    if (enabled && adapter.requiresCredentials && !credentials) {
      const existing = await this.prisma.biddingSource.findUnique({
        where: { tenantId_provider: { tenantId: user.tenantId, provider } },
      })
      if (!existing?.credentials) throw new BadRequestException('该数据源需要配置凭证')
    }
    await this.prisma.biddingSource.upsert({
      where: { tenantId_provider: { tenantId: user.tenantId, provider } },
      update: {
        enabled,
        ...(credentials ? { credentials: credentials as Prisma.InputJsonValue } : {}),
      },
      create: {
        tenantId: user.tenantId,
        provider,
        name: adapter.label,
        enabled,
        credentials: credentials as Prisma.InputJsonValue | undefined,
      },
    })
    return { name: adapter.label }
  }

  // ===== 关键词订阅 =====

  async listKeywords(tenantId: string): Promise<BiddingKeywordVO[]> {
    const rows = await this.prisma.biddingKeywordSub.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r) => ({ id: r.id, keyword: r.keyword, enabled: r.enabled }))
  }

  async addKeyword(user: AuthUser, keyword: string) {
    const trimmed = keyword.trim()
    if (!trimmed) throw new BadRequestException('关键词不能为空')
    const exists = await this.prisma.biddingKeywordSub.findUnique({
      where: { tenantId_keyword: { tenantId: user.tenantId, keyword: trimmed } },
    })
    if (exists) throw new BadRequestException('该关键词已订阅')
    await this.prisma.biddingKeywordSub.create({
      data: { tenantId: user.tenantId, keyword: trimmed },
    })
    return { name: trimmed }
  }

  async toggleKeyword(user: AuthUser, id: string) {
    const row = await this.prisma.biddingKeywordSub.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!row) throw new NotFoundException('订阅不存在')
    await this.prisma.biddingKeywordSub.update({
      where: { id },
      data: { enabled: !row.enabled },
    })
    return { name: row.keyword }
  }

  async removeKeyword(user: AuthUser, id: string) {
    const row = await this.prisma.biddingKeywordSub.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!row) throw new NotFoundException('订阅不存在')
    await this.prisma.biddingKeywordSub.delete({ where: { id } })
    return { name: row.keyword }
  }

  // ===== 抓取 =====

  /** 每天早上 8 点自动抓取全部租户 */
  @Cron('0 0 8 * * *')
  async scheduledFetchAllTenants() {
    if (!this.coordinator) return void (await this.fetchAllTenants())
    await this.coordinator.runScheduledOnce('bidding-fetch', 'DAILY', () => this.fetchAllTenants())
  }

  async fetchAllTenants() {
    const sources = await this.prisma.biddingSource.findMany({ where: { enabled: true } })
    const tenantIds = [...new Set(sources.map((s) => s.tenantId))]
    for (const tenantId of tenantIds) {
      await this.fetchTenant(tenantId).catch((e) =>
        this.logger.error(`租户 ${tenantId} 标讯抓取失败: ${e.message}`),
      )
    }
  }

  /** 手动/定时抓取：启用数据源 × 启用关键词，去重入库 */
  async fetchTenant(tenantId: string): Promise<{ fetched: number; inserted: number }> {
    const [sources, keywords] = await Promise.all([
      this.prisma.biddingSource.findMany({ where: { tenantId, enabled: true } }),
      this.prisma.biddingKeywordSub.findMany({ where: { tenantId, enabled: true } }),
    ])
    if (sources.length === 0) throw new BadRequestException('请先启用至少一个数据源')
    if (keywords.length === 0) throw new BadRequestException('请先订阅至少一个关键词')

    let fetched = 0
    let inserted = 0
    for (const source of sources) {
      const provider = this.providers.get(source.provider)
      if (!provider) continue
      for (const sub of keywords) {
        const items = await provider
          .fetch((source.credentials as Record<string, unknown>) ?? {}, sub.keyword)
          .catch((e) => {
            this.logger.warn(`数据源 ${source.provider} 拉取「${sub.keyword}」失败: ${e.message}`)
            return [] as BiddingItem[]
          })
        fetched += items.length
        for (const item of items) {
          const created = await this.insertUnique(tenantId, source.provider, sub.keyword, item)
          if (created) inserted++
        }
      }
      await this.prisma.biddingSource.update({
        where: { id: source.id },
        data: { lastFetchAt: new Date() },
      })
    }
    return { fetched, inserted }
  }

  /** 手动录入（无数据源账号时的兜底） */
  async manualImport(user: AuthUser, dto: ImportBiddingDto) {
    const created = await this.insertUnique(user.tenantId, 'manual', dto.keyword ?? null, {
      title: dto.title,
      type: dto.type,
      region: dto.region,
      buyer: dto.buyer,
      budget: dto.budget,
      publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : undefined,
      deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      sourceUrl: dto.sourceUrl,
      content: dto.content,
    })
    if (!created) throw new BadRequestException('该标讯已存在（标题+发布日期重复）')
    return { id: created.id, name: created.title }
  }

  // ===== 查询与转化 =====

  async findAll(user: AuthUser, query: QueryBiddingDto): Promise<PaginatedResult<BiddingInfoVO>> {
    const { page = 1, pageSize = 10, keyword, type } = query
    const where: Prisma.BiddingInfoWhereInput = {
      tenantId: user.tenantId,
      ...(type ? { type } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword, mode: 'insensitive' } },
              { buyer: { contains: keyword, mode: 'insensitive' } },
              { keyword: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.biddingInfo.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.biddingInfo.count({ where }),
    ])
    return { items: items.map((b) => this.toVO(b)), total, page, pageSize }
  }

  /** 标讯一键转线索 */
  async convertToLead(user: AuthUser, id: string) {
    const bidding = await this.prisma.biddingInfo.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!bidding) throw new NotFoundException('标讯不存在')
    if (bidding.convertedLeadId) throw new BadRequestException('该标讯已转为线索')

    const now = BigInt(Date.now())
    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clue.create({
        data: {
          organizationId: user.tenantId,
          name: bidding.buyer
            ? `${bidding.buyer}（${bidding.title.slice(0, 40)}）`
            : bidding.title.slice(0, 80),
          owner: user.id,
          stage: 'FOLLOWING',
          inSharedPool: false,
          collectionTime: now,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await this.fieldValues.save(
        user.tenantId,
        'clue',
        created.id,
        { cf_source: '标讯' },
        'create',
        tx,
      )
      return created
    })
    await this.prisma.biddingInfo.update({
      where: { id },
      data: { convertedLeadId: lead.id },
    })
    return { id: lead.id, name: lead.name }
  }

  private async insertUnique(
    tenantId: string,
    source: string,
    keyword: string | null,
    item: BiddingItem,
  ): Promise<BiddingInfo | null> {
    const hash = `${item.title}|${item.publishedAt?.toISOString().slice(0, 10) ?? ''}`
    const exists = await this.prisma.biddingInfo.findUnique({
      where: { tenantId_hash: { tenantId, hash } },
    })
    if (exists) return null
    return this.prisma.biddingInfo.create({
      data: {
        tenantId,
        title: item.title,
        type: item.type,
        region: item.region,
        buyer: item.buyer,
        budget: item.budget,
        publishedAt: item.publishedAt,
        deadline: item.deadline,
        sourceUrl: item.sourceUrl,
        content: item.content,
        source,
        keyword,
        hash,
      },
    })
  }

  private toVO(b: BiddingInfo): BiddingInfoVO {
    return {
      id: b.id,
      title: b.title,
      type: b.type,
      region: b.region,
      buyer: b.buyer,
      budget: b.budget ? Number(b.budget) : null,
      publishedAt: b.publishedAt?.toISOString().slice(0, 10) ?? null,
      deadline: b.deadline?.toISOString().slice(0, 10) ?? null,
      sourceUrl: b.sourceUrl,
      content: b.content,
      source: b.source,
      keyword: b.keyword,
      convertedLeadId: b.convertedLeadId,
      createdAt: b.createdAt.toISOString(),
    }
  }
}
