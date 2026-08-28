import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthService } from '../../auth/auth.service'
import { FollowUpPlansService } from '../follow-up-plans/follow-up-plans.service'
import type {
  PersonalPlanPageDto,
  ResetPersonalPasswordDto,
  UpdatePersonalInfoDto,
} from './dto/personal-center.dto'

@Injectable()
export class PersonalCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly followPlans: FollowUpPlansService,
    private readonly changeLog: BusinessChangeLogService,
  ) {}

  async info(user: AuthUser) {
    const current = await this.prisma.user.findFirst({
      where: { id: user.id, tenantId: user.tenantId },
      include: {
        dept: true,
        extension: true,
        userRoles: { include: { role: true } },
      },
    })
    if (!current) throw new UnauthorizedException('用户不存在')
    return {
      userId: current.id,
      userName: current.name,
      phone: current.phone ?? '',
      email: current.email ?? '',
      departmentId: current.deptId,
      departmentName: current.dept?.name ?? '',
      avatarUrl: current.extension?.avatar ?? null,
      passwordLoginEnabled: current.passwordLoginEnabled,
      roles: current.userRoles.map(({ role }) => ({ id: role.id, name: role.name })),
    }
  }

  async update(user: AuthUser, dto: UpdatePersonalInfoDto) {
    const phone = dto.phone.trim()
    const email = dto.email.trim().toLowerCase()
    const [current, phoneExists, emailExists] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: user.id, tenantId: user.tenantId },
        select: { id: true, name: true, phone: true, email: true },
      }),
      this.prisma.user.findFirst({
        // Cordys ExtUserMapper.countByPhone 不带 organizationId：手机号是全局唯一。
        where: { phone, id: { not: user.id } },
        select: { id: true },
      }),
      // 登录入口按邮箱全局解析租户；个人中心也必须保持全局邮箱唯一，避免登录身份歧义。
      this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, id: { not: user.id } },
        select: { id: true },
      }),
    ])
    if (!current) throw new UnauthorizedException('用户不存在')
    if (phoneExists) throw new ConflictException('该手机号已被使用')
    if (emailExists) throw new ConflictException('该邮箱已被使用')

    await this.prisma.user.updateMany({
      where: { id: user.id, tenantId: user.tenantId },
      data: { phone, email },
    })
    const result = await this.info(user)
    await this.changeLog.record(user, {
      module: 'systemOrganization',
      action: 'update',
      targetId: user.id,
      targetName: current.name,
      before: { phone: current.phone ?? '', email: current.email ?? '' },
      after: { phone, email },
    })
    return result
  }

  async resetPassword(user: AuthUser, dto: ResetPersonalPasswordDto) {
    return this.auth.changePassword(user.id, dto.originPassword, dto.password)
  }

  async planList(user: AuthUser, dto: PersonalPlanPageDto) {
    const result = await this.followPlans.list(user, {
      page: dto.current ?? 1,
      pageSize: dto.pageSize ?? 10,
      keyword: dto.keyword,
      status: dto.status,
      mine: true,
    })
    return {
      list: result.items,
      total: result.total,
      current: result.page,
      pageSize: result.pageSize,
      options: {},
    }
  }
}
