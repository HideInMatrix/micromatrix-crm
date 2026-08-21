import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { DepartmentVO } from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto'

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async tree(tenantId: string): Promise<DepartmentVO[]> {
    const [departments, users] = await Promise.all([
      this.prisma.department.findMany({
        where: { tenantId },
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.user.findMany({
        where: { tenantId },
        select: { id: true, name: true, deptId: true },
      }),
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
    return this.prisma.department.create({
      data: { tenantId, name, parentId, sort: dto.sort ?? 0 },
    })
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
    return this.prisma.department.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name }),
        ...(dto.parentId === undefined ? {} : { parentId }),
        ...(dto.leaderId === undefined ? {} : { leaderId: dto.leaderId || null }),
        ...(dto.sort === undefined ? {} : { sort: dto.sort }),
      },
    })
  }

  async remove(tenantId: string, id: string) {
    const dept = await this.ensureExists(tenantId, id)
    if (!dept.parentId) throw new BadRequestException('组织根部门不可删除')
    const [childCount, userCount, scopedRoleCount] = await Promise.all([
      this.prisma.department.count({ where: { tenantId, parentId: id } }),
      this.prisma.user.count({ where: { tenantId, deptId: id } }),
      this.prisma.role.count({ where: { tenantId, scopeDeptIds: { has: id } } }),
    ])
    if (childCount > 0) throw new BadRequestException('请先删除下级部门')
    if (userCount > 0) throw new BadRequestException('部门下存在成员，无法删除')
    if (scopedRoleCount > 0) throw new BadRequestException('部门仍被角色自定义数据范围使用，无法删除')
    await this.prisma.department.delete({ where: { id } })
    return { id, name: dept.name }
  }

  private async ensureExists(tenantId: string, id: string) {
    const dept = await this.prisma.department.findFirst({ where: { id, tenantId } })
    if (!dept) throw new NotFoundException('部门不存在')
    return dept
  }

  private async ensureNameFree(
    tenantId: string,
    name: string,
    parentId: string | null,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.department.findFirst({
      where: {
        tenantId,
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    })
    if (duplicate) throw new BadRequestException('同一上级部门下已存在同名部门')
  }

  private async ensureLeaderCandidate(tenantId: string, departmentId: string, leaderId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: leaderId, tenantId, status: 'ACTIVE' },
      select: { deptId: true },
    })
    if (!user) throw new BadRequestException('部门主管不存在或已停用')
    if (user.deptId !== departmentId) {
      throw new BadRequestException('部门主管必须是当前部门的直属成员')
    }
  }

  /** 防止把部门挂到自己的子孙节点下形成环 */
  private async ensureNotDescendant(tenantId: string, id: string, newParentId: string) {
    const all = await this.prisma.department.findMany({
      where: { tenantId },
      select: { id: true, parentId: true },
    })
    const parentMap = new Map(all.map((d) => [d.id, d.parentId]))
    let cursor: string | null = newParentId
    while (cursor) {
      if (cursor === id) throw new BadRequestException('不能移动到自己的下级部门')
      cursor = parentMap.get(cursor) ?? null
    }
  }
}
