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
import { AuthContextCacheService } from '../common/services/auth-context-cache.service'
import { Prisma8Service } from '../prisma/prisma8.service'
import { prisma8Now, prisma8TimestampFromDate } from '../prisma/prisma8-temporal'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import type { JwtPayload } from './jwt-payload.interface'

interface UserWithRelations {
  id: string
  tenantId: string
  email: string | null
  passwordHash: string
  name: string
  status: string
  deptId: string | null
  phone: string | null
  gender: boolean
  language: string
  passwordLoginEnabled: boolean
  defaultPwd: boolean
  authVersion: number
  tenant: {
    name: string
    slug: string
    status: string
  }
  dept: { name: string } | null
  extension: { avatar: string | null } | null
  userRoles: Array<{
    roleId: string
    role: { id: string; name: string; permissions: readonly string[] }
  }>
}

export interface LoginContext {
  ip?: string
  userAgent?: string
}

export interface ExternalLoginAudit {
  tenantId?: string
  userId?: string
  email: string
  authType: 'WECOM' | 'WECOM_OAUTH2' | 'DINGTALK' | 'DINGTALK_OAUTH2' | 'LARK' | 'LARK_OAUTH2'
  externalSubject?: string
  externalIdentityId?: string
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly authCache: AuthContextCacheService,
  ) {}

  /** 注册 = 创建租户 + 根部门 + 管理员角色 + 管理员账号 */
  async register(dto: RegisterDto): Promise<LoginResult> {
    const exists = await this.prisma8.client.orm.public.Users.where({ email: dto.email })
      .select('id')
      .first()
    if (exists) throw new ConflictException('该邮箱已被注册')

    const passwordHash = await bcrypt.hash(dto.password, 10)
    const slug = await this.generateTenantSlug(dto.tenantName)

    const userId = await this.prisma8.client.transaction(async (tx) => {
      const tenant = await tx.orm.public.Tenants.create({
        name: dto.tenantName,
        slug,
        updatedAt: prisma8Now(),
      })
      const rootDept = await tx.orm.public.Departments.create({
        tenantId: tenant.id,
        name: dto.tenantName,
        updatedAt: prisma8Now(),
      })
      const adminRole = await tx.orm.public.Roles.create({
        tenantId: tenant.id,
        name: '管理员',
        permissions: ['*'],
        dataScope: 'ALL',
        isSystem: true,
        updatedAt: prisma8Now(),
      })
      const created = await tx.orm.public.Users.create({
        tenantId: tenant.id,
        email: dto.email,
        passwordHash,
        name: dto.name,
        deptId: rootDept.id,
        updatedAt: prisma8Now(),
      })
      await tx.orm.public.UserRoles.create({
        tenantId: tenant.id,
        userId: created.id,
        roleId: adminRole.id,
        updatedAt: prisma8Now(),
      })

      const freePlan = await tx.orm.public.Plans.where({ code: 'free' }).select('id').first()
      if (freePlan) {
        const periodStart = new Date()
        await tx.orm.public.Subscriptions.create({
          tenantId: tenant.id,
          planId: freePlan.id,
          status: 'TRIALING',
          currentPeriodStart: prisma8TimestampFromDate(periodStart),
          currentPeriodEnd: prisma8TimestampFromDate(
            new Date(periodStart.getTime() + 14 * 24 * 3600 * 1000),
          ),
          updatedAt: prisma8Now(),
        })
      }
      return created.id
    })

    const user = await this.loadUserWithRelations(userId)
    if (!user) throw new UnauthorizedException('用户不存在')
    return this.buildLoginResult(user)
  }

  async login(dto: LoginDto, context: LoginContext = {}): Promise<LoginResult> {
    const row = await this.prisma8.client.orm.public.Users.where((user) => user.email.ilike(dto.email))
      .select('id')
      .first()
    const user = row ? await this.loadUserWithRelations(row.id) : null

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
    const user = await this.loadUserWithRelations(userId)
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
    await this.prisma8.client.orm.public.LoginLogs.create({
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

    const user = await this.loadUserWithRelations(payload.sub)
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('用户不存在或已被禁用')
    }
    if ((payload.authVersion ?? 0) !== user.authVersion) {
      throw new UnauthorizedException('登录状态已失效，请重新登录')
    }
    return this.buildLoginResult(user)
  }

  async me(userId: string): Promise<CurrentUser> {
    const user = await this.loadUserWithRelations(userId)
    if (!user) throw new UnauthorizedException('用户不存在')
    return this.toCurrentUser(user)
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma8.client.orm.public.Users.where({ id: userId }).first()
    if (!user) throw new UnauthorizedException('用户不存在')
    if (!user.passwordLoginEnabled) throw new ForbiddenException('当前账号未启用密码登录')
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new UnauthorizedException('原密码不正确')
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new ConflictException('新密码不能与原密码相同')
    }
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await this.prisma8.client.orm.public.Users.where({ id: userId }).update({
      passwordHash,
      defaultPwd: false,
      authVersion: user.authVersion + 1,
      updatedAt: prisma8Now(),
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
      authType:
        | 'PASSWORD'
        | 'WECOM'
        | 'WECOM_OAUTH2'
        | 'DINGTALK'
        | 'DINGTALK_OAUTH2'
        | 'LARK'
        | 'LARK_OAUTH2'
      externalSubject?: string
      externalIdentityId?: string
    } = { authType: 'PASSWORD' },
  ): Promise<void> {
    await this.prisma8.client.orm.public.LoginLogs.create({
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
      language: user.language as CurrentUser['language'],
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
    while (await this.prisma8.client.orm.public.Tenants.where({ slug }).select('id').first()) {
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
    }
    return slug
  }

  private async loadUserWithRelations(userId: string): Promise<UserWithRelations | null> {
    const user = await this.prisma8.client.orm.public.Users.where({ id: userId }).first()
    if (!user) return null
    const [tenant, dept, extension, relations] = await Promise.all([
      this.prisma8.client.orm.public.Tenants.where({ id: user.tenantId })
        .select('name', 'slug', 'status')
        .first(),
      user.deptId
        ? this.prisma8.client.orm.public.Departments.where({ id: user.deptId, tenantId: user.tenantId })
            .select('name')
            .first()
        : null,
      this.prisma8.client.orm.public.UserExtensions.where({ id: user.id })
        .select('avatar')
        .first(),
      this.prisma8.client.orm.public.UserRoles.where({ tenantId: user.tenantId, userId: user.id })
        .select('roleId')
        .all(),
    ])
    if (!tenant) return null
    const roleIds = relations.map((relation) => relation.roleId)
    const roles = roleIds.length
      ? await this.prisma8.client.orm.public.Roles.where({ tenantId: user.tenantId })
          .where((role) => role.id.in(roleIds))
          .select('id', 'name', 'permissions')
          .all()
      : []
    const roleMap = new Map(
      roles.map((role) => [
        role.id,
        {
          ...role,
          permissions: role.permissions ?? [],
        },
      ]),
    )
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      passwordHash: user.passwordHash,
      name: user.name,
      status: user.status,
      deptId: user.deptId,
      phone: user.phone,
      gender: user.gender,
      language: user.language,
      passwordLoginEnabled: user.passwordLoginEnabled,
      defaultPwd: user.defaultPwd,
      authVersion: user.authVersion,
      tenant,
      dept,
      extension,
      userRoles: relations.flatMap((relation) => {
        const role = roleMap.get(relation.roleId)
        return role ? [{ roleId: relation.roleId, role }] : []
      }),
    }
  }
}
