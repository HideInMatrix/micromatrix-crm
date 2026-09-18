import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Varchar } from '../../prisma/prisma8-varchar'

export interface DashboardScopeMember {
  id: string
  name: string
  type: 'USER' | 'DEPARTMENT'
}

interface DashboardVisibilityRow {
  id: string
  scopeId: string
  createUser: string
}

@Injectable()
export class DashboardAccessService {
  constructor(private readonly prisma8: Prisma8Service) {}

  hasWildcard(user: AuthUser) {
    return user.permissions.includes('*')
  }

  private tryParseScope(scopeId: string): string[] | null {
    try {
      const value = JSON.parse(scopeId) as unknown
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null
      return value
    } catch {
      return null
    }
  }

  parseScope(scopeId: string): string[] {
    return this.tryParseScope(scopeId) ?? []
  }

  async departmentPathIds(user: AuthUser): Promise<string[]> {
    if (!user.deptId) return []
    const rows = await this.prisma8.client.orm.public.Departments.where({ tenantId: user.tenantId })
      .select('id', 'parentId')
      .all()
    const map = new Map(rows.map((row) => [row.id, row.parentId]))
    const result: string[] = []
    const visited = new Set<string>()
    let current: string | null | undefined = user.deptId
    while (current && !visited.has(current)) {
      visited.add(current)
      result.push(current)
      current = map.get(current)
    }
    return result
  }

  isVisible(
    row: Pick<DashboardVisibilityRow, 'scopeId' | 'createUser'>,
    user: AuthUser,
    departmentIds: string[],
  ) {
    if (this.hasWildcard(user) || row.createUser === user.id) return true
    const scopeIds = this.tryParseScope(row.scopeId)
    if (scopeIds === null) return false
    if (scopeIds.length === 0) return true
    if (scopeIds.includes(user.id)) return true
    return departmentIds.some((id) => scopeIds.includes(id))
  }

  async assertVisibleDashboard(user: AuthUser, id: string) {
    const row = await this.prisma8.client.orm.public.Dashboard.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).first()
    if (!row) throw new NotFoundException('仪表板不存在')
    const departmentIds = await this.departmentPathIds(user)
    if (!this.isVisible(row, user, departmentIds)) throw new ForbiddenException('无权访问该仪表板')
    const module = await this.prisma8.client.orm.public.DashboardModule.where({
      id: row.dashboardModuleId,
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).first()
    if (!module) throw new NotFoundException('仪表板文件夹不存在')
    return { ...row, module }
  }

  async visibleDashboardIds<T extends DashboardVisibilityRow>(user: AuthUser, rows: T[]): Promise<Set<string>> {
    if (this.hasWildcard(user)) return new Set(rows.map((row) => row.id))
    const departmentIds = await this.departmentPathIds(user)
    return new Set(rows.filter((row) => this.isVisible(row, user, departmentIds)).map((row) => row.id))
  }

  async validateScopeIds(user: AuthUser, rawIds: string[]) {
    const ids = [...new Set(rawIds.map((item) => item.trim()).filter(Boolean))]
    if (ids.length === 0) return []
    const [users, departments] = await Promise.all([
      this.prisma8.client.orm.public.Users.where({ tenantId: user.tenantId })
        .where((row) => row.id.in(ids))
        .select('id')
        .all(),
      this.prisma8.client.orm.public.Departments.where({ tenantId: user.tenantId })
        .where((row) => row.id.in(ids))
        .select('id')
        .all(),
    ])
    const found = new Set([...users.map((item) => item.id), ...departments.map((item) => item.id)])
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length) throw new BadRequestException(`仪表板成员范围包含无效 ID: ${missing.join(', ')}`)
    return ids
  }

  async resolveScopeMembers(user: AuthUser, scopeIds: string[]): Promise<DashboardScopeMember[]> {
    if (scopeIds.length === 0) return []
    const [users, departments] = await Promise.all([
      this.prisma8.client.orm.public.Users.where({ tenantId: user.tenantId })
        .where((row) => row.id.in(scopeIds))
        .select('id', 'name')
        .all(),
      this.prisma8.client.orm.public.Departments.where({ tenantId: user.tenantId })
        .where((row) => row.id.in(scopeIds))
        .select('id', 'name')
        .all(),
    ])
    const userMap = new Map(users.map((item) => [item.id, item.name]))
    const deptMap = new Map(departments.map((item) => [item.id, item.name]))
    const result: DashboardScopeMember[] = []
    for (const id of scopeIds) {
      const userName = userMap.get(id)
      if (userName) {
        result.push({ id, name: userName, type: 'USER' })
        continue
      }
      const deptName = deptMap.get(id)
      if (deptName) result.push({ id, name: deptName, type: 'DEPARTMENT' })
    }
    return result
  }
}
