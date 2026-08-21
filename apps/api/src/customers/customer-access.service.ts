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
    permission = 'menu:customer',
  ): Promise<CustomerAccessContext> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId: user.tenantId },
    })
    if (!customer) throw new NotFoundException('客户不存在或无权访问')

    const dataScope = await this.dataScopeService.matchesResource(
      user,
      customer.ownerId,
      customer.deptId,
      permission,
    )

    let pool = false
    let poolManager = false
    if (customer.inSea) {
      // poolId=null 是多池上线前的兼容数据，沿用既有“公海可见”语义。
      if (!customer.poolId) {
        pool = true
      } else {
        const poolIds = (await this.resourcePools.options(user, 'customer')).map((item) => item.id)
        pool = poolIds.includes(customer.poolId)
      }
      poolManager = await this.resourcePools.isPoolManager(user, 'customer', customer.poolId)
    }

    const collaboration = await this.prisma.customerTeamMember.findFirst({
      where: {
        tenantId: user.tenantId,
        customerId,
        userId: user.id,
      },
      select: { collaborationType: true },
    })
    const collaborationType = this.normalizeCollaborationType(collaboration?.collaborationType)

    const canRead = dataScope || pool || collaborationType !== null
    const canManageCustomer = dataScope || poolManager
    // 公海可见只代表可读/可领取；未领取前不能因此获得联系人/跟进写权限。
    const canCollaborateWrite = dataScope || collaborationType === 'COLLABORATION'

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
    const context = await this.resolve(user, customerId, 'menu:customer')
    if (!context.canRead) throw new NotFoundException('客户不存在或无权访问')
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

  private normalizeCollaborationType(value: string | null | undefined): CustomerCollaborationAccess {
    if (value === 'READ_ONLY') return 'READ_ONLY'
    if (value === 'COLLABORATION') return 'COLLABORATION'
    return null
  }
}
