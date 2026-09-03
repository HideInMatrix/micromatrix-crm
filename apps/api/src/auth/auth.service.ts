import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService, type JwtSignOptions } from '@nestjs/jwt'
import { CurrentUser, LoginResult } from '@micromatrix/shared'
import * as bcrypt from 'bcryptjs'
import { Prisma } from '../generated/prisma/client'
import { AuthContextCacheService } from '../common/services/auth-context-cache.service'
import { PrismaService } from '../prisma/prisma.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import type { JwtPayload } from './jwt-payload.interface'

type UserWithRelations = Prisma.UserGetPayload<{
  include: {
    userRoles: { include: { role: true } }
    tenant: true
    dept: true
    extension: true
  }
}>

const userInclude = {
  userRoles: { include: { role: true } },
  tenant: true,
  dept: true,
  extension: true,
} as const

export interface LoginContext {
  ip?: string
  userAgent?: string
}

export interface ExternalLoginAudit {
  tenantId?: string
  userId?: string
  email: string
  authType: 'WECOM' | 'WECOM_OAUTH2'
  externalSubject?: string
  externalIdentityId?: string
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly authCache: AuthContextCacheService,
  ) {}

  /** 注册 = 创建租户 + 根部门 + 管理员角色 + 管理员账号 */
  async register(dto: RegisterDto): Promise<LoginResult> {
    const exists = await this.prisma.user.findFirst({ where: { email: dto.email } })
    if (exists) throw new ConflictException('该邮箱已被注册')

    const passwordHash = await bcrypt.hash(dto.password, 10)
    const slug = await this.generateTenantSlug(dto.tenantName)

    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: dto.tenantName, slug } })
      const rootDept = await tx.department.create({
        data: { tenantId: tenant.id, name: dto.tenantName },
      })
      const adminRole = await tx.role.create({
        data: {
          tenantId: tenant.id,
          name: '管理员',
          permissions: ['*'],
          dataScope: 'ALL',
          isSystem: true,
        },
      })
      const created = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          passwordHash,
          name: dto.name,
          deptId: rootDept.id,
          userRoles: {
            create: { tenantId: tenant.id, roleId: adminRole.id },
          },
        },
        include: userInclude,
      })

      const freePlan = await tx.plan.findUnique({ where: { code: 'free' } })
      if (freePlan) {
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: freePlan.id,
            status: 'TRIALING',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 14 * 24 * 3600 * 1000),
          },
        })
      }
      return created
    })

    return this.buildLoginResult(user)
  }

  async login(dto: LoginDto, context: LoginContext = {}): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: dto.email, mode: 'insensitive' } },
      include: userInclude,
    })

    const fail = async (message: string, exception: Error) => {
      await this.recordLoginLog(dto.email, false, message, context, user, {
        authType: 'PASSWORD',
      })
      throw exception
    }

    if (
      !user ||
      !user.passwordLoginEnabled ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      return fail('邮箱或密码错误', new UnauthorizedException('邮箱或密码错误'))
    }
    if (user.status !== 'ACTIVE') {
      return fail('账号已被禁用', new ForbiddenException('账号已被禁用'))
    }
    if (user.tenant.status !== 'ACTIVE') {
      return fail('企业账户已被停用', new ForbiddenException('企业账户已被停用'))
    }

    await this.recordLoginLog(dto.email, true, null, context, user, {
      authType: 'PASSWORD',
    })
    return this.buildLoginResult(user)
  }

  async loginExternal(
    userId: string,
    audit: Omit<ExternalLoginAudit, 'userId' | 'tenantId' | 'email'>,
    context: LoginContext = {},
  ): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: userInclude })
    if (!user) throw new UnauthorizedException('企业微信成员未绑定本地账号')
    if (user.status !== 'ACTIVE') {
      await this.recordLoginLog(
        user.email ?? `WECOM:${audit.externalSubject ?? 'unknown'}`,
        false,
        '账号已被禁用',
        context,
        user,
        audit,
      )
      throw new ForbiddenException('账号已被禁用')
    }
    if (user.tenant.status !== 'ACTIVE') {
      await this.recordLoginLog(
        user.email ?? `WECOM:${audit.externalSubject ?? 'unknown'}`,
        false,
        '企业账户已被停用',
        context,
        user,
        audit,
      )
      throw new ForbiddenException('企业账户已被停用')
    }
    await this.recordLoginLog(
      user.email ?? `WECOM:${audit.externalSubject ?? 'unknown'}`,
      true,
      null,
      context,
      user,
      audit,
    )
    return this.buildLoginResult(user)
  }

  async recordExternalLoginFailure(
    audit: ExternalLoginAudit,
    message: string,
    context: LoginContext = {},
  ): Promise<void> {
    await this.prisma.loginLog
      .create({
        data: {
          tenantId: audit.tenantId,
          userId: audit.userId,
          email: audit.email,
          authType: audit.authType,
          externalSubject: audit.externalSubject,
          externalIdentityId: audit.externalIdentityId,
          success: false,
          message: message.slice(0, 500),
          ip: context.ip,
          userAgent: context.userAgent,
        },
      })
      .catch(() => undefined)
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    let payload: { sub: string; authVersion?: number }
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      })
    } catch {
      throw new UnauthorizedException('刷新令牌无效或已过期')
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: userInclude,
    })
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('用户不存在或已被禁用')
    }
    if ((payload.authVersion ?? 0) !== user.authVersion) {
      throw new UnauthorizedException('登录状态已失效，请重新登录')
    }
    return this.buildLoginResult(user)
  }

  async me(userId: string): Promise<CurrentUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userInclude,
    })
    if (!user) throw new UnauthorizedException('用户不存在')
    return this.toCurrentUser(user)
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorizedException('用户不存在')
    if (!user.passwordLoginEnabled) throw new ForbiddenException('当前账号未启用密码登录')
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new UnauthorizedException('原密码不正确')
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new ConflictException('新密码不能与原密码相同')
    }
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, defaultPwd: false, authVersion: { increment: 1 } },
    })
    await this.authCache.invalidate(userId)
    return { success: true }
  }

  private async recordLoginLog(
    email: string,
    success: boolean,
    message: string | null,
    context: LoginContext,
    user?: UserWithRelations | null,
    audit: {
      authType: 'PASSWORD' | 'WECOM' | 'WECOM_OAUTH2'
      externalSubject?: string
      externalIdentityId?: string
    } = { authType: 'PASSWORD' },
  ): Promise<void> {
    await this.prisma.loginLog
      .create({
        data: {
          tenantId: user?.tenantId,
          userId: user?.id,
          email,
          authType: audit.authType,
          externalSubject: audit.externalSubject,
          externalIdentityId: audit.externalIdentityId,
          success,
          message,
          ip: context.ip,
          userAgent: context.userAgent,
        },
      })
      .catch(() => undefined)
  }

  private async buildLoginResult(user: UserWithRelations): Promise<LoginResult> {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      authVersion: user.authVersion,
    }
    const accessExpiresIn = (this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ??
      '15m') as JwtSignOptions['expiresIn']
    const refreshExpiresIn = (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ??
      '7d') as JwtSignOptions['expiresIn']

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessExpiresIn,
      }),
      this.jwt.signAsync(
        { sub: user.id, authVersion: user.authVersion },
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: refreshExpiresIn,
        },
      ),
    ])
    return { accessToken, refreshToken, user: this.toCurrentUser(user) }
  }

  private toCurrentUser(user: UserWithRelations): CurrentUser {
    return {
      id: user.id,
      tenantId: user.tenantId,
      tenantName: user.tenant.name,
      tenantSlug: user.tenant.slug,
      email: user.email,
      phone: user.phone,
      name: user.name,
      gender: user.gender,
      avatarUrl: user.extension?.avatar ?? null,
      defaultPwd: user.defaultPwd,
      roles: user.userRoles.map(({ role }) => ({ id: role.id, name: role.name })),
      permissions: [...new Set(user.userRoles.flatMap(({ role }) => role.permissions))],
      deptId: user.deptId,
      deptName: user.dept?.name ?? null,
    }
  }

  private async generateTenantSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'tenant'
    let slug = base
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
    }
    return slug
  }
}
