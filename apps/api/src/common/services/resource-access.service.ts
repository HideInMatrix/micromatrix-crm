import { ForbiddenException, Injectable } from '@nestjs/common'
import { hasPermission } from '@micromatrix/shared'
import type { AuthUser } from '../auth-user'
import { DataScopeService } from './data-scope.service'

/**
 * 业务资源权限上下文。
 * 与 Cordys ResourceAccessContext 语义对齐，但保留 deptId，避免重复查询负责人部门。
 * approvalStatus 先作为扩展位保留，Wave 4 接入审批状态权限和待办任务特例。
 */
export interface ResourceAccessContext {
  ownerId: string | null
  deptId: string | null
  approvalStatus?: string | null
}

@Injectable()
export class ResourceAccessService {
  constructor(private readonly dataScope: DataScopeService) {}

  async canAccess(
    user: AuthUser,
    permission: string,
    context?: ResourceAccessContext | null,
  ): Promise<boolean> {
    if (!hasPermission(user.permissions, permission)) return false
    if (!context?.ownerId) return true
    return this.dataScope.matchesResource(user, context.ownerId, context.deptId)
  }

  async assertAccess(
    user: AuthUser,
    permission: string,
    context?: ResourceAccessContext | null,
  ): Promise<void> {
    if (!(await this.canAccess(user, permission, context))) {
      throw new ForbiddenException('没有资源操作权限')
    }
  }
}
