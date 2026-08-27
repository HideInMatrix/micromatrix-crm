import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import { DictionariesService } from '../dictionaries/dictionaries.service'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import type { PoolModule } from './pool-domain.types'
import { loadUserScopeTokens, scopeMatches } from './pool-repository.helpers'

/** 业务访问编排器：数据读写始终委托 Clue/Customer 分域 Repository。 */
@Injectable()
export class ResourcePoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cluePools: CluePoolRepository,
    private readonly customerPools: CustomerPoolRepository,
    private readonly dictionaries: DictionariesService,
  ) {}

  list(user: AuthUser, module: PoolModule) {
    this.assertModule(module)
    return module === 'lead'
      ? this.cluePools.listPools(user.tenantId)
      : this.customerPools.listPools(user.tenantId)
  }

  async options(user: AuthUser, module: PoolModule) {
    const pools = await this.list(user, module)
    if (user.permissions.includes('*')) return pools.filter((pool) => pool.enable)
    const tokens = await this.prisma.$transaction((tx) =>
      loadUserScopeTokens(tx, user.tenantId, user.id),
    )
    return pools.filter(
      (pool) =>
        pool.enable && (scopeMatches(pool.scopeId, tokens) || scopeMatches(pool.ownerId, tokens)),
    )
  }

  async isPoolManager(user: AuthUser, module: PoolModule, poolId: string | null) {
    if (user.permissions.includes('*')) return true
    if (!poolId) return false
    const pool = (await this.list(user, module)).find((item) => item.id === poolId && item.enable)
    if (!pool) return false
    const tokens = await this.prisma.$transaction((tx) =>
      loadUserScopeTokens(tx, user.tenantId, user.id),
    )
    return scopeMatches(pool.ownerId, tokens)
  }

  async assertPoolMember(user: AuthUser, module: PoolModule, poolId: string) {
    const pool = (await this.list(user, module)).find((item) => item.id === poolId)
    if (!pool) throw new NotFoundException(module === 'lead' ? '线索池不存在' : '客户公海不存在')
    if (user.permissions.includes('*')) return pool
    const tokens = await this.prisma.$transaction((tx) =>
      loadUserScopeTokens(tx, user.tenantId, user.id),
    )
    if (!scopeMatches(pool.scopeId, tokens) && !scopeMatches(pool.ownerId, tokens)) {
      throw new ForbiddenException('你不是该池成员或管理员')
    }
    return pool
  }

  async resolveTargetPool(user: AuthUser, module: PoolModule, poolId?: string) {
    const options = await this.options(user, module)
    const pool = poolId ? options.find((item) => item.id === poolId) : options[0]
    if (!pool) throw new BadRequestException('没有匹配的可用池，请先完成池配置')
    return pool
  }

  async resolveMoveTargetPool(
    organizationId: string,
    module: PoolModule,
    ownerId: string | null,
    poolId?: string,
  ) {
    const pools =
      module === 'lead'
        ? await this.cluePools.listPools(organizationId)
        : await this.customerPools.listPools(organizationId)
    if (poolId) {
      const selected = pools.find((pool) => pool.id === poolId && pool.enable)
      if (!selected) throw new NotFoundException('目标池不存在或已禁用')
      return selected
    }
    if (!ownerId) throw new BadRequestException('原负责人为空，无法匹配目标池')
    const tokens = await this.prisma.$transaction((tx) =>
      loadUserScopeTokens(tx, organizationId, ownerId),
    )
    const matched = [...pools]
      .reverse()
      .find((pool) => pool.enable && scopeMatches(pool.scopeId, tokens))
    if (!matched) throw new BadRequestException('未找到与原负责人范围匹配的可用池')
    return matched
  }

  async assertCapacityForOwner(
    organizationId: string,
    module: PoolModule,
    ownerId: string,
    processCount = 1,
  ) {
    const tokens = await this.prisma.$transaction((tx) =>
      loadUserScopeTokens(tx, organizationId, ownerId),
    )
    if (!tokens.size) throw new BadRequestException('负责人不存在或已禁用')
    const capacities =
      module === 'lead'
        ? await this.cluePools.listCapacities(organizationId)
        : await this.customerPools.listCapacities(organizationId)
    const capacity = capacities.find((item) => scopeMatches(item.scopeId, tokens))?.capacity
    if (capacity === null || capacity === undefined) return
    const owned =
      module === 'lead'
        ? await this.prisma.clue.count({
            where: { organizationId, owner: ownerId, inSharedPool: false },
          })
        : await this.prisma.customer.count({
            where: { organizationId, owner: ownerId, inSharedPool: false },
          })
    if (owned + processCount > capacity)
      throw new BadRequestException('负责人持有数量将超过库容上限')
  }

  async ownerHistory(user: AuthUser, module: PoolModule, resourceId: string) {
    const history =
      module === 'lead'
        ? await this.cluePools.listOwnerHistory(user.tenantId, resourceId)
        : await this.customerPools.listOwnerHistory(user.tenantId, resourceId)
    const userIds = [
      ...new Set(history.flatMap((item) => [item.owner, item.operator]).filter(Boolean)),
    ]
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { tenantId: user.tenantId, id: { in: userIds } },
          select: { id: true, name: true, dept: { select: { id: true, name: true } } },
        })
      : []
    const userMap = new Map(users.map((item) => [item.id, item]))
    const reasonModule = module === 'lead' ? 'CLUE_POOL_RS' : 'CUSTOMER_POOL_RS'
    const showReason = await this.dictionaries.isEnabled(user.tenantId, reasonModule)
    const reasonMap = showReason
      ? await this.dictionaries.reasonNames(
          user.tenantId,
          history.map((item) => item.reasonId).filter((id): id is string => Boolean(id)),
        )
      : new Map<string, string>()

    return history.map((item) => {
      const owner = userMap.get(item.owner)
      const operator = userMap.get(item.operator)
      return {
        id: item.id,
        module,
        resourceId,
        ownerId: item.owner,
        ownerName: owner?.name ?? null,
        departmentId: owner?.dept?.id ?? null,
        departmentName: owner?.dept?.name ?? null,
        operatorId: item.operator || null,
        operatorName: operator?.name ?? null,
        poolId: null,
        reasonId: showReason ? item.reasonId : null,
        reasonName: showReason && item.reasonId ? (reasonMap.get(item.reasonId) ?? null) : null,
        collectedAt: new Date(Number(item.collectionTime)).toISOString(),
        endedAt: new Date(Number(item.endTime)).toISOString(),
      }
    })
  }

  private assertModule(module: PoolModule): void {
    if (module !== 'lead' && module !== 'customer') throw new BadRequestException('池模块不合法')
  }
}
