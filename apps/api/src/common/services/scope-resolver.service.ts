import { Injectable } from '@nestjs/common'
import type { AuthUser } from '../auth-user'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * 通用范围 token 解析器。
 * 当前支持：*、裸 user/dept id、user:<id>、dept:<id>（部门及全部下级）。
 * Pool、Capacity、审批人范围等后续统一复用这里，不在业务模块重复解析组织树。
 */
@Injectable()
export class ScopeResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async matchesUser(user: AuthUser, scopeIds: string[]): Promise<boolean> {
    if (scopeIds.length === 0) return false
    if (scopeIds.includes('*')) return true
    if (scopeIds.includes(user.id) || scopeIds.includes(`user:${user.id}`)) return true
    if (!user.deptId) return false
    if (scopeIds.includes(user.deptId)) return true

    const deptTokens = scopeIds.filter((id) => id.startsWith('dept:')).map((id) => id.slice(5))
    if (deptTokens.length === 0) return false

    const departments = await this.prisma.department.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, parentId: true },
    })
    const parentMap = new Map(departments.map((item) => [item.id, item.parentId]))
    let current: string | null = user.deptId
    while (current) {
      if (deptTokens.includes(current)) return true
      current = parentMap.get(current) ?? null
    }
    return false
  }

  /**
   * 将当前支持的 Scope token 展开成实际用户 ID。
   * Capacity 用它做语义级范围冲突检测，避免 dept:* 与 user:* 实际命中同一用户却被当成两条独立规则。
   */
  async resolveUserIds(tenantId: string, scopeIds: string[]): Promise<string[]> {
    if (scopeIds.length === 0) return []
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, deptId: true },
    })
    if (scopeIds.includes('*')) return users.map((user) => user.id)

    const departments = await this.prisma.department.findMany({
      where: { tenantId },
      select: { id: true, parentId: true },
    })
    const userIds = new Set(users.map((user) => user.id))
    const deptIds = new Set(departments.map((dept) => dept.id))
    const selectedUsers = new Set<string>()

    const explicitUserIds = new Set(
      scopeIds
        .filter((token) => token.startsWith('user:'))
        .map((token) => token.slice(5))
        .filter((id) => userIds.has(id)),
    )
    explicitUserIds.forEach((id) => selectedUsers.add(id))

    const descendantDeptIds = new Set(
      scopeIds
        .filter((token) => token.startsWith('dept:'))
        .map((token) => token.slice(5))
        .filter((id) => deptIds.has(id)),
    )
    if (descendantDeptIds.size > 0) {
      const childrenMap = new Map<string | null, string[]>()
      for (const dept of departments) {
        const children = childrenMap.get(dept.parentId) ?? []
        children.push(dept.id)
        childrenMap.set(dept.parentId, children)
      }
      const queue = [...descendantDeptIds]
      while (queue.length > 0) {
        const current = queue.shift()!
        for (const child of childrenMap.get(current) ?? []) {
          if (descendantDeptIds.has(child)) continue
          descendantDeptIds.add(child)
          queue.push(child)
        }
      }
    }

    const exactDeptIds = new Set(
      scopeIds.filter((token) => !token.includes(':') && deptIds.has(token)),
    )
    for (const user of users) {
      if (scopeIds.includes(user.id)) selectedUsers.add(user.id)
      if (user.deptId && (descendantDeptIds.has(user.deptId) || exactDeptIds.has(user.deptId))) {
        selectedUsers.add(user.id)
      }
    }
    return [...selectedUsers]
  }
}
