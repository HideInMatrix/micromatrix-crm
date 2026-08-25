import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { FilterCondition, FilterOp } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type {
  CreateUserViewDto,
  EditUserViewPosDto,
  UpdateUserViewDto,
  UserViewConditionDto,
} from './dto/user-view.dto'
import type { UserViewResourceType } from './user-views.constants'

const POS_STEP = 4096n
type ConditionValueType = 'ARRAY' | 'STRING' | 'INT' | 'FLOAT' | 'BOOLEAN'

@Injectable()
export class UserViewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, resourceType: UserViewResourceType) {
    const views = await this.prisma.sysUserView.findMany({
      where: {
        organizationId: user.tenantId,
        userId: user.id,
        resourceType,
      },
      select: { id: true, name: true, fixed: true, enable: true },
      orderBy: [{ pos: 'desc' }, { createTime: 'desc' }],
    })
    return views
  }

  async detail(user: AuthUser, id: string, resourceType: UserViewResourceType) {
    const view = await this.getOwnedViewWithConditions(user, id, resourceType)
    return this.toDetail(view)
  }

  async resolveFilters(user: AuthUser, id: string, resourceType: UserViewResourceType) {
    const view = await this.getOwnedViewWithConditions(user, id, resourceType)
    if (!view.enable) throw new BadRequestException('该视图已停用')
    return {
      searchMode: view.searchMode === 'OR' ? ('OR' as const) : ('AND' as const),
      conditions: view.conditions.map<FilterCondition>((condition) => ({
        key: condition.name,
        op: condition.operator as FilterOp,
        value: this.decodeValue(condition.valueType, condition.value),
      })),
    }
  }

  async create(user: AuthUser, resourceType: UserViewResourceType, dto: CreateUserViewDto) {
    this.assertConditions(dto.conditions ?? [])
    const now = BigInt(Date.now())
    const name = dto.name.trim()
    try {
      const view = await this.prisma.$transaction(async (tx) => {
        const max = await tx.sysUserView.aggregate({
          where: { organizationId: user.tenantId, userId: user.id, resourceType },
          _max: { pos: true },
        })
        return tx.sysUserView.create({
          data: {
            userId: user.id,
            name,
            fixed: false,
            enable: true,
            resourceType,
            organizationId: user.tenantId,
            pos: (max._max.pos ?? 0n) + POS_STEP,
            searchMode: dto.searchMode ?? 'AND',
            createTime: now,
            updateTime: now,
            createUser: user.id,
            updateUser: user.id,
            conditions: { create: this.conditionCreates(user.id, now, dto.conditions ?? []) },
          },
          include: { conditions: { orderBy: { createTime: 'asc' } } },
        })
      })
      return this.toDetail(view)
    } catch (error) {
      this.rethrowUnique(error)
    }
  }

  async update(user: AuthUser, resourceType: UserViewResourceType, dto: UpdateUserViewDto) {
    this.assertConditions(dto.conditions ?? [])
    await this.getOwnedView(user, dto.id, resourceType)
    const now = BigInt(Date.now())
    try {
      const view = await this.prisma.$transaction(async (tx) => {
        await tx.sysUserViewCondition.deleteMany({ where: { sysUserViewId: dto.id } })
        return tx.sysUserView.update({
          where: { id: dto.id },
          data: {
            name: dto.name.trim(),
            searchMode: dto.searchMode ?? 'AND',
            updateTime: now,
            updateUser: user.id,
            conditions: { create: this.conditionCreates(user.id, now, dto.conditions ?? []) },
          },
          include: { conditions: { orderBy: { createTime: 'asc' } } },
        })
      })
      return this.toDetail(view)
    } catch (error) {
      this.rethrowUnique(error)
    }
  }

  async remove(user: AuthUser, id: string, resourceType: UserViewResourceType) {
    const view = await this.getOwnedView(user, id, resourceType)
    await this.prisma.sysUserView.delete({ where: { id } })
    return { id, name: view.name }
  }

  async toggleFixed(user: AuthUser, id: string, resourceType: UserViewResourceType) {
    const view = await this.getOwnedView(user, id, resourceType)
    await this.prisma.sysUserView.update({
      where: { id },
      data: { fixed: !view.fixed, updateTime: BigInt(Date.now()), updateUser: user.id },
    })
  }

  async toggleEnabled(user: AuthUser, id: string, resourceType: UserViewResourceType) {
    const view = await this.getOwnedView(user, id, resourceType)
    await this.prisma.sysUserView.update({
      where: { id },
      data: { enable: !view.enable, updateTime: BigInt(Date.now()), updateUser: user.id },
    })
  }

  async editPos(user: AuthUser, resourceType: UserViewResourceType, dto: EditUserViewPosDto) {
    if (dto.orgId !== user.tenantId) throw new BadRequestException('组织与当前登录上下文不匹配')
    if (dto.moveId === dto.targetId) throw new BadRequestException('移动视图与目标视图不能相同')

    const where = { organizationId: user.tenantId, userId: user.id, resourceType }
    const views = await this.prisma.sysUserView.findMany({
      where,
      select: { id: true },
      orderBy: [{ pos: 'desc' }, { createTime: 'desc' }],
    })
    const moveIndex = views.findIndex((view) => view.id === dto.moveId)
    const targetIndex = views.findIndex((view) => view.id === dto.targetId)
    if (moveIndex < 0 || targetIndex < 0) throw new NotFoundException('视图不存在')

    const ordered = views.map((view) => view.id)
    ordered.splice(moveIndex, 1)
    const nextTargetIndex = ordered.indexOf(dto.targetId)
    ordered.splice(nextTargetIndex + (dto.moveMode === 'AFTER' ? 1 : 0), 0, dto.moveId)
    const now = BigInt(Date.now())
    await this.prisma.$transaction(
      ordered.map((id, index) =>
        this.prisma.sysUserView.update({
          where: { id },
          data: {
            pos: BigInt(ordered.length - index) * POS_STEP,
            updateTime: now,
            updateUser: user.id,
          },
        }),
      ),
    )
  }

  private async getOwnedView(user: AuthUser, id: string, resourceType: UserViewResourceType) {
    const view = await this.prisma.sysUserView.findFirst({
      where: { id, organizationId: user.tenantId, userId: user.id, resourceType },
    })
    if (!view) throw new NotFoundException('视图不存在')
    return view
  }

  private async getOwnedViewWithConditions(
    user: AuthUser,
    id: string,
    resourceType: UserViewResourceType,
  ) {
    const view = await this.prisma.sysUserView.findFirst({
      where: { id, organizationId: user.tenantId, userId: user.id, resourceType },
      include: { conditions: { orderBy: { createTime: 'asc' } } },
    })
    if (!view) throw new NotFoundException('视图不存在')
    return view
  }

  private conditionCreates(userId: string, now: bigint, conditions: UserViewConditionDto[]) {
    return conditions.map((condition) => {
      const serialized = this.encodeValue(condition.value)
      return {
        name: condition.name,
        value: serialized.value,
        valueType: serialized.valueType,
        type: condition.type,
        multipleValue: condition.multipleValue ?? false,
        operator: condition.operator,
        childrenValue: condition.containChildIds?.length
          ? JSON.stringify(condition.containChildIds)
          : null,
        createTime: now,
        updateTime: now,
        createUser: userId,
        updateUser: userId,
      }
    })
  }

  private encodeValue(value: unknown): { value: string | null; valueType: ConditionValueType } {
    if (Array.isArray(value)) return { value: JSON.stringify(value), valueType: 'ARRAY' }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new BadRequestException('视图条件值必须是有限数字')
      return { value: String(value), valueType: Number.isInteger(value) ? 'INT' : 'FLOAT' }
    }
    if (typeof value === 'boolean') return { value: String(value), valueType: 'BOOLEAN' }
    if (value === null || value === undefined) return { value: null, valueType: 'STRING' }
    if (typeof value === 'string') return { value, valueType: 'STRING' }
    throw new BadRequestException('视图条件值只支持标量或标量数组')
  }

  private decodeValue(valueType: string | null, value: string | null): unknown {
    if (value === null || value === '') return null
    switch (valueType) {
      case 'ARRAY': {
        const parsed: unknown = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
      }
      case 'INT':
      case 'FLOAT':
        return Number(value)
      case 'BOOLEAN':
        return value === 'true'
      default:
        return value
    }
  }

  private assertConditions(conditions: UserViewConditionDto[]) {
    for (const condition of conditions) {
      if (Array.isArray(condition.value)) {
        const invalid = condition.value.some(
          (value) => !['string', 'number', 'boolean'].includes(typeof value) && value !== null,
        )
        if (invalid) throw new BadRequestException('视图数组条件只能包含标量值')
      }
    }
  }

  private toDetail<
    T extends {
      id: string
      userId: string
      name: string
      fixed: boolean
      enable: boolean
      resourceType: string
      organizationId: string
      pos: bigint
      searchMode: string
      conditions: Array<{
        name: string
        value: string | null
        valueType: string | null
        type: string | null
        multipleValue: boolean
        operator: string | null
        childrenValue: string | null
      }>
    },
  >(view: T) {
    return {
      id: view.id,
      userId: view.userId,
      name: view.name,
      fixed: view.fixed,
      enable: view.enable,
      resourceType: view.resourceType,
      organizationId: view.organizationId,
      pos: Number(view.pos),
      searchMode: view.searchMode === 'OR' ? ('OR' as const) : ('AND' as const),
      conditions: view.conditions.map((condition) => ({
        name: condition.name,
        value: this.decodeValue(condition.valueType, condition.value),
        valueType: condition.valueType,
        type: condition.type,
        multipleValue: condition.multipleValue,
        operator: condition.operator,
        containChildIds: this.decodeChildren(condition.childrenValue),
      })),
      optionMap: {},
    }
  }

  private decodeChildren(value: string | null): string[] {
    if (!value) return []
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  }

  private rethrowUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new BadRequestException('同一资源下不能存在同名视图')
    }
    throw error
  }
}
