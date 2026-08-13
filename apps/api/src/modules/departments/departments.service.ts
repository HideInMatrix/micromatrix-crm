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
    if (dto.parentId) await this.ensureExists(tenantId, dto.parentId)
    return this.prisma.department.create({
      data: { tenantId, ...dto },
    })
  }

  async update(tenantId: string, id: string, dto: UpdateDepartmentDto) {
    await this.ensureExists(tenantId, id)
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('不能将自身设为上级部门')
      await this.ensureExists(tenantId, dto.parentId)
      await this.ensureNotDescendant(tenantId, id, dto.parentId)
    }
    return this.prisma.department.update({ where: { id }, data: dto })
  }

  async remove(tenantId: string, id: string) {
    const dept = await this.ensureExists(tenantId, id)
    const [childCount, userCount] = await Promise.all([
      this.prisma.department.count({ where: { tenantId, parentId: id } }),
      this.prisma.user.count({ where: { tenantId, deptId: id } }),
    ])
    if (childCount > 0) throw new BadRequestException('请先删除下级部门')
    if (userCount > 0) throw new BadRequestException('部门下存在成员，无法删除')
    await this.prisma.department.delete({ where: { id } })
    return { id, name: dept.name }
  }

  private async ensureExists(tenantId: string, id: string) {
    const dept = await this.prisma.department.findFirst({ where: { id, tenantId } })
    if (!dept) throw new NotFoundException('部门不存在')
    return dept
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
