import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { FilterCondition, FilterOp } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  CreateSavedViewDto,
  ReorderSavedViewsDto,
  UpdateSavedViewDto,
} from './dto/saved-view.dto'

@Injectable()
export class SavedViewsService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser, module: string) {
    this.assertModule(module)
    return this.prisma.savedView.findMany({
      where: { tenantId: user.tenantId, userId: user.id, module },
      include: { conditions: { orderBy: { sort: 'asc' } } },
      // Cordys sys_user_view 按 pos desc 返回；fixed 只决定是否显示为顶部标签，不改变视图顺序。
      orderBy: [{ sort: 'desc' }, { createdAt: 'desc' }],
    })
  }

  async detail(user: AuthUser, id: string) {
    return this.getOwnedViewWithConditions(user, id)
  }

  async resolveFilters(user: AuthUser, id: string, module: string) {
    const view = await this.getOwnedViewWithConditions(user, id)
    if (view.module !== module) throw new BadRequestException('视图与当前业务模块不匹配')
    if (!view.enabled) throw new BadRequestException('该视图已停用')
    return {
      searchMode: view.searchMode === 'OR' ? ('OR' as const) : ('AND' as const),
      conditions: view.conditions.map<FilterCondition>((condition) => ({
        key: condition.field,
        op: condition.operator as FilterOp,
        value: condition.value,
      })),
    }
  }

  async create(user: AuthUser, module: string, dto: CreateSavedViewDto) {
    this.assertModule(module)
    const maxSort = await this.prisma.savedView.aggregate({
      where: { tenantId: user.tenantId, userId: user.id, module },
      _max: { sort: true },
    })
    try {
      return await this.prisma.savedView.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          module,
          name: dto.name,
          searchMode: dto.searchMode ?? 'AND',
          sort: (maxSort._max.sort ?? -1) + 1,
          conditions: {
            create: this.conditionCreates(user.tenantId, dto.conditions ?? []),
          },
        },
        include: { conditions: { orderBy: { sort: 'asc' } } },
      })
    } catch (error) {
      if (this.isUniqueError(error)) throw new BadRequestException('同一模块下不能存在同名视图')
      throw error
    }
  }

  async update(user: AuthUser, id: string, dto: UpdateSavedViewDto) {
    await this.getOwnedView(user, id)
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.conditions !== undefined) {
          await tx.savedViewCondition.deleteMany({ where: { viewId: id, tenantId: user.tenantId } })
        }
        return tx.savedView.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.searchMode !== undefined ? { searchMode: dto.searchMode } : {}),
            ...(dto.conditions !== undefined
              ? {
                  conditions: {
                    create: this.conditionCreates(user.tenantId, dto.conditions),
                  },
                }
              : {}),
          },
          include: { conditions: { orderBy: { sort: 'asc' } } },
        })
      })
    } catch (error) {
      if (this.isUniqueError(error)) throw new BadRequestException('同一模块下不能存在同名视图')
      throw error
    }
  }

  async remove(user: AuthUser, id: string) {
    const view = await this.getOwnedView(user, id)
    await this.prisma.savedView.delete({ where: { id } })
    return { id, name: view.name }
  }

  async toggleFixed(user: AuthUser, id: string) {
    const view = await this.getOwnedView(user, id)
    return this.prisma.savedView.update({ where: { id }, data: { fixed: !view.fixed } })
  }

  async toggleEnabled(user: AuthUser, id: string) {
    const view = await this.getOwnedView(user, id)
    return this.prisma.savedView.update({ where: { id }, data: { enabled: !view.enabled } })
  }

  async reorder(user: AuthUser, module: string, dto: ReorderSavedViewsDto) {
    this.assertModule(module)
    const owned = await this.prisma.savedView.findMany({
      where: { tenantId: user.tenantId, userId: user.id, module },
      select: { id: true },
    })
    const ownedIds = new Set(owned.map((item) => item.id))
    if (dto.ids.some((id) => !ownedIds.has(id))) throw new BadRequestException('包含无权操作的视图')
    if (dto.ids.length !== owned.length) throw new BadRequestException('排序必须包含当前模块的全部视图')
    const maxSort = dto.ids.length - 1
    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.savedView.update({ where: { id }, data: { sort: maxSort - index } }),
      ),
    )
    return this.list(user, module)
  }

  private conditionCreates(tenantId: string, conditions: NonNullable<CreateSavedViewDto['conditions']>) {
    return conditions.map((condition, sort) => ({
      tenantId,
      field: condition.field,
      operator: condition.operator,
      value:
        condition.value === undefined
          ? undefined
          : condition.value === null
            ? Prisma.JsonNull
            : (condition.value as Prisma.InputJsonValue),
      fieldType: condition.fieldType,
      multipleValue: condition.multipleValue ?? false,
      containChildIds: condition.containChildIds ?? [],
      sort,
    }))
  }

  private async getOwnedView(user: AuthUser, id: string) {
    const view = await this.prisma.savedView.findFirst({
      where: { id, tenantId: user.tenantId, userId: user.id },
    })
    if (!view) throw new NotFoundException('视图不存在')
    return view
  }

  private async getOwnedViewWithConditions(user: AuthUser, id: string) {
    const view = await this.prisma.savedView.findFirst({
      where: { id, tenantId: user.tenantId, userId: user.id },
      include: { conditions: { orderBy: { sort: 'asc' } } },
    })
    if (!view) throw new NotFoundException('视图不存在')
    return view
  }

  private assertModule(module: string) {
    if (!/^[a-z][a-z0-9_-]{1,63}$/i.test(module)) throw new BadRequestException('非法视图模块')
  }

  private isUniqueError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }
}
