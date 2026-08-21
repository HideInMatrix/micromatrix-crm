import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { MemberVO, PaginatedResult } from '@micromatrix/shared'
import * as bcrypt from 'bcryptjs'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateMemberDto, QueryMembersDto, UpdateMemberDto } from './dto/member.dto'

type MemberWithRelations = Prisma.UserGetPayload<{
  include: { role: true; dept: true }
}>

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryMembersDto): Promise<PaginatedResult<MemberVO>> {
    const { page = 1, pageSize = 10, keyword, deptId, status } = query
    const where: Prisma.UserWhereInput = {
      tenantId,
      ...(deptId ? { deptId } : {}),
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { email: { contains: keyword, mode: 'insensitive' } },
              { phone: { contains: keyword } },
            ],
          }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { role: true, dept: true },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ])

    const leaderIds = [...new Set(items.map((u) => u.leaderId).filter((v): v is string => !!v))]
    const leaders = leaderIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: leaderIds } },
          select: { id: true, name: true },
        })
      : []
    const leaderMap = new Map(leaders.map((l) => [l.id, l.name]))

    return {
      items: items.map((u) => this.toVO(u, leaderMap)),
      total,
      page,
      pageSize,
    }
  }

  async options(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, deptId: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async create(tenantId: string, dto: CreateMemberDto): Promise<MemberVO> {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (exists) throw new ConflictException('该邮箱已被使用')

    if (!dto.deptId) throw new BadRequestException('请选择成员所属部门')
    await this.validateReferences(tenantId, dto)
    await this.ensurePhoneFree(tenantId, dto.phone)

    const { password, ...rest } = dto
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        ...rest,
        name: dto.name.trim(),
        passwordHash: await bcrypt.hash(password, 10),
      },
      include: { role: true, dept: true },
    })
    return this.toVO(user, await this.getLeaderMap(tenantId, [user.leaderId]))
  }

  async update(tenantId: string, id: string, dto: UpdateMemberDto): Promise<MemberVO> {
    const current = await this.ensureExists(tenantId, id)
    if (dto.leaderId === id) throw new BadRequestException('直属上级不能是自己')
    await this.validateReferences(tenantId, dto, id)
    await this.ensurePhoneFree(tenantId, dto.phone, id)

    const nextDeptId = dto.deptId === undefined ? current.deptId : dto.deptId
    const user = await this.prisma.$transaction(async (tx) => {
      if (dto.deptId !== undefined && nextDeptId !== current.deptId) {
        await tx.department.updateMany({
          where: { tenantId, leaderId: id, id: { not: nextDeptId ?? '' } },
          data: { leaderId: null },
        })
      }
      return tx.user.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        },
        include: { role: true, dept: true },
      })
    })
    return this.toVO(user, await this.getLeaderMap(tenantId, [user.leaderId]))
  }

  async resetPassword(tenantId: string, id: string, password: string) {
    const user = await this.ensureExists(tenantId, id)
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    })
    return { id, name: user.name }
  }

  async toggleStatus(tenantId: string, operatorId: string, id: string) {
    if (operatorId === id) throw new BadRequestException('不能禁用自己的账号')
    const user = await this.ensureExists(tenantId, id)
    const nextStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    const updated = await this.prisma.$transaction(async (tx) => {
      if (nextStatus === 'DISABLED') {
        await Promise.all([
          tx.department.updateMany({ where: { tenantId, leaderId: id }, data: { leaderId: null } }),
          tx.user.updateMany({ where: { tenantId, leaderId: id }, data: { leaderId: null } }),
        ])
      }
      return tx.user.update({ where: { id }, data: { status: nextStatus } })
    })
    return { id, name: updated.name, status: updated.status }
  }

  async remove(tenantId: string, operatorId: string, id: string) {
    if (operatorId === id) throw new BadRequestException('不能删除自己的账号')
    const user = await this.ensureExists(tenantId, id)
    const referenceCounts = await Promise.all([
      this.prisma.customer.count({ where: { tenantId, ownerId: id } }),
      this.prisma.contact.count({ where: { tenantId, ownerId: id } }),
      this.prisma.lead.count({ where: { tenantId, ownerId: id } }),
      this.prisma.opportunity.count({ where: { tenantId, ownerId: id } }),
      this.prisma.product.count({ where: { tenantId, ownerId: id } }),
      this.prisma.quote.count({ where: { tenantId, ownerId: id } }),
      this.prisma.contract.count({ where: { tenantId, ownerId: id } }),
      this.prisma.receivableRecord.count({ where: { tenantId, ownerId: id } }),
      this.prisma.invoiceRecord.count({ where: { tenantId, ownerId: id } }),
      this.prisma.order.count({ where: { tenantId, ownerId: id } }),
      this.prisma.followUpRecord.count({ where: { tenantId, ownerId: id } }),
      this.prisma.customerTeamMember.count({ where: { tenantId, userId: id } }),
      this.prisma.approvalInstance.count({ where: { tenantId, submitterId: id } }),
      this.prisma.approvalTask.count({ where: { tenantId, approverId: id } }),
    ])
    if (referenceCounts.some((count) => count > 0)) {
      throw new BadRequestException('成员仍有关联业务数据，请先转移负责人或停用账号')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.department.updateMany({ where: { tenantId, leaderId: id }, data: { leaderId: null } })
      await tx.user.updateMany({ where: { tenantId, leaderId: id }, data: { leaderId: null } })
      await tx.savedView.deleteMany({ where: { tenantId, userId: id } })
      await tx.notification.deleteMany({ where: { tenantId, userId: id } })
      await tx.user.delete({ where: { id } })
    })
    return { id, name: user.name }
  }

  private async ensureExists(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } })
    if (!user) throw new NotFoundException('成员不存在')
    return user
  }

  private async validateReferences(
    tenantId: string,
    dto: Pick<UpdateMemberDto, 'roleId' | 'deptId' | 'leaderId'>,
    currentId?: string,
  ) {
    const [role, department, leader] = await Promise.all([
      dto.roleId
        ? this.prisma.role.findFirst({ where: { id: dto.roleId, tenantId }, select: { id: true } })
        : null,
      dto.deptId
        ? this.prisma.department.findFirst({
            where: { id: dto.deptId, tenantId },
            select: { id: true },
          })
        : null,
      dto.leaderId
        ? this.prisma.user.findFirst({
            where: { id: dto.leaderId, tenantId, status: 'ACTIVE' },
            select: { id: true, leaderId: true },
          })
        : null,
    ])
    if (dto.roleId && !role) throw new BadRequestException('角色不存在或不属于当前租户')
    if (dto.deptId && !department) throw new BadRequestException('部门不存在或不属于当前租户')
    if (dto.leaderId && !leader) throw new BadRequestException('直属上级不存在或已停用')
    if (currentId && dto.leaderId) await this.ensureNoLeaderCycle(tenantId, currentId, dto.leaderId)
  }

  private async ensureNoLeaderCycle(tenantId: string, memberId: string, leaderId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, leaderId: true },
    })
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
    const exists = await this.prisma.user.findFirst({
      where: { tenantId, phone, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
    if (exists) throw new ConflictException('该手机号已被使用')
  }

  private async getLeaderMap(tenantId: string, leaderIds: Array<string | null>) {
    const ids = [...new Set(leaderIds.filter((id): id is string => Boolean(id)))]
    if (ids.length === 0) return new Map<string, string>()
    const leaders = await this.prisma.user.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, name: true },
    })
    return new Map(leaders.map((leader) => [leader.id, leader.name]))
  }

  private toVO(user: MemberWithRelations, leaderMap: Map<string, string>): MemberVO {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roleId: user.roleId,
      roleName: user.role?.name ?? null,
      deptId: user.deptId,
      deptName: user.dept?.name ?? null,
      leaderId: user.leaderId,
      leaderName: user.leaderId ? (leaderMap.get(user.leaderId) ?? null) : null,
      position: user.position,
      phone: user.phone,
      createdAt: user.createdAt.toISOString(),
    }
  }
}
