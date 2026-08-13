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
import { PrismaService } from '../../prisma/prisma.service'
import type { AuthUser } from '../auth-user'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator'

/**
 * 全局认证守卫：
 * 1. @Public() 直接放行
 * 2. 校验 JWT
 * 3. 加载用户实体（含角色权限、数据范围）挂到 request.user
 * 4. 校验 @RequirePermissions 声明的权限码
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<Request>()
    const token = this.extractToken(request)
    if (!token) throw new UnauthorizedException('缺少访问令牌')

    let payload: { sub: string }
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      })
    } catch {
      throw new UnauthorizedException('访问令牌无效或已过期')
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    })
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('用户不存在或已被禁用')
    }

    const authUser: AuthUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      deptId: user.deptId,
      leaderId: user.leaderId,
      roleId: user.roleId,
      permissions: user.role?.permissions ?? [],
      dataScope: user.role?.dataScope ?? 'SELF',
      scopeDeptIds: user.role?.scopeDeptIds ?? [],
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
    return true
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? []
    return type === 'Bearer' ? token : undefined
  }
}
