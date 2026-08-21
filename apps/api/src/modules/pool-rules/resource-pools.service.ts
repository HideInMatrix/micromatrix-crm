import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { FilterCondition } from '@micromatrix/shared'
import { toAuthUser, type AuthUser } from '../../common/auth-user'
import { buildFilterClauses } from '../../common/filter-builder'
import { ScopeResolverService } from '../../common/services/scope-resolver.service'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { MetadataService } from '../metadata/metadata.service'
import {
  CreateResourceCapacityDto,
  CreateResourcePoolDto,
  type PoolModule,
  UpdateResourceCapacityDto,
  UpdateResourcePoolDto,
} from './dto/resource-pool.dto'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'

const DAY_MS = 24 * 60 * 60 * 1000

@Injectable()
export class ResourcePoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeResolver: ScopeResolverService,
    private readonly metadata: MetadataService,
    private readonly recycleEvaluator: ResourceRecycleConditionEvaluator,
  ) {}

  async list(user: AuthUser, module: PoolModule) {
    this.assertModule(module)
    return this.prisma.resourcePool.findMany({
      where: { tenantId: user.tenantId, module },
      include: { pickRule: true, recycleRule: true },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
    })
  }

  async options(user: AuthUser, module: PoolModule) {
    this.assertModule(module)
    let pools = await this.prisma.resourcePool.findMany({
      where: { tenantId: user.tenantId, module, enabled: true },
      include: { pickRule: true, recycleRule: true },
      orderBy: { createdAt: 'asc' },
    })
    // 兼容旧单池模式：首次访问时自动补一个全员可见默认池。
    if (pools.length === 0) {
      pools = [await this.ensureTenantDefaultPool(user.tenantId, module, user.id)]
    }
    const result = []
    for (const pool of pools) {
      if (
        user.permissions.includes('*') ||
        (await this.scopeResolver.matchesUser(user, [...pool.scopeIds, ...pool.managerIds]))
      ) {
        result.push(pool)
      }
    }
    return result
  }

  async isPoolManager(user: AuthUser, module: PoolModule, poolId: string | null) {
    this.assertModule(module)
    if (user.permissions.includes('*')) return true
    if (!poolId) return false
    const pool = await this.prisma.resourcePool.findFirst({
      where: { id: poolId, tenantId: user.tenantId, module, enabled: true },
      select: { managerIds: true },
    })
    if (!pool) return false
    return this.scopeResolver.matchesUser(user, pool.managerIds)
  }

  /** Cordys checkPoolMember：功能权限之外，再校验 Scope 成员 / 池管理员。 */
  async assertPoolMember(user: AuthUser, module: PoolModule, poolId: string) {
    this.assertModule(module)
    const pool = await this.prisma.resourcePool.findFirst({
      where: { id: poolId, tenantId: user.tenantId, module },
      include: { pickRule: true, recycleRule: true },
    })
    if (!pool) throw new NotFoundException('池不存在')
    if (
      !user.permissions.includes('*') &&
      !(await this.scopeResolver.matchesUser(user, [...pool.scopeIds, ...pool.managerIds]))
    ) {
      throw new ForbiddenException('你不是该池成员或管理员')
    }
    return pool
  }

  async create(user: AuthUser, dto: CreateResourcePoolDto) {
    this.validateRulePairs(dto)
    if (dto.autoRecycle && !this.recycleEvaluator.hasValidConditions(dto.recycleRule?.conditions)) {
      throw new BadRequestException('启用自动回收时必须配置至少一条有效回收条件')
    }
    const hiddenFieldIds = await this.normalizeHiddenFieldIds(
      user.tenantId,
      dto.module,
      dto.hiddenFieldIds ?? [],
    )
    return this.prisma.resourcePool.create({
      data: {
        tenantId: user.tenantId,
        module: dto.module,
        name: dto.name,
        scopeIds: dto.scopeIds ?? [],
        managerIds: dto.managerIds ?? [],
        enabled: dto.enabled ?? true,
        autoRecycle: dto.autoRecycle ?? false,
        hiddenFieldIds,
        createdById: user.id,
        updatedById: user.id,
        pickRule: {
          create: {
            tenantId: user.tenantId,
            limitDailyPick: dto.pickRule?.limitDailyPick ?? false,
            dailyPickLimit: dto.pickRule?.dailyPickLimit,
            limitPreviousOwner: dto.pickRule?.limitPreviousOwner ?? false,
            previousOwnerCooldownDays: dto.pickRule?.previousOwnerCooldownDays,
            limitNewData: dto.pickRule?.limitNewData ?? false,
            newDataCooldownDays: dto.pickRule?.newDataCooldownDays,
          },
        },
        recycleRule: {
          create: {
            tenantId: user.tenantId,
            operator: dto.recycleRule?.operator ?? 'AND',
            conditions: (dto.recycleRule?.conditions ?? []) as unknown as Prisma.InputJsonValue,
          },
        },
      },
      include: { pickRule: true, recycleRule: true },
    })
  }

  async update(user: AuthUser, id: string, dto: UpdateResourcePoolDto) {
    const current = await this.getPool(user.tenantId, id)
    if (dto.module && dto.module !== current.module) {
      throw new BadRequestException('池创建后不能修改业务模块')
    }
    this.validateRulePairs(dto)
    const effectiveAutoRecycle = dto.autoRecycle ?? current.autoRecycle
    const effectiveConditions = dto.recycleRule?.conditions ?? current.recycleRule?.conditions
    if (effectiveAutoRecycle && !this.recycleEvaluator.hasValidConditions(effectiveConditions)) {
      throw new BadRequestException('启用自动回收时必须配置至少一条有效回收条件')
    }
    const hiddenFieldIds =
      dto.hiddenFieldIds !== undefined
        ? await this.normalizeHiddenFieldIds(user.tenantId, current.module as PoolModule, dto.hiddenFieldIds)
        : undefined
    return this.prisma.resourcePool.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.scopeIds !== undefined ? { scopeIds: dto.scopeIds } : {}),
        ...(dto.managerIds !== undefined ? { managerIds: dto.managerIds } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.autoRecycle !== undefined ? { autoRecycle: dto.autoRecycle } : {}),
        ...(hiddenFieldIds !== undefined ? { hiddenFieldIds } : {}),
        updatedById: user.id,
        ...(dto.pickRule
          ? {
              pickRule: {
                upsert: {
                  create: {
                    tenantId: user.tenantId,
                    limitDailyPick: dto.pickRule.limitDailyPick ?? false,
                    dailyPickLimit: dto.pickRule.dailyPickLimit,
                    limitPreviousOwner: dto.pickRule.limitPreviousOwner ?? false,
                    previousOwnerCooldownDays: dto.pickRule.previousOwnerCooldownDays,
                    limitNewData: dto.pickRule.limitNewData ?? false,
                    newDataCooldownDays: dto.pickRule.newDataCooldownDays,
                  },
                  update: {
                    ...(dto.pickRule.limitDailyPick !== undefined
                      ? { limitDailyPick: dto.pickRule.limitDailyPick }
                      : {}),
                    ...(dto.pickRule.dailyPickLimit !== undefined
                      ? { dailyPickLimit: dto.pickRule.dailyPickLimit }
                      : {}),
                    ...(dto.pickRule.limitPreviousOwner !== undefined
                      ? { limitPreviousOwner: dto.pickRule.limitPreviousOwner }
                      : {}),
                    ...(dto.pickRule.previousOwnerCooldownDays !== undefined
                      ? { previousOwnerCooldownDays: dto.pickRule.previousOwnerCooldownDays }
                      : {}),
                    ...(dto.pickRule.limitNewData !== undefined
                      ? { limitNewData: dto.pickRule.limitNewData }
                      : {}),
                    ...(dto.pickRule.newDataCooldownDays !== undefined
                      ? { newDataCooldownDays: dto.pickRule.newDataCooldownDays }
                      : {}),
                  },
                },
              },
            }
          : {}),
        ...(dto.recycleRule
          ? {
              recycleRule: {
                upsert: {
                  create: {
                    tenantId: user.tenantId,
                    operator: dto.recycleRule.operator ?? 'AND',
                    conditions: (dto.recycleRule.conditions ?? []) as unknown as Prisma.InputJsonValue,
                  },
                  update: {
                    ...(dto.recycleRule.operator !== undefined
                      ? { operator: dto.recycleRule.operator }
                      : {}),
                    ...(dto.recycleRule.conditions !== undefined
                      ? { conditions: dto.recycleRule.conditions as unknown as Prisma.InputJsonValue }
                      : {}),
                  },
                },
              },
            }
          : {}),
      },
      include: { pickRule: true, recycleRule: true },
    })
  }

  async toggle(user: AuthUser, id: string) {
    const pool = await this.getPool(user.tenantId, id)
    return this.prisma.resourcePool.update({
      where: { id },
      data: { enabled: !pool.enabled, updatedById: user.id },
    })
  }

  async remove(user: AuthUser, id: string) {
    const pool = await this.getPool(user.tenantId, id)
    const occupied =
      pool.module === 'lead'
        ? await this.prisma.lead.count({ where: { tenantId: user.tenantId, inPool: true, poolId: id } })
        : await this.prisma.customer.count({ where: { tenantId: user.tenantId, inSea: true, poolId: id } })
    if (occupied > 0) throw new BadRequestException('池中仍有数据，不能删除')
    await this.prisma.resourcePool.delete({ where: { id } })
    return { id, name: pool.name }
  }

  async ensureDefaultPool(user: AuthUser, module: PoolModule) {
    const options = await this.options(user, module)
    if (options.length > 0) return options[0]
    const existingCount = await this.prisma.resourcePool.count({
      where: { tenantId: user.tenantId, module },
    })
    if (existingCount > 0) throw new BadRequestException('当前用户没有匹配的可用池，请联系管理员配置成员范围')
    return this.ensureTenantDefaultPool(user.tenantId, module, user.id)
  }

  async ensureTenantDefaultPool(tenantId: string, module: PoolModule, operatorId?: string) {
    const name = module === 'lead' ? '默认线索池' : '默认公海'
    return this.prisma.resourcePool.upsert({
      where: { tenantId_module_name: { tenantId, module, name } },
      update: { enabled: true },
      create: {
        tenantId,
        module,
        name,
        scopeIds: ['*'],
        managerIds: [],
        enabled: true,
        createdById: operatorId,
        updatedById: operatorId,
        pickRule: { create: { tenantId } },
        recycleRule: {
          create: { tenantId, operator: 'AND', conditions: [] },
        },
      },
      include: { pickRule: true, recycleRule: true },
    })
  }

  async resolveTargetPool(user: AuthUser, module: PoolModule, poolId?: string) {
    if (!poolId) return this.ensureDefaultPool(user, module)
    const pool = await this.prisma.resourcePool.findFirst({
      where: { id: poolId, tenantId: user.tenantId, module, enabled: true },
      include: { pickRule: true, recycleRule: true },
    })
    if (!pool) throw new NotFoundException('目标池不存在或已禁用')
    if (
      !user.permissions.includes('*') &&
      !(await this.scopeResolver.matchesUser(user, [...pool.scopeIds, ...pool.managerIds]))
    ) {
      throw new BadRequestException('你无权使用该池')
    }
    return pool
  }

  async resolveMoveTargetPool(
    tenantId: string,
    module: PoolModule,
    ownerId: string | null,
    poolId?: string,
  ) {
    if (!poolId) {
      const pool = await this.resolveRecyclePool(tenantId, module, ownerId)
      if (!pool) throw new BadRequestException('未找到与原负责人范围匹配的可用池')
      return pool
    }
    const pool = await this.prisma.resourcePool.findFirst({
      where: { id: poolId, tenantId, module, enabled: true },
      include: { pickRule: true, recycleRule: true },
    })
    if (!pool) throw new NotFoundException('目标池不存在或已禁用')
    return pool
  }

  async assertCanClaim(
    user: AuthUser,
    module: PoolModule,
    poolId: string | null,
    resourceId: string,
    poolEnteredAt: Date | null,
  ) {
    const pool = poolId
      ? await this.prisma.resourcePool.findFirst({
          where: { id: poolId, tenantId: user.tenantId, module, enabled: true },
          include: { pickRule: true, recycleRule: true },
        })
      : await this.ensureDefaultPool(user, module)
    if (!pool) throw new BadRequestException('数据所在池不存在或已禁用')
    if (
      !user.permissions.includes('*') &&
      !(await this.scopeResolver.matchesUser(user, [...pool.scopeIds, ...pool.managerIds]))
    ) {
      throw new BadRequestException('你不是该池成员或管理员')
    }

    const rule = pool.pickRule
    const poolAdmin =
      user.permissions.includes('*') || (await this.scopeResolver.matchesUser(user, pool.managerIds))

    // 与 Cordys 对齐：池管理员仍受库容限制，但不受领取数量/新数据/前负责人限制。
    if (!poolAdmin) {
      if (rule?.limitNewData && rule.newDataCooldownDays && poolEnteredAt) {
        const releaseAt = new Date(poolEnteredAt.getTime() + rule.newDataCooldownDays * DAY_MS)
        if (releaseAt > new Date()) {
          throw new BadRequestException(`该数据需到 ${releaseAt.toLocaleString()} 后才能领取`)
        }
      }

      if (rule?.limitPreviousOwner && rule.previousOwnerCooldownDays) {
        const last = await this.prisma.resourceOwnerHistory.findFirst({
          where: { tenantId: user.tenantId, module, resourceId },
          orderBy: { endedAt: 'desc' },
        })
        if (last?.ownerId === user.id) {
          const releaseAt = new Date(last.endedAt.getTime() + rule.previousOwnerCooldownDays * DAY_MS)
          if (releaseAt > new Date()) {
            throw new BadRequestException(`前负责人需到 ${releaseAt.toLocaleString()} 后才能再次领取`)
          }
        }
      }

      if (rule?.limitDailyPick && rule.dailyPickLimit) {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        const picked =
          module === 'lead'
            ? await this.prisma.lead.count({
                where: {
                  tenantId: user.tenantId,
                  ownerId: user.id,
                  inPool: false,
                  collectedAt: { gte: start },
                },
              })
            : await this.prisma.customer.count({
                where: {
                  tenantId: user.tenantId,
                  ownerId: user.id,
                  inSea: false,
                  collectedAt: { gte: start },
                },
              })
        if (picked >= rule.dailyPickLimit) throw new BadRequestException('今日领取数量已达上限')
      }
    }

    await this.assertCapacity(user, module, 1)
    return pool
  }

  /**
   * 自动回收时按原负责人所属范围选择目标池。
   * 已配置自定义池却无范围匹配时返回 null，禁止静默创建一个全员默认池破坏隔离。
   */
  async resolveRecyclePool(tenantId: string, module: PoolModule, ownerId: string | null) {
    const pools = await this.prisma.resourcePool.findMany({
      where: { tenantId, module, enabled: true },
      include: { pickRule: true, recycleRule: true },
      orderBy: { createdAt: 'desc' },
    })
    if (pools.length === 0) return this.ensureTenantDefaultPool(tenantId, module)
    if (!ownerId) return null

    const authUser = await this.loadAuthUser(tenantId, ownerId)
    if (!authUser) return null
    for (const pool of pools) {
      if (await this.scopeResolver.matchesUser(authUser, pool.scopeIds)) return pool
    }
    return null
  }

  /**
   * Cordys 自动回收只在 enabled + autoRecycle 的池中按创建时间倒序选最佳匹配池。
   * 与 resolveRecyclePool 分开，避免一个更新的“非自动回收池”截断自动规则。
   */
  async resolveAutoRecyclePool(tenantId: string, module: PoolModule, ownerId: string | null) {
    if (!ownerId) return null
    const pools = await this.prisma.resourcePool.findMany({
      where: { tenantId, module, enabled: true, autoRecycle: true },
      include: { pickRule: true, recycleRule: true },
      orderBy: { createdAt: 'desc' },
    })
    if (pools.length === 0) return null
    const authUser = await this.loadAuthUser(tenantId, ownerId)
    if (!authUser) return null
    for (const pool of pools) {
      if (await this.scopeResolver.matchesUser(authUser, pool.scopeIds)) return pool
    }
    return null
  }

  async assertCapacityForOwner(
    tenantId: string,
    module: PoolModule,
    ownerId: string,
    processCount = 1,
  ) {
    const owner = await this.loadAuthUser(tenantId, ownerId)
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    await this.assertCapacity(owner, module, processCount)
  }

  async listCapacities(user: AuthUser, module: PoolModule) {
    this.assertModule(module)
    return this.prisma.resourceCapacity.findMany({
      where: { tenantId: user.tenantId, module },
      orderBy: { createdAt: 'asc' },
    })
  }

  async createCapacity(user: AuthUser, dto: CreateResourceCapacityDto) {
    await this.assertCapacityScopesUnique(user.tenantId, dto.module, dto.scopeIds)
    return this.prisma.resourceCapacity.create({
      data: {
        tenantId: user.tenantId,
        module: dto.module,
        scopeIds: dto.scopeIds,
        capacity: dto.capacity,
        filters: dto.filters ? (dto.filters as unknown as Prisma.InputJsonValue) : undefined,
        createdById: user.id,
        updatedById: user.id,
      },
    })
  }

  async updateCapacity(user: AuthUser, id: string, dto: UpdateResourceCapacityDto) {
    const current = await this.prisma.resourceCapacity.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!current) throw new NotFoundException('库容规则不存在')
    const module = (dto.module ?? current.module) as PoolModule
    if (module !== current.module) throw new BadRequestException('库容规则创建后不能修改业务模块')
    if (dto.scopeIds) await this.assertCapacityScopesUnique(user.tenantId, module, dto.scopeIds, id)
    return this.prisma.resourceCapacity.update({
      where: { id },
      data: {
        ...(dto.scopeIds !== undefined ? { scopeIds: dto.scopeIds } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.filters !== undefined
          ? { filters: dto.filters as unknown as Prisma.InputJsonValue }
          : {}),
        updatedById: user.id,
      },
    })
  }

  async removeCapacity(user: AuthUser, id: string) {
    const result = await this.prisma.resourceCapacity.deleteMany({ where: { id, tenantId: user.tenantId } })
    if (result.count === 0) throw new NotFoundException('库容规则不存在')
    return { id }
  }

  async ownerHistory(user: AuthUser, module: PoolModule, resourceId: string) {
    const rows = await this.prisma.resourceOwnerHistory.findMany({
      where: { tenantId: user.tenantId, module, resourceId },
      orderBy: { endedAt: 'desc' },
    })
    const userIds = [
      ...new Set(rows.flatMap((row) => [row.ownerId, row.operatorId]).filter((id): id is string => !!id)),
    ]
    const users = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, id: { in: userIds } },
      select: { id: true, name: true, deptId: true },
    })
    const userMap = new Map(users.map((item) => [item.id, item]))
    const deptIds = [...new Set(users.map((item) => item.deptId).filter((id): id is string => !!id))]
    const departments = await this.prisma.department.findMany({
      where: { tenantId: user.tenantId, id: { in: deptIds } },
      select: { id: true, name: true },
    })
    const deptMap = new Map(departments.map((item) => [item.id, item.name]))
    return rows.map((row) => {
      const owner = userMap.get(row.ownerId)
      return {
        id: row.id,
        module: row.module as PoolModule,
        resourceId: row.resourceId,
        ownerId: row.ownerId,
        ownerName: owner?.name ?? null,
        departmentId: owner?.deptId ?? null,
        departmentName: owner?.deptId ? (deptMap.get(owner.deptId) ?? null) : null,
        operatorId: row.operatorId,
        operatorName: row.operatorId ? (userMap.get(row.operatorId)?.name ?? null) : null,
        poolId: row.poolId,
        reasonId: row.reasonId === 'system' ? null : row.reasonId,
        reasonName: null,
        collectedAt: row.collectedAt?.toISOString() ?? null,
        endedAt: row.endedAt.toISOString(),
      }
    })
  }

  private async assertCapacity(user: AuthUser, module: PoolModule, processCount: number) {
    const capacities = await this.prisma.resourceCapacity.findMany({
      where: { tenantId: user.tenantId, module },
      orderBy: { createdAt: 'desc' },
    })
    let matched: (typeof capacities)[number] | undefined
    for (const item of capacities) {
      if (await this.scopeResolver.matchesUser(user, item.scopeIds)) {
        matched = item
        break
      }
    }
    if (!matched) return
    if (module === 'lead') {
      const owned = await this.prisma.lead.count({
        where: { tenantId: user.tenantId, ownerId: user.id, inPool: false },
      })
      if (matched.capacity - owned < processCount) {
        throw new BadRequestException(
          `库容不足，当前最多还可领取 ${Math.max(matched.capacity - owned, 0)} 条`,
        )
      }
      return
    }

    const owned = await this.prisma.customer.count({
      where: { tenantId: user.tenantId, ownerId: user.id, inSea: false },
    })
    let excluded = 0
    if (Array.isArray(matched.filters) && matched.filters.length > 0) {
      const fields = await this.metadata.listFields(user.tenantId, 'customer')
      const fieldMap = new Map(fields.map((field) => [field.key, field]))
      const clauses = buildFilterClauses(fieldMap, matched.filters as unknown as FilterCondition[])
      if (clauses.length > 0) {
        excluded = await this.prisma.customer.count({
          where: {
            tenantId: user.tenantId,
            ownerId: user.id,
            inSea: false,
            AND: clauses as Prisma.CustomerWhereInput[],
          },
        })
      }
    }
    const effectiveOwned = Math.max(owned - excluded, 0)
    if (matched.capacity - effectiveOwned < processCount) {
      throw new BadRequestException(
        `库容不足，当前最多还可领取 ${Math.max(matched.capacity - effectiveOwned, 0)} 条`,
      )
    }
  }

  private async assertCapacityScopesUnique(
    tenantId: string,
    module: PoolModule,
    scopeIds: string[],
    excludeId?: string,
  ) {
    const rows = await this.prisma.resourceCapacity.findMany({
      where: { tenantId, module, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { scopeIds: true },
    })
    if (rows.length === 0) return
    const [incomingUsers, existingUsers] = await Promise.all([
      this.scopeResolver.resolveUserIds(tenantId, scopeIds),
      this.scopeResolver.resolveUserIds(tenantId, rows.flatMap((row) => row.scopeIds)),
    ])
    const existing = new Set(existingUsers)
    if (incomingUsers.some((id) => existing.has(id))) {
      throw new BadRequestException('库容适用范围与已有规则命中相同成员，不能重复')
    }
  }

  private async getPool(tenantId: string, id: string) {
    const pool = await this.prisma.resourcePool.findFirst({
      where: { id, tenantId },
      include: { recycleRule: true },
    })
    if (!pool) throw new NotFoundException('池不存在')
    return pool
  }

  private async loadAuthUser(tenantId: string, userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, status: 'ACTIVE' },
      include: { userRoles: { include: { role: true } } },
    })
    if (!user) return null
    return toAuthUser(user)
  }

  private validateRulePairs(dto: CreateResourcePoolDto | UpdateResourcePoolDto) {
    const pick = dto.pickRule
    if (!pick) return
    if (pick.limitDailyPick && !pick.dailyPickLimit) {
      throw new BadRequestException('启用每日领取限制时必须填写领取数量')
    }
    if (pick.limitPreviousOwner && !pick.previousOwnerCooldownDays) {
      throw new BadRequestException('启用前负责人限制时必须填写冷却天数')
    }
    if (pick.limitNewData && !pick.newDataCooldownDays) {
      throw new BadRequestException('启用新数据限制时必须填写冷却天数')
    }
  }

  private async normalizeHiddenFieldIds(
    tenantId: string,
    module: PoolModule,
    hiddenFieldIds: string[],
  ) {
    if (hiddenFieldIds.length === 0) return []
    const fields = await this.metadata.listFields(tenantId, module)
    const allowed = new Set(
      fields
        .filter((field) => field.key !== 'name' && !field.hidden)
        .map((field) => field.id),
    )
    return [...new Set(hiddenFieldIds)].filter((id) => allowed.has(id))
  }

  private assertModule(module: PoolModule) {
    if (module !== 'lead' && module !== 'customer') throw new BadRequestException('module 仅支持 lead/customer')
  }
}
