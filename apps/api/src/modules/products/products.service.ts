import { Injectable, NotFoundException } from '@nestjs/common'
import { FieldVO, PaginatedResult, ProductVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { buildFilterClauses, parseFilters } from '../../common/filter-builder'
import { Prisma, Product } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { MetadataService } from '../metadata/metadata.service'
import { CreateProductDto, QueryProductsDto, UpdateProductDto } from './dto/product.dto'

const MODULE = 'product'

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metadata: MetadataService,
  ) {}

  /** 产品目录租户内共享，不做数据范围隔离 */
  async findAll(user: AuthUser, query: QueryProductsDto): Promise<PaginatedResult<ProductVO>> {
    const { page = 1, pageSize = 10, keyword, status } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldsMap = new Map(fields.map((f) => [f.key, f]))
    const filterClauses = buildFilterClauses(fieldsMap, parseFilters(query.filters))

    const where: Prisma.ProductWhereInput = {
      tenantId: user.tenantId,
      AND: filterClauses as Prisma.ProductWhereInput[],
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { code: { contains: keyword, mode: 'insensitive' } },
              { category: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ])
    return { items: items.map((p) => this.toVO(p, fields)), total, page, pageSize }
  }

  async create(user: AuthUser, dto: CreateProductDto): Promise<ProductVO> {
    const { customData, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    const product = await this.prisma.product.create({
      data: {
        ...rest,
        tenantId: user.tenantId,
        ownerId: user.id,
        deptId: user.deptId,
        customData: validated as Prisma.InputJsonValue,
      },
    })
    return this.toVO(product, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async update(user: AuthUser, id: string, dto: UpdateProductDto): Promise<ProductVO> {
    const existing = await this.ensureExists(user, id)
    const { customData, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: false,
    })
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...rest,
        customData: {
          ...((existing.customData as Record<string, unknown> | null) ?? {}),
          ...validated,
        } as Prisma.InputJsonValue,
      },
    })
    return this.toVO(product, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async toggleStatus(user: AuthUser, id: string) {
    const product = await this.ensureExists(user, id)
    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: product.status === 'ON' ? 'OFF' : 'ON' },
    })
    return { id, name: updated.name, status: updated.status }
  }

  async remove(user: AuthUser, id: string) {
    const product = await this.ensureExists(user, id)
    await this.prisma.product.delete({ where: { id } })
    return { id, name: product.name }
  }

  private async ensureExists(user: AuthUser, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!product) throw new NotFoundException('产品不存在')
    return product
  }

  private toVO(product: Product, fields: FieldVO[]): ProductVO {
    const customData = (product.customData as Record<string, unknown> | null) ?? {}
    const record: Record<string, unknown> = {
      name: product.name,
      price: Number(product.price),
      cost: product.cost ? Number(product.cost) : null,
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    return {
      id: product.id,
      name: product.name,
      code: product.code,
      category: product.category,
      unit: product.unit,
      price: Number(product.price),
      cost: product.cost ? Number(product.cost) : null,
      status: product.status,
      description: product.description,
      ownerId: product.ownerId,
      customData: { ...customData, ...formulas },
      createdAt: product.createdAt.toISOString(),
    }
  }
}
