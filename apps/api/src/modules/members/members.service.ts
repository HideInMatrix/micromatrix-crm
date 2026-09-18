import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { MemberVO, PaginatedResult } from '@micromatrix/shared'
import { or } from '@prisma/orm-postgres/orm-client'
import * as bcrypt from 'bcryptjs'
import type { AuthUser } from '../../common/auth-user'
import { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampToDate } from '../../prisma/prisma8-temporal'
import { prisma8Varchar } from '../../prisma/prisma8-varchar'
import { RolesService } from '../roles/roles.service'
import { CreateMemberDto, QueryMembersDto, UpdateMemberDto } from './dto/member.dto'

type MemberRow = {
  id: string
  email: string | null
  name: string
  status: MemberVO['status']
  deptId: string | null
  leaderId: string | null
  position: string | null
  phone: string | null
  passwordLoginEnabled: boolean
  createdAt: Parameters<typeof prisma8TimestampToDate>[0]
}

const DIRECTORY_CACHE_NAMESPACE = 'directory'
const DIRECTORY_CACHE_TTL_SECONDS = 3 * 60

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly rolesService: RolesService,
    private readonly authCache: AuthContextCacheService,
    @Optional() private readonly cache?: TenantDerivedCacheService,
  ) {}

  async findAll(tenantId: string, query: QueryMembersDto): Promise<PaginatedResult<MemberVO>> {
    const { page = 1, pageSize = 10, keyword, deptId, status } = query
    let users = this.prisma8.client.orm.public.Users.where({ tenantId })
    if (deptId) users = users.where({ deptId })
    if (status) users = users.where({ status })
    if (keyword) {
      const pattern = `%${keyword}%`
      users = users.where((user) =>
        or(user.name.ilike(pattern), user.email.ilike(pattern), user.phone.ilike(pattern)),
      )
    }
    const [rows, total] = await Promise.all([
      users
        .orderBy((user) => user.createdAt.asc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      users.aggregate((agg) => ({ count: agg.count() })),
    ])

    return {
      items: await this.toVOs(tenantId, rows),
      total: total.count,
      page,
      pageSize,
    }
  }

  async options(tenantId: string) {
    const loader = async () =>
      await this.prisma8.client.orm.public.Users.where({ tenantId, status: 'ACTIVE' })
        .select('id', 'name', 'deptId')
        .orderBy((user) => user.createdAt.asc())
        .all()
    if (!this.cache) return loader()
    return this.cache.remember({
      tenantId,
      namespace: DIRECTORY_CACHE_NAMESPACE,
      key: 'members-options',
      ttlSeconds: DIRECTORY_CACHE_TTL_SECONDS,
      loader,
    })
  }

  async create(actor: AuthUser, dto: CreateMemberDto): Promise<MemberVO> {
    const tenantId = actor.tenantId
    const roleIds = [...new Set(dto.roleIds)]
    const exists = await this.prisma8.client.orm.public.Users.where({ email: dto.email })
      .select('id')
      .first()
    if (exists) throw new ConflictException('该邮箱已被使用')

    if (!dto.deptId) throw new BadRequestException('请选择成员所属部门')
    await this.rolesService.assertRolesAssignable(actor, roleIds)
    await this.validateReferences(tenantId, dto)
    await this.ensurePhoneFree(tenantId, dto.phone)

    const passwordHash = await bcrypt.hash(dto.password, 10)
    const now = prisma8Now()
    const user = await this.prisma8.client.transaction(async (tx) => {
      const created = await tx.orm.public.Users.create({
        tenantId,
        email: dto.email,
        name: dto.name.trim(),
        passwordHash,
        defaultPwd: true,
        deptId: dto.deptId,
        leaderId: dto.leaderId ?? null,
        position: dto.position ?? null,
        phone: dto.phone ?? null,
        updatedAt: now,
      })
      await tx.orm.public.UserRoles.createAll(
        roleIds.map((roleId) => ({ tenantId, userId: created.id, roleId, updatedAt: now })),
      )
      return created
    })
    await this.cache?.invalidate(tenantId, DIRECTORY_CACHE_NAMESPACE)
    return (await this.toVOs(tenantId, [user]))[0]!
  }

  async update(actor: AuthUser, id: string, dto: UpdateMemberDto): Promise<MemberVO> {
    const tenantId = actor.tenantId
    const current = await this.ensureExists(tenantId, id)
    if (dto.roleIds !== undefined) {
      const currentRoleIds = await this.prisma8.client.orm.public.UserRoles.where({ tenantId, userId: id })
        .select('roleId')
        .all()
      await this.rolesService.assertRolesAssignable(
        actor,
        currentRoleIds.map(({ roleId }) => roleId),
      )
      await this.rolesService.assertRolesAssignable(actor, dto.roleIds)
    }
    if (dto.leaderId === id) throw new BadRequestException('直属上级不能是自己')
    await this.validateReferences(tenantId, dto, id)
    await this.ensurePhoneFree(tenantId, dto.phone, id)

    const nextDeptId = dto.deptId === undefined ? current.deptId : dto.deptId
    const user = await this.prisma8.client.transaction(async (tx) => {
      const updatedAt = prisma8Now()
      if (dto.deptId !== undefined && nextDeptId !== current.deptId) {
        let departments = tx.orm.public.Departments.where({ tenantId, leaderId: id })
        if (nextDeptId) departments = departments.where((department) => department.id.neq(nextDeptId))
        await departments.updateAndCount({ leaderId: null, updatedAt })
      }
      if (dto.roleIds !== undefined) {
        await tx.orm.public.UserRoles.where({ tenantId, userId: id }).deleteAndCount()
        if (dto.roleIds.length) {
          await tx.orm.public.UserRoles.createAll(
            [...new Set(dto.roleIds)].map((roleId) => ({ tenantId, userId: id, roleId, updatedAt })),
          )
        }
      }
      const updated = await tx.orm.public.Users.where({ id, tenantId }).update({
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.deptId === undefined ? {} : { deptId: dto.deptId }),
        ...(dto.leaderId === undefined ? {} : { leaderId: dto.leaderId }),
        ...(dto.position === undefined ? {} : { position: dto.position }),
        ...(dto.phone === undefined ? {} : { phone: dto.phone }),
        updatedAt,
      })
      if (!updated) throw new NotFoundException('成员不存在')
      return updated
    })
    await this.authCache.invalidate(id)
    await this.cache?.invalidate(tenantId, DIRECTORY_CACHE_NAMESPACE)
    return (await this.toVOs(tenantId, [user]))[0]!
  }

  async resetPassword(tenantId: string, id: string, password: string) {
    const user = await this.ensureExists(tenantId, id)
    await this.prisma8.client.orm.public.Users.where({ id, tenantId }).update({
      passwordHash: await bcrypt.hash(password, 10),
      defaultPwd: true,
      updatedAt: prisma8Now(),
    })
    await this.authCache.invalidate(id)
    return { id, name: user.name }
  }

  async toggleStatus(tenantId: string, operatorId: string, id: string) {
    if (operatorId === id) throw new BadRequestException('不能禁用自己的账号')
    const user = await this.ensureExists(tenantId, id)
    const nextStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    const subordinateIds =
      nextStatus === 'DISABLED'
        ? (
            await this.prisma8.client.orm.public.Users.where({ tenantId, leaderId: id })
              .select('id')
              .all()
          ).map(({ id: subordinateId }) => subordinateId)
        : []
    const updated = await this.prisma8.client.transaction(async (tx) => {
      const updatedAt = prisma8Now()
      if (nextStatus === 'DISABLED') {
        await tx.orm.public.Departments.where({ tenantId, leaderId: id }).updateAndCount({
          leaderId: null,
          updatedAt,
        })
        await tx.orm.public.Users.where({ tenantId, leaderId: id }).updateAndCount({
          leaderId: null,
          updatedAt,
        })
      }
      const row = await tx.orm.public.Users.where({ id, tenantId }).update({
        status: nextStatus,
        updatedAt,
      })
      if (!row) throw new NotFoundException('成员不存在')
      return row
    })
    await this.authCache.invalidateMany([id, ...subordinateIds])
    await this.cache?.invalidate(tenantId, DIRECTORY_CACHE_NAMESPACE)
    return { id, name: updated.name, status: updated.status }
  }

  async remove(tenantId: string, operatorId: string, id: string) {
    if (operatorId === id) throw new BadRequestException('不能删除自己的账号')
    const user = await this.ensureExists(tenantId, id)
    const organizationId = prisma8Varchar(tenantId, 32)
    const memberId = prisma8Varchar(id, 32)
    const customerIds = await this.prisma8.client.orm.public.Customer.where({ organizationId })
      .select('id')
      .all()
    const [
      customers,
      contacts,
      clues,
      opportunities,
      quotations,
      contracts,
      payments,
      invoices,
      orders,
      followUps,
      collaborations,
      approvalInstances,
      approvalTasks,
    ] = await Promise.all([
      this.prisma8.client.orm.public.Customer.where({ organizationId, owner: memberId }).aggregate(
        (agg) => ({ count: agg.count() }),
      ),
      this.prisma8.client.orm.public.CustomerContact.where({ organizationId, owner: memberId }).aggregate(
        (agg) => ({ count: agg.count() }),
      ),
      this.prisma8.client.orm.public.Clue.where({ organizationId, owner: memberId }).aggregate((agg) => ({
        count: agg.count(),
      })),
      this.prisma8.client.orm.public.Opportunity.where({ organizationId, owner: memberId }).aggregate(
        (agg) => ({ count: agg.count() }),
      ),
      this.prisma8.client.orm.public.OpportunityQuotation.where({
        organizationId,
        createUser: memberId,
      }).aggregate((agg) => ({ count: agg.count() })),
      this.prisma8.client.orm.public.Contract.where({ organizationId, owner: memberId }).aggregate((agg) => ({
        count: agg.count(),
      })),
      this.prisma8.client.orm.public.ContractPaymentRecord.where({
        organizationId,
        owner: memberId,
      }).aggregate((agg) => ({ count: agg.count() })),
      this.prisma8.client.orm.public.ContractInvoice.where({ organizationId, owner: memberId }).aggregate(
        (agg) => ({ count: agg.count() }),
      ),
      this.prisma8.client.orm.public.SalesOrder.where({ organizationId, owner: memberId }).aggregate((agg) => ({
        count: agg.count(),
      })),
      this.prisma8.client.orm.public.FollowUpRecords.where({ tenantId, ownerId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
      customerIds.length
        ? this.prisma8.client.orm.public.CustomerCollaboration.where({ userId: memberId })
            .where((row) => row.customerId.in(customerIds.map(({ id: customerId }) => customerId)))
            .aggregate((agg) => ({ count: agg.count() }))
        : Promise.resolve({ count: 0 }),
      this.prisma8.client.orm.public.ApprovalInstances.where({ tenantId, submitterId: id }).aggregate(
        (agg) => ({ count: agg.count() }),
      ),
      this.prisma8.client.orm.public.ApprovalTasks.where({ tenantId, approverId: id }).aggregate((agg) => ({
        count: agg.count(),
      })),
    ])
    const referenceCounts = [
      customers.count,
      contacts.count,
      clues.count,
      opportunities.count,
      quotations.count,
      contracts.count,
      payments.count,
      invoices.count,
      orders.count,
      followUps.count,
      collaborations.count,
      approvalInstances.count,
      approvalTasks.count,
    ]
    if (referenceCounts.some((count) => count > 0)) {
      throw new BadRequestException('成员仍有关联业务数据，请先转移负责人或停用账号')
    }

    const subordinateIds = (
      await this.prisma8.client.orm.public.Users.where({ tenantId, leaderId: id }).select('id').all()
    ).map(({ id: subordinateId }) => subordinateId)

    await this.prisma8.client.transaction(async (tx) => {
      const updatedAt = prisma8Now()
      await tx.orm.public.Departments.where({ tenantId, leaderId: id }).updateAndCount({
        leaderId: null,
        updatedAt,
      })
      await tx.orm.public.Users.where({ tenantId, leaderId: id }).updateAndCount({
        leaderId: null,
        updatedAt,
      })
      await tx.orm.public.SysUserView.where({
        organizationId,
        userId: memberId,
      }).deleteAndCount()
      await tx.orm.public.Notifications.where({ tenantId, userId: id }).deleteAndCount()
      const deleted = await tx.orm.public.Users.where({ id, tenantId }).deleteAndCount()
      if (deleted !== 1) throw new NotFoundException('成员不存在')
    })
    await this.authCache.invalidateMany([id, ...subordinateIds])
    await this.cache?.invalidate(tenantId, DIRECTORY_CACHE_NAMESPACE)
    return { id, name: user.name }
  }

  private async ensureExists(tenantId: string, id: string) {
    const user = await this.prisma8.client.orm.public.Users.where({ id, tenantId }).first()
    if (!user) throw new NotFoundException('成员不存在')
    return user
  }

  private async validateReferences(
    tenantId: string,
    dto: Pick<UpdateMemberDto, 'roleIds' | 'deptId' | 'leaderId'>,
    currentId?: string,
  ) {
    if (dto.roleIds !== undefined && dto.roleIds.length === 0) {
      throw new BadRequestException('至少选择一个角色')
    }
    const uniqueRoleIds = [...new Set(dto.roleIds ?? [])]
    const [roles, department, leader] = await Promise.all([
      uniqueRoleIds.length > 0
        ? this.prisma8.client.orm.public.Roles.where({ tenantId })
            .where((role) => role.id.in(uniqueRoleIds))
            .select('id')
            .all()
        : [],
      dto.deptId
        ? this.prisma8.client.orm.public.Departments.where({ id: dto.deptId, tenantId })
            .select('id')
            .first()
        : null,
      dto.leaderId
        ? this.prisma8.client.orm.public.Users.where({ id: dto.leaderId, tenantId, status: 'ACTIVE' })
            .select('id', 'leaderId')
            .first()
        : null,
    ])
    if (roles.length !== uniqueRoleIds.length) {
      throw new BadRequestException('角色不存在或不属于当前租户')
    }
    if (dto.deptId && !department) throw new BadRequestException('部门不存在或不属于当前租户')
    if (dto.leaderId && !leader) throw new BadRequestException('直属上级不存在或已停用')
    if (currentId && dto.leaderId) await this.ensureNoLeaderCycle(tenantId, currentId, dto.leaderId)
  }

  private async ensureNoLeaderCycle(tenantId: string, memberId: string, leaderId: string) {
    const users = await this.prisma8.client.orm.public.Users.where({ tenantId })
      .select('id', 'leaderId')
      .all()
    const leaderMap = new Map(users.map((user) => [user.id, user.leaderId]))
    let cursor: string | null = leaderId
    const visited = new Set<string>()
    while (cursor) {
      if (cursor === memberId) throw new BadRequestException('直属上级关系不能形成循环')
      if (visited.has(cursor)) break
      visited.add(cursor)
      cursor = leaderMap.get(cursor) ?? null
    }
  }

  private async ensurePhoneFree(tenantId: string, phone?: string | null, excludeId?: string) {
    if (!phone) return
    let users = this.prisma8.client.orm.public.Users.where({ tenantId, phone })
    if (excludeId) users = users.where((user) => user.id.neq(excludeId))
    const exists = await users.select('id').first()
    if (exists) throw new ConflictException('该手机号已被使用')
  }

  private async toVOs(tenantId: string, users: readonly MemberRow[]): Promise<MemberVO[]> {
    if (!users.length) return []
    const userIds = users.map((user) => user.id)
    const relations = await this.prisma8.client.orm.public.UserRoles.where({ tenantId })
      .where((relation) => relation.userId.in(userIds))
      .select('userId', 'roleId')
      .all()
    const roleIds = [...new Set(relations.map((relation) => relation.roleId))]
    const deptIds = [...new Set(users.map((user) => user.deptId).filter((id): id is string => !!id))]
    const leaderIds = [...new Set(users.map((user) => user.leaderId).filter((id): id is string => !!id))]
    const [roles, departments, leaders] = await Promise.all([
      roleIds.length
        ? this.prisma8.client.orm.public.Roles.where({ tenantId })
            .where((role) => role.id.in(roleIds))
            .select('id', 'name')
            .all()
        : [],
      deptIds.length
        ? this.prisma8.client.orm.public.Departments.where({ tenantId })
            .where((department) => department.id.in(deptIds))
            .select('id', 'name')
            .all()
        : [],
      leaderIds.length
        ? this.prisma8.client.orm.public.Users.where({ tenantId })
            .where((user) => user.id.in(leaderIds))
            .select('id', 'name')
            .all()
        : [],
    ])
    const roleMap = new Map(roles.map((role) => [role.id, role.name]))
    const deptMap = new Map(departments.map((department) => [department.id, department.name]))
    const leaderMap = new Map(leaders.map((leader) => [leader.id, leader.name]))
    const rolesByUser = new Map<string, string[]>()
    for (const relation of relations) {
      rolesByUser.set(relation.userId, [...(rolesByUser.get(relation.userId) ?? []), relation.roleId])
    }
    return users.map((user) => {
      const assignedRoleIds = rolesByUser.get(user.id) ?? []
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        roles: assignedRoleIds.map((roleId) => ({ roleId, id: roleId, name: roleMap.get(roleId) ?? roleId })),
        roleIds: assignedRoleIds,
        deptId: user.deptId,
        deptName: user.deptId ? (deptMap.get(user.deptId) ?? null) : null,
        leaderId: user.leaderId,
        leaderName: user.leaderId ? (leaderMap.get(user.leaderId) ?? null) : null,
        position: user.position,
        phone: user.phone,
        passwordLoginEnabled: user.passwordLoginEnabled,
        createdAt: prisma8TimestampToDate(user.createdAt).toISOString(),
      }
    })
  }
}
