import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { DepartmentVO } from '@micromatrix/shared'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampToDate } from '../../prisma/prisma8-temporal'
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto'

const CACHE_NAMESPACE = 'directory'
const CACHE_TTL_SECONDS = 3 * 60

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma8: Prisma8Service,
    @Optional() private readonly cache?: TenantDerivedCacheService,
  ) {}

  async tree(tenantId: string): Promise<DepartmentVO[]> {
    if (this.cache) {
      return this.cache.remember({
        tenantId,
        namespace: CACHE_NAMESPACE,
        key: 'department-tree',
        ttlSeconds: CACHE_TTL_SECONDS,
        loader: () => this.loadTree(tenantId),
      })
    }
    return this.loadTree(tenantId)
  }

  private async loadTree(tenantId: string): Promise<DepartmentVO[]> {
    const [departments, users] = await Promise.all([
      this.prisma8.client.orm.public.Departments.where({ tenantId })
        .orderBy([(row) => row.sort.asc(), (row) => row.createdAt.asc()])
        .all(),
      this.prisma8.client.orm.public.Users.where({ tenantId }).select('id', 'name', 'deptId').all(),
    ])

    const userNameMap = new Map(users.map((u) => [u.id, u.name]))
    const deptUserCount = new Map<string, number>()
    for (const u of users) {
      if (u.deptId) deptUserCount.set(u.deptId, (deptUserCount.get(u.deptId) ?? 0) + 1)
    }

    const nodes: DepartmentVO[] = departments.map((d) => ({
      id: d.id,
      name: d.name,
      parentId: d.parentId,
      leaderId: d.leaderId,
      leaderName: d.leaderId ? (userNameMap.get(d.leaderId) ?? null) : null,
      sort: d.sort,
      userCount: deptUserCount.get(d.id) ?? 0,
      children: [],
    }))

    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const roots: DepartmentVO[] = []
    for (const node of nodes) {
      const parent = node.parentId ? nodeMap.get(node.parentId) : undefined
      if (parent) parent.children!.push(node)
      else roots.push(node)
    }
    return roots
  }

  async create(tenantId: string, dto: CreateDepartmentDto) {
    const name = dto.name.trim()
    const parentId = dto.parentId || null
    if (parentId) await this.ensureExists(tenantId, parentId)
    await this.ensureNameFree(tenantId, name, parentId)
    if (dto.leaderId) {
      throw new BadRequestException('请先创建部门并将成员加入该部门，再设置部门主管')
    }
    const department = await this.prisma8.client.orm.public.Departments.create({
      tenantId,
      name,
      parentId,
      leaderId: null,
      sort: dto.sort ?? 0,
      updatedAt: prisma8Now(),
    })
    await this.cache?.invalidate(tenantId, CACHE_NAMESPACE)
    return this.toLegacyDepartment(department)
  }

  async update(tenantId: string, id: string, dto: UpdateDepartmentDto) {
    const current = await this.ensureExists(tenantId, id)
    const parentId = dto.parentId === undefined ? current.parentId : dto.parentId || null
    if (parentId) {
      if (parentId === id) throw new BadRequestException('不能将自身设为上级部门')
      await this.ensureExists(tenantId, parentId)
      await this.ensureNotDescendant(tenantId, id, parentId)
    }
    const name = dto.name?.trim() ?? current.name
    if (name !== current.name || parentId !== current.parentId) {
      await this.ensureNameFree(tenantId, name, parentId, id)
    }
    if (dto.leaderId) {
      await this.ensureLeaderCandidate(tenantId, id, dto.leaderId)
    }
    const department = await this.prisma8.client.orm.public.Departments.where({ id, tenantId }).update({
      ...(dto.name === undefined ? {} : { name }),
      ...(dto.parentId === undefined ? {} : { parentId }),
      ...(dto.leaderId === undefined ? {} : { leaderId: dto.leaderId || null }),
      ...(dto.sort === undefined ? {} : { sort: dto.sort }),
      updatedAt: prisma8Now(),
    })
    if (!department) throw new NotFoundException('部门不存在')
    await this.cache?.invalidate(tenantId, CACHE_NAMESPACE)
    return this.toLegacyDepartment(department)
  }

  async remove(tenantId: string, id: string) {
    const dept = await this.ensureExists(tenantId, id)
    if (!dept.parentId) throw new BadRequestException('组织根部门不可删除')
    const departments = await this.prisma8.client.orm.public.Departments.where({ tenantId })
      .select('id', 'parentId')
      .all()
    const childrenMap = new Map<string, string[]>()
    departments.forEach((item) => {
      if (!item.parentId) return
      const children = childrenMap.get(item.parentId) ?? []
      children.push(item.id)
      childrenMap.set(item.parentId, children)
    })
    const subtreeIds: string[] = []
    const collectSubtree = (departmentId: string) => {
      subtreeIds.push(departmentId)
      childrenMap.get(departmentId)?.forEach(collectSubtree)
    }
    collectSubtree(id)

    const [users, scopedRoles] = await Promise.all([
      this.prisma8.client.orm.public.Users.where({ tenantId }).select('deptId').all(),
      this.prisma8.client.orm.public.Roles.where({ tenantId }).select('scopeDeptIds').all(),
    ])
    const subtree = new Set(subtreeIds)
    const userCount = users.filter((user) => user.deptId && subtree.has(user.deptId)).length
    const scopedRoleCount = scopedRoles.filter((role) =>
      (role.scopeDeptIds ?? []).some((deptId) => subtree.has(deptId)),
    ).length
    if (userCount > 0) throw new BadRequestException('当前部门或下级部门存在成员，无法删除')
    if (scopedRoleCount > 0) {
      throw new BadRequestException('当前部门或下级部门仍被角色数据范围使用，无法删除')
    }
    await this.prisma8.client.orm.public.Departments.where({ tenantId })
      .where((row) => row.id.in(subtreeIds))
      .deleteAll()
    await this.cache?.invalidate(tenantId, CACHE_NAMESPACE)
    return { id, name: dept.name, deletedCount: subtreeIds.length }
  }

  private async ensureExists(tenantId: string, id: string) {
    const dept = await this.prisma8.client.orm.public.Departments.where({ id, tenantId }).first()
    if (!dept) throw new NotFoundException('部门不存在')
    return dept
  }

  private async ensureNameFree(
    tenantId: string,
    name: string,
    parentId: string | null,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma8.client.orm.public.Departments.where({ tenantId, parentId })
      .where((row) => row.name.ilike(name))
      .select('id')
      .first()
    if (duplicate && duplicate.id !== excludeId) {
      throw new BadRequestException('同一上级部门下已存在同名部门')
    }
  }

  private async ensureLeaderCandidate(tenantId: string, departmentId: string, leaderId: string) {
    const user = await this.prisma8.client.orm.public.Users.where({
      id: leaderId,
      tenantId,
      status: 'ACTIVE',
    })
      .select('deptId')
      .first()
    if (!user) throw new BadRequestException('部门主管不存在或已停用')
    if (user.deptId !== departmentId) {
      throw new BadRequestException('部门主管必须是当前部门的直属成员')
    }
  }

  /** 防止把部门挂到自己的子孙节点下形成环 */
  private async ensureNotDescendant(tenantId: string, id: string, newParentId: string) {
    const all = await this.prisma8.client.orm.public.Departments.where({ tenantId })
      .select('id', 'parentId')
      .all()
    const parentMap = new Map(all.map((d) => [d.id, d.parentId]))
    let cursor: string | null = newParentId
    while (cursor) {
      if (cursor === id) throw new BadRequestException('不能移动到自己的下级部门')
      cursor = parentMap.get(cursor) ?? null
    }
  }

  private toLegacyDepartment(row: {
    id: string
    tenantId: string
    name: string
    parentId: string | null
    leaderId: string | null
    sort: number
    createdAt: Parameters<typeof prisma8TimestampToDate>[0]
    updatedAt: Parameters<typeof prisma8TimestampToDate>[0]
  }) {
    return {
      ...row,
      createdAt: prisma8TimestampToDate(row.createdAt),
      updatedAt: prisma8TimestampToDate(row.updatedAt),
    }
  }
}
