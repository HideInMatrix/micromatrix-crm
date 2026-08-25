import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type {
  ExternalIdentityVO,
  LoginResult,
  WeComLoginDiscoveryVO,
  WeComLoginStartVO,
} from '@micromatrix/shared'
import { createHash, randomBytes } from 'node:crypto'
import { AuthService, type LoginContext } from '../../auth/auth.service'
import type { ExternalIdentity, ExternalUserMapping, User } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import { WeComClient } from '../enterprise-integrations/wecom.client'
import type { StartWeComLoginDto, WeComLoginCallbackDto } from './dto/wecom-sso.dto'

const PROVIDER = 'WECOM' as const
const FLOW = 'QR_WECOM' as const
const STATE_TTL_MS = 10 * 60 * 1_000

type MappingWithUser = ExternalUserMapping & { user: User }

@Injectable()
export class WeComSsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly weComClient: WeComClient,
    private readonly auth: AuthService,
  ) {}

  async discovery(tenantSlug: string): Promise<WeComLoginDiscoveryVO> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } })
    if (!tenant) throw new NotFoundException('企业标识不存在')
    const integration = await this.prisma.enterpriseIntegration.findUnique({
      where: { tenantId_provider: { tenantId: tenant.id, provider: PROVIDER } },
    })
    const reason =
      tenant.status !== 'ACTIVE'
        ? '企业账户已停用'
        : !integration
          ? '企业微信尚未配置'
          : integration.lastTestSucceeded !== true
            ? '企业微信连接尚未验证'
            : !integration.syncEnabled
              ? '企业微信统一登录尚未开启'
              : null
    return {
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      available: reason === null,
      reason,
      corpId: reason === null ? (integration?.corpId ?? null) : null,
      agentId: reason === null ? (integration?.agentId ?? null) : null,
      loginPath: `/login?tenant=${encodeURIComponent(tenant.slug)}`,
    }
  }

  async start(
    input: StartWeComLoginDto,
    requestOrigin?: string,
  ): Promise<{ value: WeComLoginStartVO; browserNonce: string; secureCookie: boolean }> {
    const discovery = await this.discovery(input.tenantSlug)
    if (!discovery.available)
      throw new BadRequestException(discovery.reason ?? '企业微信登录不可用')
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { slug: input.tenantSlug } })
    const context = await this.integrations.getWeComRuntimeContext(tenant.id)
    const state = `qr-wecom.${randomBytes(32).toString('base64url')}`
    const browserNonce = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + STATE_TTL_MS)
    const returnPath = this.safeReturnPath(input.returnPath)

    await this.prisma.$transaction([
      this.prisma.externalOAuthState.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }],
        },
      }),
      this.prisma.externalOAuthState.create({
        data: {
          tenantId: tenant.id,
          integrationId: context.integration.id,
          flow: FLOW,
          stateHash: this.hash(state),
          browserNonceHash: this.hash(browserNonce),
          returnPath,
          expiresAt,
        },
      }),
    ])

    const redirectUri = this.callbackUrl(requestOrigin)
    const authorizationUrl = new URL(
      this.config.get<string>('WECOM_LOGIN_BASE_URL') ??
        'https://login.work.weixin.qq.com/wwlogin/sso/login',
    )
    authorizationUrl.searchParams.set('login_type', 'CorpApp')
    authorizationUrl.searchParams.set('appid', context.credentials.corpId)
    authorizationUrl.searchParams.set('agentid', context.credentials.agentId)
    authorizationUrl.searchParams.set('redirect_uri', redirectUri)
    authorizationUrl.searchParams.set('state', state)

    return {
      value: {
        authorizationUrl: authorizationUrl.toString(),
        corpId: context.credentials.corpId,
        agentId: context.credentials.agentId,
        redirectUri,
        state,
        expiresAt: expiresAt.toISOString(),
      },
      browserNonce,
      secureCookie: new URL(redirectUri).protocol === 'https:',
    }
  }

  async callback(
    input: WeComLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
  ): Promise<LoginResult & { returnPath: string }> {
    const state = await this.consumeState(input.state, browserNonce, context)
    let externalSubject: string | undefined
    let mapping: MappingWithUser | null = null
    let identity: ExternalIdentity | null = null
    try {
      const runtime = await this.integrations.getWeComRuntimeContext(state.tenantId)
      if (runtime.integration.id !== state.integrationId) {
        throw new UnauthorizedException('企业微信登录状态已失效')
      }
      const external = await this.weComClient.exchangeLoginCode(runtime.credentials, input.code)
      externalSubject = external.userId
      mapping = await this.prisma.externalUserMapping.findUnique({
        where: {
          tenantId_provider_externalKey: {
            tenantId: state.tenantId,
            provider: PROVIDER,
            externalKey: external.externalKey,
          },
        },
        include: { user: true },
      })
      if (!mapping?.active) throw new UnauthorizedException('企业微信成员未同步或映射已失效')
      if (mapping.user.status !== 'ACTIVE') throw new ForbiddenException('账号已被禁用')

      identity = await this.ensureLoginIdentity(state.integrationId, mapping, external.userId)
      if (identity.status !== 'ACTIVE') {
        throw new ForbiddenException('企业微信身份已解绑，请联系管理员恢复')
      }
      const result = await this.auth.loginExternal(
        mapping.userId,
        {
          authType: 'WECOM',
          externalSubject: external.userId,
          externalIdentityId: identity.id,
        },
        context,
      )
      await this.prisma.externalIdentity.update({
        where: { id: identity.id },
        data: { lastLoginAt: new Date() },
      })
      return { ...result, returnPath: state.returnPath }
    } catch (error) {
      await this.auth.recordExternalLoginFailure(
        {
          tenantId: state.tenantId,
          userId: mapping?.userId,
          email: mapping?.user.email ?? `WECOM:${externalSubject ?? 'unknown'}`,
          authType: 'WECOM',
          externalSubject,
          externalIdentityId: identity?.id,
        },
        this.errorMessage(error),
        context,
      )
      throw error
    }
  }

  async getIdentity(tenantId: string, userId: string): Promise<ExternalIdentityVO> {
    await this.requireUser(tenantId, userId)
    const [mapping, identity] = await Promise.all([
      this.prisma.externalUserMapping.findUnique({
        where: { tenantId_provider_userId: { tenantId, provider: PROVIDER, userId } },
      }),
      this.prisma.externalIdentity.findUnique({
        where: { tenantId_provider_userId: { tenantId, provider: PROVIDER, userId } },
      }),
    ])
    return this.identityVO(mapping, identity)
  }

  async bindIdentity(
    tenantId: string,
    userId: string,
    operatorId: string,
  ): Promise<ExternalIdentityVO> {
    await this.requireUser(tenantId, userId)
    const mapping = await this.prisma.externalUserMapping.findUnique({
      where: { tenantId_provider_userId: { tenantId, provider: PROVIDER, userId } },
    })
    if (!mapping?.active) throw new BadRequestException('该成员没有有效的企业微信同步映射')
    const integration = await this.prisma.enterpriseIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: PROVIDER } },
    })
    if (!integration) throw new BadRequestException('请先配置企业微信')

    const subjectOwner = await this.prisma.externalIdentity.findUnique({
      where: {
        tenantId_provider_externalSubject: {
          tenantId,
          provider: PROVIDER,
          externalSubject: mapping.externalId,
        },
      },
    })
    if (subjectOwner && subjectOwner.userId !== userId) {
      throw new ConflictException('该企业微信身份已绑定其他成员')
    }
    const userIdentity = await this.prisma.externalIdentity.findUnique({
      where: { tenantId_provider_userId: { tenantId, provider: PROVIDER, userId } },
    })
    if (userIdentity && userIdentity.externalSubject !== mapping.externalId) {
      throw new ConflictException('该成员已绑定其他企业微信身份')
    }
    const identity = userIdentity
      ? await this.prisma.externalIdentity.update({
          where: { id: userIdentity.id },
          data: {
            mappingId: mapping.id,
            integrationId: integration.id,
            status: 'ACTIVE',
            bindingSource: 'ADMIN',
            boundById: operatorId,
            boundAt: new Date(),
            revokedById: null,
            revokedAt: null,
          },
        })
      : await this.prisma.externalIdentity.create({
          data: {
            tenantId,
            integrationId: integration.id,
            mappingId: mapping.id,
            provider: PROVIDER,
            externalSubject: mapping.externalId,
            userId,
            bindingSource: 'ADMIN',
            boundById: operatorId,
          },
        })
    return this.identityVO(mapping, identity)
  }

  async unbindIdentity(
    tenantId: string,
    userId: string,
    operatorId: string,
  ): Promise<ExternalIdentityVO> {
    const user = await this.requireUser(tenantId, userId)
    if (!user.passwordLoginEnabled) {
      throw new BadRequestException('该成员未启用密码登录，不能移除最后一个登录方式')
    }
    const [mapping, identity] = await Promise.all([
      this.prisma.externalUserMapping.findUnique({
        where: { tenantId_provider_userId: { tenantId, provider: PROVIDER, userId } },
      }),
      this.prisma.externalIdentity.findUnique({
        where: { tenantId_provider_userId: { tenantId, provider: PROVIDER, userId } },
      }),
    ])
    if (!identity) return this.identityVO(mapping, null)
    const revoked = await this.prisma.externalIdentity.update({
      where: { id: identity.id },
      data: { status: 'REVOKED', revokedById: operatorId, revokedAt: new Date() },
    })
    return this.identityVO(mapping, revoked)
  }

  private async consumeState(
    state: string,
    browserNonce: string | undefined,
    context: LoginContext,
  ) {
    if (!state.startsWith('qr-wecom.')) {
      throw new UnauthorizedException('企业微信登录状态无效或已过期')
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const found = await tx.externalOAuthState.findUnique({
        where: { stateHash: this.hash(state) },
      })
      if (!found) return null
      const consumed = await tx.externalOAuthState.updateMany({
        where: { id: found.id, consumedAt: null },
        data: { consumedAt: new Date() },
      })
      return { row: found, consumed: consumed.count === 1 }
    })
    const row = result?.row
    if (
      !row ||
      !result.consumed ||
      row.flow !== FLOW ||
      row.expiresAt.getTime() < Date.now() ||
      !browserNonce ||
      row.browserNonceHash !== this.hash(browserNonce)
    ) {
      if (row) {
        await this.auth.recordExternalLoginFailure(
          {
            tenantId: row.tenantId,
            email: 'WECOM:unknown',
            authType: 'WECOM',
          },
          '企业微信登录状态无效、已过期或已被使用',
          context,
        )
      }
      throw new UnauthorizedException('企业微信登录状态无效或已过期')
    }
    return row
  }

  private async ensureLoginIdentity(
    integrationId: string,
    mapping: ExternalUserMapping,
    externalSubject: string,
  ): Promise<ExternalIdentity> {
    const existing = await this.prisma.externalIdentity.findUnique({
      where: {
        tenantId_provider_externalSubject: {
          tenantId: mapping.tenantId,
          provider: PROVIDER,
          externalSubject,
        },
      },
    })
    if (existing) {
      if (existing.userId !== mapping.userId || existing.mappingId !== mapping.id) {
        throw new ConflictException('企业微信身份绑定冲突')
      }
      return existing
    }
    const byUser = await this.prisma.externalIdentity.findUnique({
      where: {
        tenantId_provider_userId: {
          tenantId: mapping.tenantId,
          provider: PROVIDER,
          userId: mapping.userId,
        },
      },
    })
    if (byUser) throw new ConflictException('本地成员已绑定其他企业微信身份')
    return this.prisma.externalIdentity.create({
      data: {
        tenantId: mapping.tenantId,
        integrationId,
        mappingId: mapping.id,
        provider: PROVIDER,
        externalSubject,
        userId: mapping.userId,
        bindingSource: 'LOGIN',
      },
    })
  }

  private requireUser(tenantId: string, userId: string) {
    return this.prisma.user
      .findFirst({ where: { id: userId, tenantId } })
      .then((user) => user ?? Promise.reject(new NotFoundException('成员不存在')))
  }

  private identityVO(
    mapping: ExternalUserMapping | null,
    identity: ExternalIdentity | null,
  ): ExternalIdentityVO {
    return {
      provider: PROVIDER,
      mapped: Boolean(mapping?.active),
      externalSubject: identity?.externalSubject ?? mapping?.externalId ?? null,
      status: identity?.status ?? null,
      boundAt: identity?.boundAt.toISOString() ?? null,
      revokedAt: identity?.revokedAt?.toISOString() ?? null,
      lastLoginAt: identity?.lastLoginAt?.toISOString() ?? null,
    }
  }

  private callbackUrl(requestOrigin?: string): string {
    const configured = this.config.get<string>('WECOM_OAUTH_REDIRECT_URI')
    if (configured) return this.validHttpUrl(configured)
    const publicUrl = this.config.get<string>('WEB_PUBLIC_URL')
    if (publicUrl) return new URL('/login/wecom/callback', this.validHttpUrl(publicUrl)).toString()
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new BadRequestException('生产环境尚未配置企业微信回调地址')
    }
    return new URL(
      '/login/wecom/callback',
      this.validHttpUrl(requestOrigin ?? 'http://localhost:5173'),
    ).toString()
  }

  private validHttpUrl(value: string): string {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new BadRequestException('企业微信回调地址配置无效')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('企业微信回调地址配置无效')
    }
    return url.toString()
  }

  private safeReturnPath(value?: string): string {
    return value?.startsWith('/') && !value.startsWith('//') ? value.slice(0, 500) : '/'
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 500) : '企业微信登录失败'
  }
}
