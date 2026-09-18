import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  EnterpriseTermCategoryVO,
  EnterpriseTermDiscoveryVO,
  EnterpriseTermVO,
} from '@micromatrix/shared'
import { or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampToISOString } from '../../prisma/prisma8-temporal'
import type { SaveEnterpriseTermCategoryDto, SaveEnterpriseTermDto } from './dto/term-setting.dto'

type Prisma8Timestamp = Parameters<typeof prisma8TimestampToISOString>[0]

@Injectable()
export class EnterpriseTermsService {
  constructor(private readonly prisma8: Prisma8Service) {}

  async categories(tenantId: string): Promise<EnterpriseTermCategoryVO[]> {
    const rows = await this.categoriesTable()
      .where({ tenantId })
      .orderBy([(row) => row.sort.asc(), (row) => row.createdAt.asc()])
      .all()
    const counts = await this.termCounts(tenantId)
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sort: row.sort,
      termCount: counts.get(row.id) ?? 0,
    }))
  }

  async createCategory(tenantId: string, input: SaveEnterpriseTermCategoryDto) {
    await this.assertCategoryNameAvailable(tenantId, input.name)
    const sort = input.sort ?? (await this.nextCategorySort(tenantId))
    const row = await this.categoriesTable().create({
      tenantId,
      name: input.name,
      sort,
      updatedAt: prisma8Now(),
    })
    return {
      id: row.id,
      name: row.name,
      sort: row.sort,
      termCount: 0,
    } satisfies EnterpriseTermCategoryVO
  }

  async updateCategory(tenantId: string, id: string, input: SaveEnterpriseTermCategoryDto) {
    const existing = await this.ensureCategory(tenantId, id)
    await this.assertCategoryNameAvailable(tenantId, input.name, id)
    const row = await this.categoriesTable().where({ id: existing.id, tenantId }).update({
      name: input.name,
      ...(input.sort !== undefined && { sort: input.sort }),
      updatedAt: prisma8Now(),
    })
    if (!row) throw new NotFoundException('术语分类不存在')
    return {
      id: row.id,
      name: row.name,
      sort: row.sort,
      termCount: await this.categoryTermCount(tenantId, row.id),
    } satisfies EnterpriseTermCategoryVO
  }

  async removeCategory(tenantId: string, id: string) {
    const existing = await this.ensureCategory(tenantId, id)
    await this.categoriesTable().where({ id: existing.id, tenantId }).delete()
    return { id }
  }

  async terms(
    tenantId: string,
    categoryId?: string,
    keyword?: string,
  ): Promise<EnterpriseTermVO[]> {
    if (categoryId) await this.ensureCategory(tenantId, categoryId)
    const normalized = keyword?.trim()
    const scoped = this.termsTable().where({ tenantId, ...(categoryId && { categoryId }) })
    const filtered = normalized
      ? scoped.where((row) =>
          or(
            row.standardTerm.ilike(`%${normalized}%`),
            row.alsoCalled.ilike(`%${normalized}%`),
            row.avoidThese.ilike(`%${normalized}%`),
          ),
        )
      : scoped
    const rows = await filtered
      .orderBy([(row) => row.createdAt.desc(), (row) => row.id.asc()])
      .all()
    const categoryNames = await this.categoryNames(rows.map((row) => row.categoryId))
    return rows.map((row) => this.toVO(row, categoryNames.get(row.categoryId) ?? '已删除分类'))
  }

  async createTerm(user: AuthUser, input: SaveEnterpriseTermDto): Promise<EnterpriseTermVO> {
    const category = await this.ensureCategory(user.tenantId, input.categoryId)
    await this.assertTermAvailable(user.tenantId, input.categoryId, input.standardTerm)
    const row = await this.termsTable().create({
      tenantId: user.tenantId,
      categoryId: category.id,
      standardTerm: input.standardTerm,
      alsoCalled: input.alsoCalled ?? '',
      avoidThese: input.avoidThese ?? '',
      useCase: input.useCase ?? '',
      systemReference: input.systemReference ?? '',
      enable: input.enable,
      createdById: user.id,
      updatedById: user.id,
      updatedAt: prisma8Now(),
    })
    return this.toVO(row, category.name)
  }

  async updateTerm(
    user: AuthUser,
    id: string,
    input: SaveEnterpriseTermDto,
  ): Promise<EnterpriseTermVO> {
    const existing = await this.ensureTerm(user.tenantId, id)
    const category = await this.ensureCategory(user.tenantId, input.categoryId)
    await this.assertTermAvailable(user.tenantId, input.categoryId, input.standardTerm, id)
    const row = await this.termsTable().where({ id: existing.id, tenantId: user.tenantId }).update({
      categoryId: category.id,
      standardTerm: input.standardTerm,
      alsoCalled: input.alsoCalled ?? '',
      avoidThese: input.avoidThese ?? '',
      useCase: input.useCase ?? '',
      systemReference: input.systemReference ?? '',
      enable: input.enable,
      updatedById: user.id,
      updatedAt: prisma8Now(),
    })
    if (!row) throw new NotFoundException('术语不存在')
    return this.toVO(row, category.name)
  }

  async setStatus(tenantId: string, id: string, enable: boolean): Promise<EnterpriseTermVO> {
    const existing = await this.ensureTerm(tenantId, id)
    const row = await this.termsTable().where({ id: existing.id, tenantId }).update({
      enable,
      updatedAt: prisma8Now(),
    })
    if (!row) throw new NotFoundException('术语不存在')
    const category = await this.ensureCategory(tenantId, row.categoryId)
    return this.toVO(row, category.name)
  }

  async removeTerm(tenantId: string, id: string) {
    const existing = await this.ensureTerm(tenantId, id)
    await this.termsTable().where({ id: existing.id, tenantId }).delete()
    return { id }
  }

  async discoveries(tenantId: string): Promise<EnterpriseTermDiscoveryVO[]> {
    const rows = await this.discoveriesTable()
      .where({ tenantId, status: 'PENDING' })
      .orderBy([(row) => row.createdAt.desc(), (row) => row.id.asc()])
      .limit(200)
      .all()
    return rows.map((row) => this.discoveryToVO(row))
  }

  async ignoreDiscovery(tenantId: string, id: string): Promise<EnterpriseTermDiscoveryVO> {
    const existing = await this.ensureDiscovery(tenantId, id)
    if (existing.status !== 'PENDING') throw new BadRequestException('该术语发现已处理')
    const row = await this.discoveriesTable().where({ id: existing.id, tenantId }).update({
      status: 'IGNORED',
      updatedAt: prisma8Now(),
    })
    if (!row) throw new NotFoundException('术语发现不存在')
    return this.discoveryToVO(row)
  }

  async adoptDiscovery(
    user: AuthUser,
    id: string,
    input: SaveEnterpriseTermDto,
  ): Promise<EnterpriseTermVO> {
    const discovery = await this.ensureDiscovery(user.tenantId, id)
    if (discovery.status !== 'PENDING') throw new BadRequestException('该术语发现已处理')
    const category = await this.ensureCategory(user.tenantId, input.categoryId)
    await this.assertTermAvailable(user.tenantId, input.categoryId, input.standardTerm)

    return this.prisma8.client.transaction(async (tx) => {
      const term = await tx.orm.public.EnterpriseTerms.create({
        tenantId: user.tenantId,
        categoryId: category.id,
        standardTerm: input.standardTerm,
        alsoCalled: input.alsoCalled ?? '',
        avoidThese: input.avoidThese ?? '',
        useCase: input.useCase ?? '',
        systemReference: input.systemReference ?? '',
        enable: input.enable,
        createdById: user.id,
        updatedById: user.id,
        updatedAt: prisma8Now(),
      })
      const updated = await tx.orm.public.EnterpriseTermDiscoveries.where({
        id: discovery.id,
        tenantId: user.tenantId,
      }).update({
        status: 'ADOPTED',
        adoptedTermId: term.id,
        updatedAt: prisma8Now(),
      })
      if (!updated) throw new NotFoundException('术语发现不存在')
      return this.toVO(term, category.name)
    })
  }

  private async nextCategorySort(tenantId: string) {
    const row = await this.categoriesTable()
      .where({ tenantId })
      .select('sort')
      .orderBy((category) => category.sort.desc())
      .first()
    return (row?.sort ?? -1) + 1
  }

  private async ensureCategory(tenantId: string, id: string) {
    const row = await this.categoriesTable().where({ id, tenantId }).first()
    if (!row) throw new NotFoundException('术语分类不存在')
    return row
  }

  private async ensureTerm(tenantId: string, id: string) {
    const row = await this.termsTable().where({ id, tenantId }).first()
    if (!row) throw new NotFoundException('术语不存在')
    return row
  }

  private async ensureDiscovery(tenantId: string, id: string) {
    const row = await this.discoveriesTable().where({ id, tenantId }).first()
    if (!row) throw new NotFoundException('术语发现不存在')
    return row
  }

  private async assertCategoryNameAvailable(tenantId: string, name: string, excludeId?: string) {
    const duplicate = await this.categoriesTable().where({ tenantId, name }).select('id').first()
    if (duplicate && duplicate.id !== excludeId) throw new BadRequestException('术语分类名称已存在')
  }

  private async assertTermAvailable(
    tenantId: string,
    categoryId: string,
    standardTerm: string,
    excludeId?: string,
  ) {
    const duplicate = await this.termsTable()
      .where({ tenantId, categoryId, standardTerm })
      .select('id')
      .first()
    if (duplicate && duplicate.id !== excludeId)
      throw new BadRequestException('当前分类下已存在同名标准术语')
  }

  private categoriesTable() {
    return this.prisma8.client.orm.public.EnterpriseTermCategories
  }

  private termsTable() {
    return this.prisma8.client.orm.public.EnterpriseTerms
  }

  private discoveriesTable() {
    return this.prisma8.client.orm.public.EnterpriseTermDiscoveries
  }

  private async categoryNames(categoryIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(categoryIds)]
    if (!ids.length) return new Map()
    const rows = await this.categoriesTable()
      .where((category) => category.id.in(ids))
      .select('id', 'name')
      .all()
    return new Map(rows.map((row) => [row.id, row.name]))
  }

  private async termCounts(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.termsTable().where({ tenantId }).select('categoryId').all()
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.categoryId, (counts.get(row.categoryId) ?? 0) + 1)
    return counts
  }

  private async categoryTermCount(tenantId: string, categoryId: string): Promise<number> {
    const rows = await this.termsTable().where({ tenantId, categoryId }).select('id').all()
    return rows.length
  }

  private toVO(row: {
    id: string
    categoryId: string
    standardTerm: string
    alsoCalled: string
    avoidThese: string
    useCase: string
    systemReference: string
    enable: boolean
    createdAt: Prisma8Timestamp
    updatedAt: Prisma8Timestamp
  }, categoryName: string): EnterpriseTermVO {
    return {
      id: row.id,
      categoryId: row.categoryId,
      categoryName,
      standardTerm: row.standardTerm,
      alsoCalled: row.alsoCalled,
      avoidThese: row.avoidThese,
      useCase: row.useCase,
      systemReference: row.systemReference,
      enable: row.enable,
      createdAt: prisma8TimestampToISOString(row.createdAt),
      updatedAt: prisma8TimestampToISOString(row.updatedAt),
    }
  }

  private discoveryToVO(row: {
    id: string
    discovered: string
    source: string
    context: string
    status: string
    adoptedTermId: string | null
    createdAt: Prisma8Timestamp
  }): EnterpriseTermDiscoveryVO {
    return {
      id: row.id,
      freeTerm: row.discovered,
      source: row.source,
      reference: row.context,
      status: row.status as EnterpriseTermDiscoveryVO['status'],
      adoptedTermId: row.adoptedTermId,
      createdAt: prisma8TimestampToISOString(row.createdAt),
    }
  }
}
