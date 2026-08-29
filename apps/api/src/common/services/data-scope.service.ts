import { Injectable } from '@nestjs/common'
import { hasPermission } from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'
import type { AuthUser } from '../auth-user'

/**
 * 按业务权限码计算多角色数据范围。
 * 只有包含目标权限（或 `*`）的角色参与合并，避免无关角色泄漏更宽的数据范围。
 */
@Injectable()
export class DataScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async scopeFilter(user: AuthUser, permission: string): Promise<Record<string, unknown>> {
    const scope = await this.resolveScope(user, permission)
    if (!scope.hasPermission) return { ownerId: '__permission_scope_denied__' }
    if (scope.all) return {}
    return this.ownerOrDepts(user, scope.deptIds)
  }

  async matchesResource(
    user: AuthUser,
    ownerId: string | null,
    deptId: string | null,
    permission: string,
  ): Promise<boolean> {
    const scope = await this.resolveScope(user, permission)
    if (!scope.hasPermission) return false
    if (ownerId === user.id || scope.all) return true
    return !!deptId && scope.deptIds.includes(deptId)
  }

  /** Cordys 直接业务表只保存 owner；部门范围通过负责人所属部门展开为 owner 集合。 */
  async directOwnerFilter(
    user: AuthUser,
    permission: string,
  ): Promise<{ owner?: string | { in: string[] } }> {
    const scope = await this.resolveScope(user, permission)
    if (!scope.hasPermission) return { owner: '__permission_scope_denied__' }
    if (scope.all) return {}
    const ownerIds = new Set([user.id])
    if (scope.deptIds.length) {
      const users = await this.prisma.user.findMany({
        where: { tenantId: user.tenantId, status: 'ACTIVE', deptId: { in: scope.deptIds } },
        select: { id: true },
      })
      users.forEach((item) => ownerIds.add(item.id))
    }
    return ownerIds.size === 1 ? { owner: user.id } : { owner: { in: [...ownerIds] } }
  }

  async matchesDirectOwner(user: AuthUser, ownerId: string | null, permission: string) {
    const scope = await this.resolveScope(user, permission)
    if (!scope.hasPermission) return false
    if (scope.all || ownerId === user.id) return true
    if (!ownerId || !scope.deptIds.length) return false
    return !!(await this.prisma.user.findFirst({
      where: {
        id: ownerId,
        tenantId: user.tenantId,
        status: 'ACTIVE',
        deptId: { in: scope.deptIds },
      },
      select: { id: true },
    }))
  }

  /** Cordys 报价等资源按 create_user 所属部门做数据范围，而不是伪造 owner/dept 主表字段。 */
  async directCreatorFilter(
    user: AuthUser,
    permission: string,
  ): Promise<{ createUser?: string | { in: string[] } }> {
    const scope = await this.resolveScope(user, permission)
    if (!scope.hasPermission) return { createUser: '__permission_scope_denied__' }
    if (scope.all) return {}
    const userIds = new Set([user.id])
    if (scope.deptIds.length) {
      const users = await this.prisma.user.findMany({
        where: { tenantId: user.tenantId, status: 'ACTIVE', deptId: { in: scope.deptIds } },
        select: { id: true },
      })
      users.forEach((item) => userIds.add(item.id))
    }
    return userIds.size === 1 ? { createUser: user.id } : { createUser: { in: [...userIds] } }
  }

  async matchesDirectCreator(user: AuthUser, createUser: string | null, permission: string) {
    const scope = await this.resolveScope(user, permission)
    if (!scope.hasPermission) return false
    if (scope.all || createUser === user.id) return true
    if (!createUser || !scope.deptIds.length) return false
    return !!(await this.prisma.user.findFirst({
      where: {
        id: createUser,
        tenantId: user.tenantId,
        status: 'ACTIVE',
        deptId: { in: scope.deptIds },
      },
      select: { id: true },
    }))
  }

  /** Cordys 语义：筛出拥有当前权限的角色，再对这些角色的数据范围取并集。 */
  async resolveScope(user: AuthUser, permission: string) {
    const roles = user.roles.filter((role) => hasPermission(role.permissions, permission))
    if (roles.length === 0) return { hasPermission: false, all: false, deptIds: [] as string[] }
    if (roles.some((role) => role.dataScope === 'ALL')) {
      return { hasPermission: true, all: true, deptIds: [] as string[] }
    }

    const deptIds = new Set<string>()
    const descendantRoots = new Set<string>()
    for (const role of roles) {
      if (role.dataScope === 'DEPT' && user.deptId) deptIds.add(user.deptId)
      if (role.dataScope === 'DEPT_AND_CHILD' && user.deptId) descendantRoots.add(user.deptId)
      if (role.dataScope === 'CUSTOM') {
        role.scopeDeptIds.forEach((id) => descendantRoots.add(id))
      }
    }
    const expanded = await this.collectManyWithDescendants(user.tenantId, [...descendantRoots])
    expanded.forEach((id) => deptIds.add(id))
    return { hasPermission: true, all: false, deptIds: [...deptIds] }
  }

  async collectWithDescendants(tenantId: string, rootId: string): Promise<string[]> {
    return this.collectManyWithDescendants(tenantId, [rootId])
  }

  /** Cordys CUSTOM 语义：每个已选部门都包含其全部下级部门。 */
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
