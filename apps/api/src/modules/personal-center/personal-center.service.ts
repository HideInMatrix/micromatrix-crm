import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
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
    private readonly authCache: AuthContextCacheService,
  ) {}

  async info(user: AuthUser) {
    const current = await this.prisma.client.orm.public.Users.where({
      id: user.id,
      tenantId: user.tenantId,
    })
      .select('id', 'name', 'phone', 'email', 'language', 'deptId', 'passwordLoginEnabled')
      .first()
    if (!current) throw new UnauthorizedException('用户不存在')
    const [department, extension, userRoles] = await Promise.all([
      current.deptId
        ? this.prisma.client.orm.public.Departments.where({
            id: current.deptId,
            tenantId: user.tenantId,
          })
            .select('name')
            .first()
        : null,
      this.prisma.client.orm.public.UserExtensions.where({ id: current.id })
        .select('avatar')
        .first(),
      this.prisma.client.orm.public.UserRoles.where({ tenantId: user.tenantId, userId: current.id })
        .select('roleId')
        .all(),
    ])
    const roleIds = userRoles.map((row) => row.roleId)
    const roles = roleIds.length
      ? await this.prisma.client.orm.public.Roles.where({ tenantId: user.tenantId })
          .where((row) => row.id.in(roleIds))
          .select('id', 'name')
          .all()
      : []
    return {
      userId: current.id,
      userName: current.name,
      phone: current.phone ?? '',
      email: current.email ?? '',
      language: current.language,
      departmentId: current.deptId,
      departmentName: department?.name ?? '',
      avatarUrl: extension?.avatar ?? null,
      passwordLoginEnabled: current.passwordLoginEnabled,
      roles: roles.map((role) => ({ id: role.id, name: role.name })),
    }
  }

  async update(user: AuthUser, dto: UpdatePersonalInfoDto) {
    const phone = dto.phone.trim()
    const email = dto.email.trim().toLowerCase()
    const language = dto.language
    const [current, phoneMatch, emailMatch] = await Promise.all([
      this.prisma.client.orm.public.Users.where({ id: user.id, tenantId: user.tenantId })
        .select('id', 'name', 'phone', 'email', 'language')
        .first(),
      // Cordys ExtUserMapper.countByPhone 不带 organizationId：手机号是全局唯一。
      this.prisma.client.orm.public.Users.where({ phone }).select('id').first(),
      // 登录入口按邮箱全局解析租户；个人中心也必须保持全局邮箱唯一，避免登录身份歧义。
      this.prisma.client.orm.public.Users.where((row) => row.email.ilike(email))
        .select('id')
        .first(),
    ])
    if (!current) throw new UnauthorizedException('用户不存在')
    if (phoneMatch && phoneMatch.id !== user.id) throw new ConflictException('该手机号已被使用')
    if (emailMatch && emailMatch.id !== user.id) throw new ConflictException('该邮箱已被使用')

    const updated = await this.prisma.client.orm.public.Users.where({
      id: user.id,
      tenantId: user.tenantId,
    }).update({
      phone,
      email,
      language,
      updatedAt: nowInstant(),
    })
    if (!updated) throw new UnauthorizedException('用户不存在')
    await this.authCache.invalidate(user.id)
    const result = await this.info(user)
    await this.changeLog.record(user, {
      module: 'systemOrganization',
      action: 'update',
      targetId: user.id,
      targetName: current.name,
      before: {
        phone: current.phone ?? '',
        email: current.email ?? '',
        language: current.language,
      },
      after: { phone, email, language },
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
