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
import { or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampToISOString } from '../../prisma/prisma8-temporal'
import { CreateRoleDto, QueryRoleMembersDto, UpdateRoleDto } from './dto/role.dto'

type DataScope = CreateRoleDto['dataScope']

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly dataScope: DataScopeService,
    private readonly authCache: AuthContextCacheService,
  ) {}

  async findAll(tenantId: string): Promise<RoleVO[]> {
    const [roles, counts] = await Promise.all([
      this.prisma8.client.orm.public.Roles.where({ tenantId })
        .orderBy((role) => role.createdAt.asc())
        .all(),
      this.prisma8.client.orm.public.UserRoles.where({ tenantId })
        .groupBy('roleId')
        .aggregate((agg) => ({ count: agg.count() })),
    ])
    const countMap = new Map(counts.map((item) => [item.roleId, item.count]))
    return roles.map((role) => ({ ...this.toVO(role), userCount: countMap.get(role.id) ?? 0 }))
  }

  async options(tenantId: string) {
    return this.prisma8.client.orm.public.Roles.where({ tenantId })
      .select('id', 'name')
      .orderBy((role) => role.createdAt.asc())
      .all()
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
    const role = await this.prisma8.client.orm.public.Roles.create({
      tenantId: user.tenantId,
      name,
      permissions: normalized.permissions,
      dataScope: normalized.dataScope,
      scopeDeptIds: normalized.scopeDeptIds,
      remark: dto.remark?.trim() || null,
      updatedAt: prisma8Now(),
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
      dto.scopeDeptIds ?? [...(role.scopeDeptIds ?? [])],
      dto.permissions ?? [...(role.permissions ?? [])],
    )
    const affectedUsers = await this.prisma8.client.orm.public.UserRoles.where({
      tenantId: user.tenantId,
      roleId: id,
    })
      .select('userId')
      .all()
    const updated = await this.prisma8.client.orm.public.Roles.where({ id }).update({
      ...(name === undefined ? {} : { name }),
      permissions: normalized.permissions,
      dataScope: normalized.dataScope,
      scopeDeptIds: normalized.scopeDeptIds,
      ...(dto.remark === undefined ? {} : { remark: dto.remark.trim() || null }),
      updatedAt: prisma8Now(),
    })
    if (!updated) throw new NotFoundException('角色不存在')
    await this.authCache.invalidateMany(affectedUsers.map(({ userId }) => userId))
    return this.toVO(updated)
  }

  async remove(tenantId: string, id: string) {
    const role = await this.ensureExists(tenantId, id)
    if (role.isSystem) throw new BadRequestException('系统内置角色不可删除')
    const affectedUsers = await this.prisma8.client.orm.public.UserRoles.where({ tenantId, roleId: id })
      .select('userId')
      .all()
    const affectedUserIds = [...new Set(affectedUsers.map(({ userId }) => userId))]
    const roleCounts = affectedUserIds.length
      ? await this.prisma8.client.orm.public.UserRoles.where({ tenantId })
          .where((relation) => relation.userId.in(affectedUserIds))
          .groupBy('userId')
          .aggregate((agg) => ({ count: agg.count() }))
      : []
    if (roleCounts.some((item) => item.count <= 1)) {
      throw new BadRequestException('该角色仍是部分成员的唯一角色，请先为其分配其他角色')
    }
    await this.prisma8.client.orm.public.Roles.where({ id }).deleteAndCount()
    await this.authCache.invalidateMany(affectedUsers.map(({ userId }) => userId))
    return { id, name: role.name }
  }

  private async ensureNameFree(tenantId: string, name: string, excludeId?: string) {
    let query = this.prisma8.client.orm.public.Roles.where({ tenantId }).where((role) => role.name.ilike(name))
    if (excludeId) query = query.where((role) => role.id.neq(excludeId))
    const exists = await query.select('id').first()
    if (exists) throw new ConflictException('角色名称已存在')
  }

  private async ensureExists(tenantId: string, id: string) {
    const role = await this.prisma8.client.orm.public.Roles.where({ id, tenantId }).first()
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
    const roleRelations = await this.prisma8.client.orm.public.UserRoles.where({ tenantId, roleId })
      .select('userId')
      .all()
    const roleUserIds = [...new Set(roleRelations.map(({ userId }) => userId))]
    if (!roleUserIds.length) return { items: [], total: 0, page, pageSize }
    let usersQuery = this.prisma8.client.orm.public.Users.where({ tenantId }).where((user) =>
      user.id.in(roleUserIds),
    )
    if (keyword) {
      usersQuery = usersQuery.where((user) =>
        or(user.name.ilike(`%${keyword}%`), user.email.ilike(`%${keyword}%`)),
      )
    }
    const [users, aggregate] = await Promise.all([
      usersQuery
        .orderBy((user) => user.createdAt.asc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      usersQuery.aggregate((agg) => ({ count: agg.count() })),
    ])
    const userIds = users.map((user) => user.id)
    const userRoles = userIds.length
      ? await this.prisma8.client.orm.public.UserRoles.where({ tenantId })
          .where((relation) => relation.userId.in(userIds))
          .select('userId', 'roleId')
          .all()
      : []
    const relatedRoleIds = [...new Set(userRoles.map((relation) => relation.roleId))]
    const roles = relatedRoleIds.length
      ? await this.prisma8.client.orm.public.Roles.where({ tenantId })
          .where((role) => role.id.in(relatedRoleIds))
          .select('id', 'name')
          .all()
      : []
    const roleMap = new Map(roles.map((role) => [role.id, role.name]))
    const rolesByUser = new Map<string, string[]>()
    for (const relation of userRoles) {
      rolesByUser.set(relation.userId, [...(rolesByUser.get(relation.userId) ?? []), relation.roleId])
    }
    const deptIds = [...new Set(users.map((user) => user.deptId).filter((id): id is string => !!id))]
    const departments = deptIds.length
      ? await this.prisma8.client.orm.public.Departments.where({ tenantId })
          .where((department) => department.id.in(deptIds))
          .select('id', 'name')
          .all()
      : []
    const deptMap = new Map(departments.map((department) => [department.id, department.name]))
    const leaderIds = users.map((user) => user.leaderId).filter((id): id is string => !!id)
    const leaders = leaderIds.length
      ? await this.prisma8.client.orm.public.Users.where({ tenantId })
          .where((user) => user.id.in(leaderIds))
          .select('id', 'name')
          .all()
      : []
    const leaderMap = new Map(leaders.map((leader) => [leader.id, leader.name]))
    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        roles: (rolesByUser.get(user.id) ?? []).map((id) => ({ id, name: roleMap.get(id) ?? id })),
        roleIds: rolesByUser.get(user.id) ?? [],
        deptId: user.deptId,
        deptName: user.deptId ? (deptMap.get(user.deptId) ?? null) : null,
        leaderId: user.leaderId,
        leaderName: user.leaderId ? (leaderMap.get(user.leaderId) ?? null) : null,
        position: user.position,
        phone: user.phone,
        passwordLoginEnabled: user.passwordLoginEnabled,
        createdAt: prisma8TimestampToISOString(user.createdAt),
      })),
      total: aggregate.count,
      page,
      pageSize,
    }
  }

  async addMembers(actor: AuthUser, roleId: string, userIds: string[]) {
    const tenantId = actor.tenantId
    await this.assertRolesAssignable(actor, [roleId])
    const ids = [...new Set(userIds)]
    const users = await this.prisma8.client.orm.public.Users.where({ tenantId })
      .where((user) => user.id.in(ids))
      .select('id')
      .all()
    if (users.length !== ids.length) throw new BadRequestException('成员不存在或不属于当前租户')
    const existing = await this.prisma8.client.orm.public.UserRoles.where({ tenantId, roleId })
      .where((relation) => relation.userId.in(ids))
      .select('userId')
      .all()
    const existingIds = new Set(existing.map(({ userId }) => userId))
    for (const userId of ids.filter((id) => !existingIds.has(id))) {
      try {
        await this.prisma8.client.orm.public.UserRoles.create({
          tenantId,
          roleId,
          userId,
          updatedAt: prisma8Now(),
        })
      } catch (error) {
        if ((error as { sqlState?: string }).sqlState !== '23505') throw error
      }
    }
    await this.authCache.invalidateMany(ids)
    return { roleId, userIds: ids }
  }

  async removeMember(actor: AuthUser, roleId: string, userId: string) {
    const tenantId = actor.tenantId
    const [role] = await this.assertRolesAssignable(actor, [roleId])
    if (role.isSystem) throw new BadRequestException('不能从系统内置角色移除成员')
    const relation = await this.prisma8.client.orm.public.UserRoles.where({ tenantId, roleId, userId }).first()
    if (!relation) throw new NotFoundException('该成员未关联此角色')
    const roleCount = await this.prisma8.client.orm.public.UserRoles.where({ tenantId, userId })
      .aggregate((agg) => ({ count: agg.count() }))
    if (roleCount.count <= 1) throw new BadRequestException('成员至少需要保留一个角色')
    await this.prisma8.client.orm.public.UserRoles.where({ id: relation.id }).deleteAndCount()
    await this.authCache.invalidate(userId)
    return { roleId, userId }
  }

  async assertRolesAssignable(actor: AuthUser, roleIds: string[]) {
    const ids = [...new Set(roleIds)]
    const roles = await this.prisma8.client.orm.public.Roles.where({ tenantId: actor.tenantId })
      .where((role) => role.id.in(ids))
      .all()
    if (roles.length !== ids.length) throw new BadRequestException('角色不存在或不属于当前租户')
    if (actor.permissions.includes('*')) return roles
    for (const role of roles) {
      if (role.isSystem) throw new ForbiddenException('不能分配系统内置角色')
      const permissions = role.permissions ?? []
      const scopeDeptIds = role.scopeDeptIds ?? []
      const unauthorized = permissions.filter((code) => !actor.permissions.includes(code))
      if (unauthorized.length > 0) throw new ForbiddenException('不能分配权限高于自己的角色')
      for (const permission of permissions) {
        await this.assertScopeGrant(actor, permission, role.dataScope, [...scopeDeptIds])
      }
    }
    return roles
  }

  private toVO(role: Awaited<ReturnType<RolesService['ensureExists']>>): RoleVO {
    return {
      id: role.id,
      name: role.name,
      permissions: [...(role.permissions ?? [])],
      dataScope: role.dataScope,
      scopeDeptIds: [...(role.scopeDeptIds ?? [])],
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
      const departments = await this.prisma8.client.orm.public.Departments.where({
        tenantId: actor.tenantId,
      })
        .where((department) => department.id.in(scopeDeptIds))
        .select('id')
        .all()
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
