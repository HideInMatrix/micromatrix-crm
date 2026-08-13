import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { RoleVO } from '@micromatrix/shared'
import { Prisma, Role } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto'

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string): Promise<RoleVO[]> {
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return roles.map((r) => ({ ...this.toVO(r), userCount: r._count.users }))
  }

  async create(tenantId: string, dto: CreateRoleDto): Promise<RoleVO> {
    await this.ensureNameFree(tenantId, dto.name)
    const role = await this.prisma.role.create({
      data: { tenantId, ...dto },
    })
    return this.toVO(role)
  }

  async update(tenantId: string, id: string, dto: UpdateRoleDto): Promise<RoleVO> {
    const role = await this.ensureExists(tenantId, id)
    if (role.isSystem) throw new BadRequestException('系统内置角色不可修改')
    if (dto.name && dto.name !== role.name) await this.ensureNameFree(tenantId, dto.name)
    const updated = await this.prisma.role.update({ where: { id }, data: dto })
    return this.toVO(updated)
  }

  async remove(tenantId: string, id: string) {
    const role = await this.ensureExists(tenantId, id)
    if (role.isSystem) throw new BadRequestException('系统内置角色不可删除')
    const userCount = await this.prisma.user.count({ where: { tenantId, roleId: id } })
    if (userCount > 0) throw new BadRequestException('角色下存在成员，无法删除')
    await this.prisma.role.delete({ where: { id } })
    return { id, name: role.name }
  }

  private async ensureNameFree(tenantId: string, name: string) {
    const exists = await this.prisma.role.findFirst({ where: { tenantId, name } })
    if (exists) throw new ConflictException('角色名称已存在')
  }

  private async ensureExists(tenantId: string, id: string) {
    const role = await this.prisma.role.findFirst({ where: { id, tenantId } })
    if (!role) throw new NotFoundException('角色不存在')
    return role
  }

  private toVO(role: Role | (Role & { _count?: Prisma.RoleCountOutputType })): RoleVO {
    return {
      id: role.id,
      name: role.name,
      permissions: role.permissions,
      dataScope: role.dataScope,
      scopeDeptIds: role.scopeDeptIds,
      isSystem: role.isSystem,
      remark: role.remark,
    }
  }
}
