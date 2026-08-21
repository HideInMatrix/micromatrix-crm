import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { AuthUser } from '../auth-user'

/**
 * 数据范围过滤：业务表约定包含 ownerId（负责人）与 deptId（归属部门）两列，
 * 各业务模块查询时合并本服务返回的 where 片段实现数据边界。
 * 任何范围下本人负责的数据始终可见。
 */
@Injectable()
export class DataScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async scopeFilter(user: AuthUser): Promise<Record<string, unknown>> {
    switch (user.dataScope) {
      case 'ALL':
        return {}
      case 'SELF':
        return { ownerId: user.id }
      case 'DEPT':
        return this.ownerOrDepts(user, user.deptId ? [user.deptId] : [])
      case 'DEPT_AND_CHILD': {
        const deptIds = user.deptId
          ? await this.collectWithDescendants(user.tenantId, user.deptId)
          : []
        return this.ownerOrDepts(user, deptIds)
      }
      case 'CUSTOM':
        return this.ownerOrDepts(
          user,
          await this.collectManyWithDescendants(user.tenantId, user.scopeDeptIds),
        )
      default:
        return { ownerId: user.id }
    }
  }

  /**
   * 对单条已加载资源做数据范围判断。
   * 用于 ResourceAccessService 组合“权限码 + 数据范围”；列表查询仍优先使用 scopeFilter 下推到数据库。
   */
  async matchesResource(user: AuthUser, ownerId: string | null, deptId: string | null): Promise<boolean> {
    if (ownerId === user.id) return true
    switch (user.dataScope) {
      case 'ALL':
        return true
      case 'SELF':
        return false
      case 'DEPT':
        return !!user.deptId && deptId === user.deptId
      case 'DEPT_AND_CHILD': {
        if (!user.deptId || !deptId) return false
        const deptIds = await this.collectWithDescendants(user.tenantId, user.deptId)
        return deptIds.includes(deptId)
      }
      case 'CUSTOM':
        if (!deptId) return false
        return (
          await this.collectManyWithDescendants(user.tenantId, user.scopeDeptIds)
        ).includes(deptId)
      default:
        return false
    }
  }

  /** 指定部门及其全部下级部门的 id 集合（含自身） */
  async collectWithDescendants(tenantId: string, rootId: string): Promise<string[]> {
    return this.collectManyWithDescendants(tenantId, [rootId])
  }

  /** Cordys DEPT_CUSTOM 语义：每个已选部门都包含其全部下级部门。 */
  async collectManyWithDescendants(tenantId: string, rootIds: string[]): Promise<string[]> {
    if (rootIds.length === 0) return []
    const all = await this.prisma.department.findMany({
      where: { tenantId },
      select: { id: true, parentId: true },
    })
    const childrenMap = new Map<string | null, string[]>()
    for (const dept of all) {
      const list = childrenMap.get(dept.parentId) ?? []
      list.push(dept.id)
      childrenMap.set(dept.parentId, list)
    }
    const validIds = new Set(all.map((department) => department.id))
    const result = new Set<string>()
    const queue = [...new Set(rootIds.filter((id) => validIds.has(id)))]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (result.has(current)) continue
      result.add(current)
      queue.push(...(childrenMap.get(current) ?? []))
    }
    return [...result]
  }

  private ownerOrDepts(user: AuthUser, deptIds: string[]): Record<string, unknown> {
    if (deptIds.length === 0) return { ownerId: user.id }
    return { OR: [{ ownerId: user.id }, { deptId: { in: deptIds } }] }
  }
}
