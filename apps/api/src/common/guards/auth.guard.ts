import { timingSafeEqual } from 'node:crypto'
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { hasPermission } from '@micromatrix/shared'
import type { Request } from 'express'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { toAuthUser } from '../auth-user'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/require-permissions.decorator'
import { AuthContextCacheService } from '../services/auth-context-cache.service'

/**
 * 全局认证守卫：
 * 1. @Public() 直接放行
 * 2. 校验 JWT，或 Cordys X-Access-Key / X-Secret-Key
 * 3. 加载用户实体（含角色权限、数据范围）挂到 request.user
 * 4. 校验 @RequirePermissions 声明的权限码
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly prisma8: Prisma8Service,
    private readonly authCache: AuthContextCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<Request>()
    const accessKey = this.header(request, 'x-access-key')
    const secretKey = this.header(request, 'x-secret-key')
    let userId: string
    let jwtAuthVersion: number | undefined
    let jwtCredential = false

    if (accessKey || secretKey) {
      if (!accessKey || !secretKey) throw new UnauthorizedException('API Key 凭证不完整')
      const apiKey = await this.prisma8.client.orm.public.UserKey.where({ accessKey }).first()
      const expired =
        apiKey?.forever === false &&
        (!apiKey.expireTime || apiKey.expireTime.epochMilliseconds <= Date.now())
      if (
        !apiKey ||
        !apiKey.enable ||
        expired ||
        !this.secretEquals(apiKey.secretKey, secretKey)
      ) {
        throw new UnauthorizedException('API Key 无效、已停用或已过期')
      }
      userId = apiKey.createUser
    } else {
      const token = this.extractToken(request)
      if (!token) throw new UnauthorizedException('缺少访问令牌')
      let payload: { sub: string; authVersion?: number }
      try {
        payload = await this.jwt.verifyAsync(token, {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        })
      } catch {
        throw new UnauthorizedException('访问令牌无效或已过期')
      }
      userId = payload.sub
      jwtAuthVersion = payload.authVersion
      jwtCredential = true
    }

    const cached = await this.authCache.get(userId)
    let authUser
    if (cached) {
      if (jwtCredential && (jwtAuthVersion ?? 0) !== cached.authVersion) {
        throw new UnauthorizedException('登录状态已失效，请重新登录')
      }
      authUser = cached.user
    } else {
      const user = await this.loadUserWithRoles(userId)
      if (!user || user.status !== 'ACTIVE') {
        throw new UnauthorizedException('用户不存在或已被禁用')
      }
      if (jwtCredential && (jwtAuthVersion ?? 0) !== user.authVersion) {
        throw new UnauthorizedException('登录状态已失效，请重新登录')
      }
      authUser = toAuthUser(user)
      await this.authCache.set(userId, user.authVersion, authUser)
    }
    request.user = authUser

    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    if (required.length > 0) {
      const ok = required.every((code) => hasPermission(authUser.permissions, code))
      if (!ok) throw new ForbiddenException('没有操作权限')
    }
    const requiredAny =
      this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    if (requiredAny.length > 0) {
      const ok = requiredAny.some((code) => hasPermission(authUser.permissions, code))
      if (!ok) throw new ForbiddenException('没有操作权限')
    }
    return true
  }

  private async loadUserWithRoles(userId: string) {
    const user = await this.prisma8.client.orm.public.Users.where({ id: userId })
      .select('id', 'tenantId', 'email', 'name', 'deptId', 'leaderId', 'status', 'authVersion')
      .first()
    if (!user) return null

    const links = await this.prisma8.client.orm.public.UserRoles.where({
      userId: user.id,
      tenantId: user.tenantId,
    })
      .select('roleId')
      .all()
    const roleIds = [...new Set(links.map((link) => link.roleId))]
    const roles = roleIds.length
      ? await this.prisma8.client.orm.public.Roles.where({ tenantId: user.tenantId })
          .where((role) => role.id.in(roleIds))
          .select('id', 'name', 'permissions', 'dataScope', 'scopeDeptIds')
          .all()
      : []
    const roleMap = new Map(roles.map((role) => [role.id, role]))

    return {
      ...user,
      userRoles: links.flatMap((link) => {
        const role = roleMap.get(link.roleId)
        return role
          ? [
              {
                role: {
                  ...role,
                  permissions: [...(role.permissions ?? [])],
                  scopeDeptIds: [...(role.scopeDeptIds ?? [])],
                },
              },
            ]
          : []
      }),
    }
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? []
    return type === 'Bearer' ? token : undefined
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name]
    return Array.isArray(value) ? value[0] : value
  }

  private secretEquals(expected: string, actual: string): boolean {
    const left = Buffer.from(expected)
    const right = Buffer.from(actual)
    return left.length === right.length && timingSafeEqual(left, right)
  }
}
