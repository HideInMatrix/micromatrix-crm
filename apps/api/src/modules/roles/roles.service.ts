import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  flattenPermissionCodes,
  permissionAncestorMap,
  RoleVO,
} from '@micromatrix/shared'
import { DataScope, Prisma, Role } from '../../generated/prisma/client'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto'

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async findAll(tenantId: string): Promise<RoleVO[]> {
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return roles.map((r) => ({ ...this.toVO(r), userCount: r._count.users }))
  }

  async options(tenantId: string) {
    return this.prisma.role.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async create(user: AuthUser, dto: CreateRoleDto): Promise<RoleVO> {
    const name = dto.name.trim()
    await this.ensureNameFree(user.tenantId, name)
    const normalized = await this.normalizeRoleSettings(
      user,
      dto.dataScope,
      dto.scopeDeptIds,
      dto.permissions,
    )
    const role = await this.prisma.role.create({
      data: {
        tenantId: user.tenantId,
        name,
        permissions: normalized.permissions,
        dataScope: normalized.dataScope,
        scopeDeptIds: normalized.scopeDeptIds,
        remark: dto.remark?.trim() || null,
      },
    })
    return this.toVO(role)
  }

  async update(user: AuthUser, id: string, dto: UpdateRoleDto): Promise<RoleVO> {
    const role = await this.ensureExists(user.tenantId, id)
    if (role.isSystem) throw new BadRequestException('系统内置角色不可修改')
    const name = dto.name?.trim()
    if (name && name !== role.name) await this.ensureNameFree(user.tenantId, name, id)

    const normalized = await this.normalizeRoleSettings(
      user,
      dto.dataScope ?? role.dataScope,
      dto.scopeDeptIds ?? role.scopeDeptIds,
      dto.permissions ?? role.permissions,
    )
    const updated = await this.prisma.role.update({
      where: { id },
      data: {
        ...(name === undefined ? {} : { name }),
        permissions: normalized.permissions,
        dataScope: normalized.dataScope,
        scopeDeptIds: normalized.scopeDeptIds,
        ...(dto.remark === undefined ? {} : { remark: dto.remark.trim() || null }),
      },
    })
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

  private async ensureNameFree(tenantId: string, name: string, excludeId?: string) {
    const exists = await this.prisma.role.findFirst({
      where: {
        tenantId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    })
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

  private async normalizeRoleSettings(
    actor: AuthUser,
    dataScope: DataScope,
    requestedDeptIds: string[] | undefined,
    requestedPermissions: string[],
  ) {
    const scopeDeptIds =
      dataScope === 'CUSTOM' ? [...new Set((requestedDeptIds ?? []).filter(Boolean))] : []
    if (dataScope === 'CUSTOM' && scopeDeptIds.length === 0) {
      throw new BadRequestException('自定义数据范围至少选择一个部门')
    }
    if (scopeDeptIds.length > 0) {
      const departments = await this.prisma.department.findMany({
        where: { tenantId: actor.tenantId, id: { in: scopeDeptIds } },
        select: { id: true },
      })
      if (departments.length !== scopeDeptIds.length) {
        throw new BadRequestException('自定义数据范围包含无效或跨租户部门')
      }
    }

    const permissions = this.normalizePermissions(requestedPermissions)
    if (!actor.permissions.includes('*')) {
      const unauthorized = permissions.filter((code) => !actor.permissions.includes(code))
      if (unauthorized.length > 0) throw new ForbiddenException('不能授予自己不具备的功能权限')
      await this.assertScopeGrant(actor, dataScope, scopeDeptIds)
    }
    return { permissions, dataScope, scopeDeptIds }
  }

  private normalizePermissions(requested: string[]) {
    if (requested.includes('*')) throw new BadRequestException('通配权限仅允许系统内置角色使用')
    const validCodes = new Set(flattenPermissionCodes())
    const unknown = requested.filter((code) => !validCodes.has(code))
    if (unknown.length > 0) throw new BadRequestException(`存在未知权限码：${unknown.join(', ')}`)

    const ancestors = permissionAncestorMap()
    const normalized = new Set(requested)
    requested.forEach((code) => ancestors.get(code)?.forEach((parent) => normalized.add(parent)))
    return [...normalized]
  }

  private async assertScopeGrant(actor: AuthUser, target: DataScope, targetDeptIds: string[]) {
    if (actor.dataScope === 'ALL') return
    if (actor.dataScope === 'SELF') {
      if (target !== 'SELF') throw new ForbiddenException('不能授予比自身更宽的数据范围')
      return
    }
    if (actor.dataScope === 'DEPT') {
      if (!['SELF', 'DEPT'].includes(target)) {
        throw new ForbiddenException('不能授予比自身更宽的数据范围')
      }
      return
    }
    if (actor.dataScope === 'DEPT_AND_CHILD') {
      if (['SELF', 'DEPT', 'DEPT_AND_CHILD'].includes(target)) return
      if (target !== 'CUSTOM' || !actor.deptId) {
        throw new ForbiddenException('不能授予比自身更宽的数据范围')
      }
      const actorDeptIds = new Set(
        await this.dataScope.collectWithDescendants(actor.tenantId, actor.deptId),
      )
      const targetDeptIdsExpanded = await this.dataScope.collectManyWithDescendants(
        actor.tenantId,
        targetDeptIds,
      )
      if (targetDeptIdsExpanded.some((id) => !actorDeptIds.has(id))) {
        throw new ForbiddenException('自定义部门超出当前用户的数据范围')
      }
      return
    }
    if (actor.dataScope === 'CUSTOM') {
      if (target === 'SELF') return
      if (target !== 'CUSTOM') throw new ForbiddenException('不能授予比自身更宽的数据范围')
      const actorDeptIds = new Set(
        await this.dataScope.collectManyWithDescendants(actor.tenantId, actor.scopeDeptIds),
      )
      const targetDeptIdsExpanded = await this.dataScope.collectManyWithDescendants(
        actor.tenantId,
        targetDeptIds,
      )
      if (targetDeptIdsExpanded.some((id) => !actorDeptIds.has(id))) {
        throw new ForbiddenException('自定义部门超出当前用户的数据范围')
      }
    }
  }
}
