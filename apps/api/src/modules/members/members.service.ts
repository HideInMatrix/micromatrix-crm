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

    const { password, ...rest } = dto
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        ...rest,
        passwordHash: await bcrypt.hash(password, 10),
      },
      include: { role: true, dept: true },
    })
    return this.toVO(user, new Map())
  }

  async update(tenantId: string, id: string, dto: UpdateMemberDto): Promise<MemberVO> {
    await this.ensureExists(tenantId, id)
    if (dto.leaderId === id) throw new BadRequestException('直属上级不能是自己')
    const user = await this.prisma.user.update({
      where: { id },
      data: dto,
      include: { role: true, dept: true },
    })
    return this.toVO(user, new Map())
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
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' },
    })
    return { id, name: updated.name, status: updated.status }
  }

  private async ensureExists(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } })
    if (!user) throw new NotFoundException('成员不存在')
    return user
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
