import { Body, Controller, Get, Ip, Param, Post, Query, Req, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { normalizeClientIp } from '../../common/http/client-ip'
import { LarkDiscoveryQueryDto, LarkLoginCallbackDto, StartLarkLoginDto } from './dto/lark-sso.dto'
import { LarkSsoService } from './lark-sso.service'

const QR_NONCE_COOKIE = 'mm_lark_qr_oauth_nonce'
const OAUTH_NONCE_COOKIE = 'mm_lark_oauth_nonce'
const MOBILE_NONCE_COOKIE = 'mm_lark_mobile_oauth_nonce'
const OAUTH_COOKIE_PATH = '/api/auth/lark'

@ApiTags('飞书统一登录')
@Controller('auth/lark')
export class LarkSsoController {
  constructor(private readonly service: LarkSsoService) {}

  @Public()
  @Get('discovery')
  @ApiOperation({ summary: '查询飞书统一登录可用状态' })
  discovery(@Query() query: LarkDiscoveryQueryDto) {
    return this.service.discovery(query.tenant)
  }

  @Public()
  @Post('start')
  @ApiOperation({ summary: '签发飞书扫码登录 state 和授权地址' })
  async start(@Body() dto: StartLarkLoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.start(dto)
    this.writeNonceCookie(response, QR_NONCE_COOKIE, result)
    return result.value
  }

  @Public()
  @Post('oauth/start')
  @ApiOperation({ summary: '签发飞书 Web OAuth state 和授权地址' })
  async startOauth(@Body() dto: StartLarkLoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.startOauth(dto)
    this.writeNonceCookie(response, OAUTH_NONCE_COOKIE, result)
    return result.value
  }

  @Public()
  @Post('mobile/start')
  @ApiOperation({ summary: '签发飞书 Mobile OAuth state 和授权地址' })
  async startMobile(
    @Body() dto: StartLarkLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.startMobile(dto)
    this.writeNonceCookie(response, MOBILE_NONCE_COOKIE, result)
    return result.value
  }

  @Public()
  @Post('callback')
  @ApiOperation({ summary: '消费飞书扫码登录 code 并签发本地 JWT' })
  callback(
    @Body() dto: LarkLoginCallbackDto,
    @Ip() ip: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.consume(dto, ip, request, response, QR_NONCE_COOKIE, (nonce, context) =>
      this.service.callback(dto, nonce, context),
    )
  }

  @Public()
  @Post('oauth/callback')
  @ApiOperation({ summary: '消费飞书 Web OAuth code 并签发本地 JWT' })
  callbackOauth(
    @Body() dto: LarkLoginCallbackDto,
    @Ip() ip: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.consume(dto, ip, request, response, OAUTH_NONCE_COOKIE, (nonce, context) =>
      this.service.callbackOauth(dto, nonce, context),
    )
  }

  @Public()
  @Post('mobile/callback')
  @ApiOperation({ summary: '消费飞书 Mobile OAuth code 并签发本地 JWT' })
  callbackMobile(
    @Body() dto: LarkLoginCallbackDto,
    @Ip() ip: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.consume(dto, ip, request, response, MOBILE_NONCE_COOKIE, (nonce, context) =>
      this.service.callbackMobile(dto, nonce, context),
    )
  }

  private consume(
    _dto: LarkLoginCallbackDto,
    ip: string,
    request: Request,
    response: Response,
    cookieName: string,
    callback: (
      nonce: string | undefined,
      context: { ip?: string; userAgent?: string },
    ) => Promise<unknown>,
  ) {
    const browserNonce = this.readCookie(request.headers.cookie, cookieName)
    response.clearCookie(cookieName, { path: OAUTH_COOKIE_PATH })
    return callback(browserNonce, {
      ip: normalizeClientIp(ip),
      userAgent: request.headers['user-agent'],
    })
  }

  private writeNonceCookie(
    response: Response,
    name: string,
    result: { browserNonce: string; secureCookie: boolean },
  ): void {
    response.cookie(name, result.browserNonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: result.secureCookie,
      maxAge: 10 * 60 * 1_000,
      path: OAUTH_COOKIE_PATH,
    })
  }

  private readCookie(header: string | undefined, name: string): string | undefined {
    for (const part of header?.split(';') ?? []) {
      const [key, ...value] = part.trim().split('=')
      if (key === name) return decodeURIComponent(value.join('='))
    }
    return undefined
  }
}

@ApiTags('飞书外部登录身份')
@ApiBearerAuth()
@Controller('external-identities/lark')
export class LarkExternalIdentitiesController {
  constructor(private readonly service: LarkSsoService) {}

  @Get('users/:userId')
  @RequirePermissions('system:member')
  @ApiOperation({ summary: '查看成员飞书登录身份' })
  get(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.service.getIdentity(user.tenantId, userId)
  }

  @Post('users/:userId/bind')
  @RequirePermissions('system:member:update')
  @LogOperation('externalIdentity', 'bindLark')
  @ApiOperation({ summary: '按现有飞书成员映射绑定或恢复登录身份' })
  bind(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.service.bindIdentity(user.tenantId, userId, user.id)
  }

  @Post('users/:userId/unbind')
  @RequirePermissions('system:member:update')
  @LogOperation('externalIdentity', 'unbindLark')
  @ApiOperation({ summary: '解绑成员飞书登录身份' })
  unbind(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.service.unbindIdentity(user.tenantId, userId, user.id)
  }
}
