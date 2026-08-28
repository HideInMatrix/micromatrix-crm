import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../common/auth-user'
import { DataScopeService } from '../common/services/data-scope.service'
import type { Customer } from '../generated/prisma/client'
import { ResourcePoolsService } from '../modules/pool-rules/resource-pools.service'
import { PrismaService } from '../prisma/prisma.service'

export type CustomerCollaborationAccess = 'READ_ONLY' | 'COLLABORATION' | null

export interface CustomerAccessContext {
  customer: Customer
  dataScope: boolean
  pool: boolean
  poolManager: boolean
  collaborationType: CustomerCollaborationAccess
  canRead: boolean
  canManageCustomer: boolean
  canCollaborateWrite: boolean
}

/**
 * 客户资源访问的单一裁决入口。
 *
 * Cordys 的客户详情、联系人和跟进分别有协作特例；MicroMatrix 将这些语义
 * 收敛到一个上下文，避免 Controller/Service 各自拼接 teamMembers 查询导致越权。
 */
@Injectable()
export class CustomerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScopeService: DataScopeService,
    private readonly resourcePools: ResourcePoolsService,
  ) {}

  async resolve(
    user: AuthUser,
    customerId: string,
    permission = 'customer:read',
  ): Promise<CustomerAccessContext> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.tenantId },
    })
    if (!customer) throw new NotFoundException('客户不存在或无权访问')

    const dataScope = await this.dataScopeService.matchesDirectOwner(
      user,
      customer.owner,
      permission,
    )

    let pool = false
    let poolManager = false
    if (customer.inSharedPool && customer.poolId) {
      const poolIds = (await this.resourcePools.options(user, 'customer')).map((item) => item.id)
      pool = poolIds.includes(customer.poolId)
      poolManager = await this.resourcePools.isPoolManager(user, 'customer', customer.poolId)
    }

    const collaboration = await this.prisma.customerCollaboration.findFirst({
      where: {
        customerId,
        userId: user.id,
      },
      select: { collaborationType: true },
    })
    const collaborationType = this.normalizeCollaborationType(collaboration?.collaborationType)

    const canRead =
      !customer.inSharedPool && (dataScope || collaborationType !== null)
    const canManageCustomer = !customer.inSharedPool && dataScope
    const canCollaborateWrite =
      !customer.inSharedPool && (dataScope || collaborationType === 'COLLABORATION')

    return {
      customer,
      dataScope,
      pool,
      poolManager,
      collaborationType,
      canRead,
      canManageCustomer,
      canCollaborateWrite,
    }
  }

  async assertRead(user: AuthUser, customerId: string) {
    const context = await this.resolve(user, customerId, 'customer:read')
    if (!context.canRead) throw new NotFoundException('客户不存在或无权访问')
    return context
  }

  async assertPoolRead(user: AuthUser, customerId: string) {
    const context = await this.resolve(user, customerId, 'customerPool:read')
    if (!context.customer.inSharedPool || !context.pool) {
      throw new NotFoundException('公海客户不存在或无权访问')
    }
    return context
  }

  async assertFollowRead(user: AuthUser, customerId: string) {
    const context = await this.resolve(user, customerId, 'customer:read')
    if (!context.canRead && !context.pool) {
      throw new NotFoundException('客户不存在或无权访问')
    }
    return context
  }

  async assertFollowWrite(user: AuthUser, customerId: string) {
    const context = await this.resolve(user, customerId, 'customer:update')
    if (context.customer.inSharedPool) {
      if (!context.pool) throw new ForbiddenException('无权维护该公海客户的跟进记录')
      return context
    }
    if (!context.canCollaborateWrite) {
      throw new ForbiddenException('当前协作关系仅允许查看')
    }
    return context
  }

  async assertOwnerHistoryRead(user: AuthUser, customerId: string) {
    const context = await this.resolve(user, customerId, 'customer:read')
    if (!context.canRead && !context.pool) {
      throw new NotFoundException('客户不存在或无权访问')
    }
    return context
  }

  async assertManageCustomer(user: AuthUser, customerId: string) {
    const context = await this.resolve(user, customerId, 'customer:update')
    if (!context.canManageCustomer) throw new ForbiddenException('无权修改该客户')
    return context
  }

  async assertCollaborateWrite(user: AuthUser, customerId: string, permission: string) {
    const context = await this.resolve(user, customerId, permission)
    if (!context.canCollaborateWrite) throw new ForbiddenException('当前协作关系仅允许查看')
    return context
  }

  private normalizeCollaborationType(
    value: string | null | undefined,
  ): CustomerCollaborationAccess {
    if (value === 'READ_ONLY') return 'READ_ONLY'
    if (value === 'COLLABORATION') return 'COLLABORATION'
    return null
  }
}
