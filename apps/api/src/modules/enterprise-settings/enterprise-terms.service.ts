import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  EnterpriseTermCategoryVO,
  EnterpriseTermDiscoveryVO,
  EnterpriseTermVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import type { SaveEnterpriseTermCategoryDto, SaveEnterpriseTermDto } from './dto/term-setting.dto'

@Injectable()
export class EnterpriseTermsService {
  constructor(private readonly prisma: PrismaService) {}

  async categories(tenantId: string): Promise<EnterpriseTermCategoryVO[]> {
    const rows = await this.prisma.enterpriseTermCategory.findMany({
      where: { tenantId },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { terms: true } } },
    })
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sort: row.sort,
      termCount: row._count.terms,
    }))
  }

  async createCategory(tenantId: string, input: SaveEnterpriseTermCategoryDto) {
    await this.assertCategoryNameAvailable(tenantId, input.name)
    const sort = input.sort ?? (await this.nextCategorySort(tenantId))
    const row = await this.prisma.enterpriseTermCategory.create({
      data: { tenantId, name: input.name, sort },
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
    const row = await this.prisma.enterpriseTermCategory.update({
      where: { id: existing.id },
      data: { name: input.name, ...(input.sort !== undefined && { sort: input.sort }) },
      include: { _count: { select: { terms: true } } },
    })
    return {
      id: row.id,
      name: row.name,
      sort: row.sort,
      termCount: row._count.terms,
    } satisfies EnterpriseTermCategoryVO
  }

  async removeCategory(tenantId: string, id: string) {
    const existing = await this.ensureCategory(tenantId, id)
    await this.prisma.enterpriseTermCategory.delete({ where: { id: existing.id } })
    return { id }
  }

  async terms(
    tenantId: string,
    categoryId?: string,
    keyword?: string,
  ): Promise<EnterpriseTermVO[]> {
    if (categoryId) await this.ensureCategory(tenantId, categoryId)
    const normalized = keyword?.trim()
    const rows = await this.prisma.enterpriseTerm.findMany({
      where: {
        tenantId,
        ...(categoryId && { categoryId }),
        ...(normalized && {
          OR: [
            { standardTerm: { contains: normalized, mode: 'insensitive' } },
            { alsoCalled: { contains: normalized, mode: 'insensitive' } },
            { avoidThese: { contains: normalized, mode: 'insensitive' } },
          ],
        }),
      },
      include: { category: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    })
    return rows.map((row) => this.toVO(row))
  }

  async createTerm(user: AuthUser, input: SaveEnterpriseTermDto): Promise<EnterpriseTermVO> {
    const category = await this.ensureCategory(user.tenantId, input.categoryId)
    await this.assertTermAvailable(user.tenantId, input.categoryId, input.standardTerm)
    const row = await this.prisma.enterpriseTerm.create({
      data: {
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
      },
      include: { category: { select: { name: true } } },
    })
    return this.toVO(row)
  }

  async updateTerm(
    user: AuthUser,
    id: string,
    input: SaveEnterpriseTermDto,
  ): Promise<EnterpriseTermVO> {
    const existing = await this.ensureTerm(user.tenantId, id)
    const category = await this.ensureCategory(user.tenantId, input.categoryId)
    await this.assertTermAvailable(user.tenantId, input.categoryId, input.standardTerm, id)
    const row = await this.prisma.enterpriseTerm.update({
      where: { id: existing.id },
      data: {
        categoryId: category.id,
        standardTerm: input.standardTerm,
        alsoCalled: input.alsoCalled ?? '',
        avoidThese: input.avoidThese ?? '',
        useCase: input.useCase ?? '',
        systemReference: input.systemReference ?? '',
        enable: input.enable,
        updatedById: user.id,
      },
      include: { category: { select: { name: true } } },
    })
    return this.toVO(row)
  }

  async setStatus(tenantId: string, id: string, enable: boolean): Promise<EnterpriseTermVO> {
    const existing = await this.ensureTerm(tenantId, id)
    const row = await this.prisma.enterpriseTerm.update({
      where: { id: existing.id },
      data: { enable },
      include: { category: { select: { name: true } } },
    })
    return this.toVO(row)
  }

  async removeTerm(tenantId: string, id: string) {
    const existing = await this.ensureTerm(tenantId, id)
    await this.prisma.enterpriseTerm.delete({ where: { id: existing.id } })
    return { id }
  }

  async discoveries(tenantId: string): Promise<EnterpriseTermDiscoveryVO[]> {
    const rows = await this.prisma.enterpriseTermDiscovery.findMany({
      where: { tenantId, status: 'PENDING' },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 200,
    })
    return rows.map((row) => this.discoveryToVO(row))
  }

  async ignoreDiscovery(tenantId: string, id: string): Promise<EnterpriseTermDiscoveryVO> {
    const existing = await this.ensureDiscovery(tenantId, id)
    if (existing.status !== 'PENDING') throw new BadRequestException('该术语发现已处理')
    const row = await this.prisma.enterpriseTermDiscovery.update({
      where: { id: existing.id },
      data: { status: 'IGNORED' },
    })
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

    return this.prisma.$transaction(async (tx) => {
      const term = await tx.enterpriseTerm.create({
        data: {
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
        },
        include: { category: { select: { name: true } } },
      })
      await tx.enterpriseTermDiscovery.update({
        where: { id: discovery.id },
        data: { status: 'ADOPTED', adoptedTermId: term.id },
      })
      return this.toVO(term)
    })
  }

  private async nextCategorySort(tenantId: string) {
    const max = await this.prisma.enterpriseTermCategory.aggregate({
      where: { tenantId },
      _max: { sort: true },
    })
    return (max._max.sort ?? -1) + 1
  }

  private ensureCategory(tenantId: string, id: string) {
    return this.prisma.enterpriseTermCategory.findFirst({ where: { id, tenantId } }).then((row) => {
      if (!row) throw new NotFoundException('术语分类不存在')
      return row
    })
  }

  private ensureTerm(tenantId: string, id: string) {
    return this.prisma.enterpriseTerm.findFirst({ where: { id, tenantId } }).then((row) => {
      if (!row) throw new NotFoundException('术语不存在')
      return row
    })
  }

  private ensureDiscovery(tenantId: string, id: string) {
    return this.prisma.enterpriseTermDiscovery
      .findFirst({ where: { id, tenantId } })
      .then((row) => {
        if (!row) throw new NotFoundException('术语发现不存在')
        return row
      })
  }

  private async assertCategoryNameAvailable(tenantId: string, name: string, excludeId?: string) {
    const duplicate = await this.prisma.enterpriseTermCategory.findFirst({
      where: { tenantId, name, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true },
    })
    if (duplicate) throw new BadRequestException('术语分类名称已存在')
  }

  private async assertTermAvailable(
    tenantId: string,
    categoryId: string,
    standardTerm: string,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.enterpriseTerm.findFirst({
      where: { tenantId, categoryId, standardTerm, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true },
    })
    if (duplicate) throw new BadRequestException('当前分类下已存在同名标准术语')
  }

  private toVO(row: {
    id: string
    categoryId: string
    category: { name: string }
    standardTerm: string
    alsoCalled: string
    avoidThese: string
    useCase: string
    systemReference: string
    enable: boolean
    createdAt: Date
    updatedAt: Date
  }): EnterpriseTermVO {
    return {
      id: row.id,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      standardTerm: row.standardTerm,
      alsoCalled: row.alsoCalled,
      avoidThese: row.avoidThese,
      useCase: row.useCase,
      systemReference: row.systemReference,
      enable: row.enable,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private discoveryToVO(row: {
    id: string
    discovered: string
    source: string
    context: string
    status: string
    adoptedTermId: string | null
    createdAt: Date
  }): EnterpriseTermDiscoveryVO {
    return {
      id: row.id,
      freeTerm: row.discovered,
      source: row.source,
      reference: row.context,
      status: row.status as EnterpriseTermDiscoveryVO['status'],
      adoptedTermId: row.adoptedTermId,
      createdAt: row.createdAt.toISOString(),
    }
  }
}
