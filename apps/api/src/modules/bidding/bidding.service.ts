import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  BiddingInfoVO,
  BiddingKeywordVO,
  BiddingSourceVO,
  PaginatedResult,
} from '@micromatrix/shared'
import { or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { PrismaService } from '../../prisma/prisma.service'
import { nowInstant, instantFromDate, instantToISOString } from '../../prisma/temporal'
import { decimalString, numericValue } from '../../prisma/numeric-value'
import { jsonValue } from '../../prisma/json-value'
import { createLegacyId32 } from '../../common/legacy-id'
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
    const rows = await this.prisma.client.orm.public.BiddingSources.where({ tenantId }).all()
    return [...this.providers.values()].map((provider) => {
      const row = rows.find((r) => r.provider === provider.key)
      return {
        id: row?.id ?? provider.key,
        provider: provider.key,
        name: provider.label,
        enabled: row?.enabled ?? false,
        hasCredentials: Boolean(row?.credentials),
        lastFetchAt: row?.lastFetchAt ? instantToISOString(row.lastFetchAt) : null,
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
    const sources = this.prisma.client.orm.public.BiddingSources
    const existing = await sources.where({ tenantId: user.tenantId, provider }).first()
    if (enabled && adapter.requiresCredentials && !credentials) {
      if (!existing?.credentials) throw new BadRequestException('该数据源需要配置凭证')
    }
    const now = nowInstant()
    if (existing) {
      await sources.where({ id: existing.id }).update({
        enabled,
        ...(credentials ? { credentials: jsonValue(credentials) } : {}),
        updatedAt: now,
      })
    } else {
      await sources.create({
        tenantId: user.tenantId,
        provider,
        name: adapter.label,
        enabled,
        credentials: credentials ? jsonValue(credentials) : null,
        updatedAt: now,
      })
    }
    return { name: adapter.label }
  }

  // ===== 关键词订阅 =====

  async listKeywords(tenantId: string): Promise<BiddingKeywordVO[]> {
    const rows = await this.prisma.client.orm.public.BiddingKeywordSubs.where({ tenantId })
      .orderBy((row) => row.createdAt.asc())
      .all()
    return rows.map((r) => ({ id: r.id, keyword: r.keyword, enabled: r.enabled }))
  }

  async addKeyword(user: AuthUser, keyword: string) {
    const trimmed = keyword.trim()
    if (!trimmed) throw new BadRequestException('关键词不能为空')
    const keywords = this.prisma.client.orm.public.BiddingKeywordSubs
    const exists = await keywords.where({ tenantId: user.tenantId, keyword: trimmed }).first()
    if (exists) throw new BadRequestException('该关键词已订阅')
    try {
      await keywords.create({ tenantId: user.tenantId, keyword: trimmed })
    } catch (error) {
      if ((error as { sqlState?: string }).sqlState === '23505') {
        throw new BadRequestException('该关键词已订阅')
      }
      throw error
    }
    return { name: trimmed }
  }

  async toggleKeyword(user: AuthUser, id: string) {
    const keywords = this.prisma.client.orm.public.BiddingKeywordSubs
    const row = await keywords.where({ id, tenantId: user.tenantId }).first()
    if (!row) throw new NotFoundException('订阅不存在')
    await keywords.where({ id }).update({ enabled: !row.enabled })
    return { name: row.keyword }
  }

  async removeKeyword(user: AuthUser, id: string) {
    const keywords = this.prisma.client.orm.public.BiddingKeywordSubs
    const row = await keywords.where({ id, tenantId: user.tenantId }).first()
    if (!row) throw new NotFoundException('订阅不存在')
    await keywords.where({ id }).deleteAndCount()
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
    const sources = await this.prisma.client.orm.public.BiddingSources.where({ enabled: true })
      .select('tenantId')
      .all()
    const tenantIds = [...new Set(sources.map((s) => s.tenantId))]
    for (const tenantId of tenantIds) {
      await this.fetchTenant(tenantId).catch((e) =>
        this.logger.error(`租户 ${tenantId} 标讯抓取失败: ${e.message}`),
      )
    }
  }

  /** 手动/定时抓取：启用数据源 × 启用关键词，去重入库 */
  async fetchTenant(tenantId: string): Promise<{ fetched: number; inserted: number }> {
    const sources = await this.prisma.client.orm.public.BiddingSources.where({
      tenantId,
      enabled: true,
    }).all()
    const keywords = await this.prisma.client.orm.public.BiddingKeywordSubs.where({
      tenantId,
      enabled: true,
    }).all()
    if (sources.length === 0) throw new BadRequestException('请先启用至少一个数据源')
    if (keywords.length === 0) throw new BadRequestException('请先订阅至少一个关键词')

    let fetched = 0
    let inserted = 0
    for (const source of sources) {
      const provider = this.providers.get(source.provider)
      if (!provider) continue
      for (const sub of keywords) {
        const credentials = source.credentials
          ? (JSON.parse(JSON.stringify(source.credentials)) as Record<string, unknown>)
          : {}
        const items = await provider.fetch(credentials, sub.keyword).catch((e) => {
          this.logger.warn(`数据源 ${source.provider} 拉取「${sub.keyword}」失败: ${e.message}`)
          return [] as BiddingItem[]
        })
        fetched += items.length
        for (const item of items) {
          const created = await this.insertUniquePrisma(
            tenantId,
            source.provider,
            sub.keyword,
            item,
          )
          if (created) inserted++
        }
      }
      await this.prisma.client.orm.public.BiddingSources.where({ id: source.id }).update({
        lastFetchAt: nowInstant(),
        updatedAt: nowInstant(),
      })
    }
    return { fetched, inserted }
  }

  /** 手动录入（无数据源账号时的兜底） */
  async manualImport(user: AuthUser, dto: ImportBiddingDto) {
    const created = await this.insertUniquePrisma(user.tenantId, 'manual', dto.keyword ?? null, {
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
    const normalized = keyword?.trim()
    const scoped = this.prisma.client.orm.public.BiddingInfos.where({
      tenantId: user.tenantId,
      ...(type ? { _type: type } : {}),
    })
    const filtered = normalized
      ? scoped.where((row) =>
          or(
            row.title.ilike(`%${normalized}%`),
            row.buyer.ilike(`%${normalized}%`),
            row.keyword.ilike(`%${normalized}%`),
          ),
        )
      : scoped
    const [items, aggregate] = await Promise.all([
      filtered
        .orderBy([(row) => row.publishedAt.desc(), (row) => row.createdAt.desc()])
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      filtered.aggregate((agg) => ({ count: agg.count() })),
    ])
    return { items: items.map((b) => this.toVO(b)), total: aggregate.count, page, pageSize }
  }

  /** 标讯一键转线索 */
  async convertToLead(user: AuthUser, id: string) {
    const bidding = await this.prisma.client.orm.public.BiddingInfos.where({
      id,
      tenantId: user.tenantId,
    }).first()
    if (!bidding) throw new NotFoundException('标讯不存在')
    if (bidding.convertedLeadId) throw new BadRequestException('该标讯已转为线索')

    const now = BigInt(Date.now())
    const lead = await this.prisma.client.transaction(async (tx) => {
      const created = await tx.orm.public.Clue.create({
        id: createLegacyId32(),
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
      })
      await this.fieldValues.save(
        user.tenantId,
        'clue',
        created.id,
        { cf_source: '标讯' },
        'create',
        tx,
        user.id,
      )
      await tx.orm.public.BiddingInfos.where({ id: bidding.id, tenantId: user.tenantId }).update({
        convertedLeadId: created.id,
      })
      return created
    })
    return { id: lead.id, name: lead.name }
  }

  private async insertUniquePrisma(
    tenantId: string,
    source: string,
    keyword: string | null,
    item: BiddingItem,
  ) {
    const hash = `${item.title}|${item.publishedAt?.toISOString().slice(0, 10) ?? ''}`
    try {
      return await this.prisma.client.orm.public.BiddingInfos.create({
        tenantId,
        title: item.title,
        _type: item.type ?? null,
        region: item.region ?? null,
        buyer: item.buyer ?? null,
        budget:
          item.budget === undefined || item.budget === null
            ? null
            : numericValue(decimalString(item.budget, 16, 2), 16, 2),
        publishedAt: item.publishedAt ? instantFromDate(item.publishedAt) : null,
        deadline: item.deadline ? instantFromDate(item.deadline) : null,
        sourceUrl: item.sourceUrl ?? null,
        content: item.content ?? null,
        source,
        keyword,
        hash,
      })
    } catch (error) {
      if ((error as { sqlState?: string }).sqlState === '23505') return null
      throw error
    }
  }

  private toVO(b: {
    id: string
    title: string
    _type: string | null
    region: string | null
    buyer: string | null
    budget: unknown
    publishedAt: ReturnType<typeof nowInstant> | null
    deadline: ReturnType<typeof nowInstant> | null
    sourceUrl: string | null
    content: string | null
    source: string | null
    keyword: string | null
    convertedLeadId: string | null
    createdAt: ReturnType<typeof nowInstant>
  }): BiddingInfoVO {
    return {
      id: b.id,
      title: b.title,
      type: b._type,
      region: b.region,
      buyer: b.buyer,
      budget: b.budget === null || b.budget === undefined ? null : Number(b.budget),
      publishedAt: b.publishedAt ? instantToISOString(b.publishedAt).slice(0, 10) : null,
      deadline: b.deadline ? instantToISOString(b.deadline).slice(0, 10) : null,
      sourceUrl: b.sourceUrl,
      content: b.content,
      source: b.source,
      keyword: b.keyword,
      convertedLeadId: b.convertedLeadId,
      createdAt: instantToISOString(b.createdAt),
    }
  }
}
