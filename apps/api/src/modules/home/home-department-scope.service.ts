import { Injectable, Optional } from '@nestjs/common'
import { hasPermission, type HomeDepartmentNode, type HomeSearchType } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import { PrismaService } from '../../prisma/prisma.service'
import { homeCacheUserContext } from './home-cache-context'

export interface HomeResolvedScope {
  all: boolean
  self: boolean
  deptIds: string[]
  userIds: string[] | null
}

@Injectable()
export class HomeDepartmentScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    @Optional() private readonly cache?: TenantDerivedCacheService,
  ) {}

  async tree(user: AuthUser): Promise<HomeDepartmentNode[]> {
    if (this.cache) {
      return this.cache.remember({
        tenantId: user.tenantId,
        namespace: 'directory',
        key: `home-department-tree:${this.cache.fingerprint(homeCacheUserContext(user))}`,
        ttlSeconds: 3 * 60,
        loader: () => this.loadTree(user),
      })
    }
    return this.loadTree(user)
  }

  private async loadTree(user: AuthUser): Promise<HomeDepartmentNode[]> {
    const relevantRoles = user.roles.filter(
      (role) =>
        hasPermission(role.permissions, 'menu:lead') ||
        hasPermission(role.permissions, 'menu:opportunity'),
    )
    if (!relevantRoles.length) return []

    const departments = await this.prisma.department.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, parentId: true },
    })
    const allIds = new Set(departments.map((department) => department.id))
    if (relevantRoles.some((role) => role.dataScope === 'ALL')) {
      return this.buildTree(departments, allIds)
    }

    const allowedIds = new Set<string>()
    for (const role of relevantRoles) {
      if (role.dataScope === 'DEPT' && user.deptId) allowedIds.add(user.deptId)
      if (role.dataScope === 'DEPT_AND_CHILD' && user.deptId) {
        ;(await this.dataScope.collectWithDescendants(user.tenantId, user.deptId)).forEach((id) =>
          allowedIds.add(id),
        )
      }
      if (role.dataScope === 'CUSTOM') {
        ;(
          await this.dataScope.collectManyWithDescendants(user.tenantId, role.scopeDeptIds)
        ).forEach((id) => allowedIds.add(id))
      }
    }
    return this.buildTree(departments, allowedIds)
  }

  async resolve(
    user: AuthUser,
    permission: string,
    searchType: HomeSearchType,
    requestedDeptIds: string[],
  ): Promise<HomeResolvedScope> {
    if (searchType === 'SELF') {
      return { all: false, self: true, deptIds: [], userIds: [user.id] }
    }

    const scope = await this.dataScope.resolveScope(user, permission)
    if (!scope.hasPermission) return { all: false, self: false, deptIds: [], userIds: [] }

    if (searchType === 'ALL' && scope.all) {
      return { all: true, self: false, deptIds: [], userIds: null }
    }

    let deptIds: string[]
    if (searchType === 'DEPARTMENT') {
      const requested = [...new Set(requestedDeptIds)]
      deptIds = scope.all ? requested : requested.filter((id) => scope.deptIds.includes(id))
    } else {
      deptIds = scope.deptIds
    }

    if (!deptIds.length) {
      return searchType === 'ALL' && !scope.all
        ? { all: false, self: false, deptIds: [], userIds: [user.id] }
        : { all: false, self: false, deptIds: [], userIds: [] }
    }

    const scopedUsers = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, status: 'ACTIVE', deptId: { in: deptIds } },
      select: { id: true },
    })
    const userIds = new Set(scopedUsers.map((member) => member.id))
    if (searchType === 'ALL') userIds.add(user.id)
    return { all: false, self: false, deptIds, userIds: [...userIds] }
  }

  private buildTree(
    departments: Array<{ id: string; name: string; parentId: string | null }>,
    allowedIds: Set<string>,
  ): HomeDepartmentNode[] {
    const childrenMap = new Map<
      string | null,
      Array<{ id: string; name: string; parentId: string | null }>
    >()
    for (const department of departments) {
      const list = childrenMap.get(department.parentId) ?? []
      list.push(department)
      childrenMap.set(department.parentId, list)
    }

    const visit = (parentId: string | null): HomeDepartmentNode[] => {
      const result: HomeDepartmentNode[] = []
      for (const department of childrenMap.get(parentId) ?? []) {
        const children = visit(department.id)
        if (allowedIds.has(department.id)) {
          result.push({
            id: department.id,
            name: department.name,
            ...(children.length ? { children } : {}),
          })
        } else {
          result.push(...children)
        }
      }
      return result
    }
    return visit(null)
  }
}
