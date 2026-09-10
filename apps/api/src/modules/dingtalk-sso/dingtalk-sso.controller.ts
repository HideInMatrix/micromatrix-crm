import { Body, Controller, Get, Headers, Ip, Param, Post, Query, Req, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { normalizeClientIp } from '../../common/http/client-ip'
import {
  DingTalkDiscoveryQueryDto,
  DingTalkLoginCallbackDto,
  StartDingTalkLoginDto,
} from './dto/dingtalk-sso.dto'
import { DingTalkSsoService } from './dingtalk-sso.service'

const QR_NONCE_COOKIE = 'mm_dingtalk_qr_oauth_nonce'
const WORKBENCH_NONCE_COOKIE = 'mm_dingtalk_workbench_oauth_nonce'
const OAUTH_COOKIE_PATH = '/api/auth/dingtalk'

@ApiTags('钉钉统一登录')
@Controller('auth/dingtalk')
export class DingTalkSsoController {
  constructor(private readonly service: DingTalkSsoService) {}

  @Public()
  @Get('discovery')
  @ApiOperation({ summary: '查询钉钉统一登录可用状态' })
  discovery(@Query() query: DingTalkDiscoveryQueryDto) {
    return this.service.discovery(query.tenant)
  }

  @Public()
  @Post('start')
  @ApiOperation({ summary: '签发钉钉扫码登录 state 和授权地址' })
  async start(
    @Body() dto: StartDingTalkLoginDto,
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.start(dto, origin)
    this.writeNonceCookie(response, QR_NONCE_COOKIE, result)
    return result.value
  }

  @Public()
  @Post('workbench/start')
  @ApiOperation({ summary: '签发钉钉工作台 OAuth state 和授权地址' })
  async startWorkbench(
    @Body() dto: StartDingTalkLoginDto,
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.startWorkbench(dto, origin)
    this.writeNonceCookie(response, WORKBENCH_NONCE_COOKIE, result)
    return result.value
  }

  @Public()
  @Post('callback')
  @ApiOperation({ summary: '消费钉钉扫码登录 code 并签发本地 JWT' })
  async callback(
    @Body() dto: DingTalkLoginCallbackDto,
    @Ip() ip: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const browserNonce = this.readCookie(request.headers.cookie, QR_NONCE_COOKIE)
    response.clearCookie(QR_NONCE_COOKIE, { path: OAUTH_COOKIE_PATH })
    return this.service.callback(dto, browserNonce, {
      ip: normalizeClientIp(ip),
      userAgent: request.headers['user-agent'],
    })
  }

  @Public()
  @Post('workbench/callback')
  @ApiOperation({ summary: '消费钉钉工作台 OAuth code 并签发本地 JWT' })
  async callbackWorkbench(
    @Body() dto: DingTalkLoginCallbackDto,
    @Ip() ip: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const browserNonce = this.readCookie(request.headers.cookie, WORKBENCH_NONCE_COOKIE)
    response.clearCookie(WORKBENCH_NONCE_COOKIE, { path: OAUTH_COOKIE_PATH })
    return this.service.callbackWorkbench(dto, browserNonce, {
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

@ApiTags('钉钉外部登录身份')
@ApiBearerAuth()
@Controller('external-identities/dingtalk')
export class DingTalkExternalIdentitiesController {
  constructor(private readonly service: DingTalkSsoService) {}

  @Get('users/:userId')
  @RequirePermissions('system:member')
  @ApiOperation({ summary: '查看成员钉钉登录身份' })
  get(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.service.getIdentity(user.tenantId, userId)
  }

  @Post('users/:userId/bind')
  @RequirePermissions('system:member:update')
  @LogOperation('externalIdentity', 'bindDingTalk')
  @ApiOperation({ summary: '按现有钉钉成员映射绑定或恢复登录身份' })
  bind(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.service.bindIdentity(user.tenantId, userId, user.id)
  }

  @Post('users/:userId/unbind')
  @RequirePermissions('system:member:update')
  @LogOperation('externalIdentity', 'unbindDingTalk')
  @ApiOperation({ summary: '解绑成员钉钉登录身份' })
  unbind(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.service.unbindIdentity(user.tenantId, userId, user.id)
  }
}
