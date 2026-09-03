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
  type MemberVO,
  type PaginatedResult,
} from '@micromatrix/shared'
import { DataScope, Prisma, Role } from '../../generated/prisma/client'
import type { AuthUser } from '../../common/auth-user'
import { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { DataScopeService } from '../../common/services/data-scope.service'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateRoleDto, QueryRoleMembersDto, UpdateRoleDto } from './dto/role.dto'

type RoleWithCount = Role & { _count?: { userRoles: number } }

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly authCache: AuthContextCacheService,
  ) {}

  async findAll(tenantId: string): Promise<RoleVO[]> {
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      include: { _count: { select: { userRoles: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return roles.map((r) => ({ ...this.toVO(r), userCount: r._count.userRoles }))
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
    const affectedUsers = await this.prisma.userRole.findMany({
      where: { tenantId: user.tenantId, roleId: id },
      select: { userId: true },
    })
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
    await this.authCache.invalidateMany(affectedUsers.map(({ userId }) => userId))
    return this.toVO(updated)
  }

  async remove(tenantId: string, id: string) {
    const role = await this.ensureExists(tenantId, id)
    if (role.isSystem) throw new BadRequestException('系统内置角色不可删除')
    const soleRoleMemberCount = await this.prisma.user.count({
      where: {
        tenantId,
        userRoles: {
          some: { roleId: id },
          none: { roleId: { not: id } },
        },
      },
    })
    if (soleRoleMemberCount > 0) {
      throw new BadRequestException('该角色仍是部分成员的唯一角色，请先为其分配其他角色')
    }
    const affectedUsers = await this.prisma.userRole.findMany({
      where: { tenantId, roleId: id },
      select: { userId: true },
    })
    await this.prisma.role.delete({ where: { id } })
    await this.authCache.invalidateMany(affectedUsers.map(({ userId }) => userId))
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

  async members(
    tenantId: string,
    roleId: string,
    query: QueryRoleMembersDto,
  ): Promise<PaginatedResult<MemberVO>> {
    await this.ensureExists(tenantId, roleId)
    const { page = 1, pageSize = 10, keyword } = query
    const where: Prisma.UserWhereInput = {
      tenantId,
      userRoles: { some: { roleId } },
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { email: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { userRoles: { include: { role: true } }, dept: true },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ])
    const leaderIds = users.map((user) => user.leaderId).filter((id): id is string => !!id)
    const leaders = leaderIds.length
      ? await this.prisma.user.findMany({
          where: { tenantId, id: { in: leaderIds } },
          select: { id: true, name: true },
        })
      : []
    const leaderMap = new Map(leaders.map((leader) => [leader.id, leader.name]))
    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        roles: user.userRoles.map(({ role }) => ({ id: role.id, name: role.name })),
        roleIds: user.userRoles.map(({ roleId: id }) => id),
        deptId: user.deptId,
        deptName: user.dept?.name ?? null,
        leaderId: user.leaderId,
        leaderName: user.leaderId ? (leaderMap.get(user.leaderId) ?? null) : null,
        position: user.position,
        phone: user.phone,
        passwordLoginEnabled: user.passwordLoginEnabled,
        createdAt: user.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    }
  }

  async addMembers(actor: AuthUser, roleId: string, userIds: string[]) {
    const tenantId = actor.tenantId
    await this.assertRolesAssignable(actor, [roleId])
    const ids = [...new Set(userIds)]
    const count = await this.prisma.user.count({ where: { tenantId, id: { in: ids } } })
    if (count !== ids.length) throw new BadRequestException('成员不存在或不属于当前租户')
    await this.prisma.userRole.createMany({
      data: ids.map((userId) => ({ tenantId, roleId, userId })),
      skipDuplicates: true,
    })
    await this.authCache.invalidateMany(ids)
    return { roleId, userIds: ids }
  }

  async removeMember(actor: AuthUser, roleId: string, userId: string) {
    const tenantId = actor.tenantId
    const [role] = await this.assertRolesAssignable(actor, [roleId])
    if (role.isSystem) throw new BadRequestException('不能从系统内置角色移除成员')
    const relation = await this.prisma.userRole.findFirst({ where: { tenantId, roleId, userId } })
    if (!relation) throw new NotFoundException('该成员未关联此角色')
    const roleCount = await this.prisma.userRole.count({ where: { tenantId, userId } })
    if (roleCount <= 1) throw new BadRequestException('成员至少需要保留一个角色')
    await this.prisma.userRole.delete({ where: { id: relation.id } })
    await this.authCache.invalidate(userId)
    return { roleId, userId }
  }

  async assertRolesAssignable(actor: AuthUser, roleIds: string[]) {
    const ids = [...new Set(roleIds)]
    const roles = await this.prisma.role.findMany({
      where: { tenantId: actor.tenantId, id: { in: ids } },
    })
    if (roles.length !== ids.length) throw new BadRequestException('角色不存在或不属于当前租户')
    if (actor.permissions.includes('*')) return roles
    for (const role of roles) {
      if (role.isSystem) throw new ForbiddenException('不能分配系统内置角色')
      const unauthorized = role.permissions.filter((code) => !actor.permissions.includes(code))
      if (unauthorized.length > 0) throw new ForbiddenException('不能分配权限高于自己的角色')
      for (const permission of role.permissions) {
        await this.assertScopeGrant(actor, permission, role.dataScope, role.scopeDeptIds)
      }
    }
    return roles
  }

  private toVO(role: RoleWithCount): RoleVO {
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
      for (const permission of permissions) {
        await this.assertScopeGrant(actor, permission, dataScope, scopeDeptIds)
      }
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

  private async assertScopeGrant(
    actor: AuthUser,
    permission: string,
    target: DataScope,
    targetDeptIds: string[],
  ) {
    if (target === 'SELF') return
    const effective = await this.dataScope.resolveScope(actor, permission)
    if (effective.all) return
    if (target !== 'CUSTOM') {
      throw new ForbiddenException('动态部门范围仅允许由拥有全部数据权限的用户授予')
    }
    const allowed = new Set(effective.deptIds)
    const expanded = await this.dataScope.collectManyWithDescendants(actor.tenantId, targetDeptIds)
    if (expanded.some((id) => !allowed.has(id))) {
      throw new ForbiddenException('自定义部门超出当前用户在该权限下的数据范围')
    }
  }
}
