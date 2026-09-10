import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type {
  DingTalkLoginDiscoveryVO,
  DingTalkLoginStartVO,
  ExternalIdentityVO,
  LoginResult,
} from '@micromatrix/shared'
import { createHash, randomBytes } from 'node:crypto'
import { AuthService, type LoginContext } from '../../auth/auth.service'
import { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import type {
  ExternalIdentity,
  ExternalOAuthFlow,
  ExternalUserMapping,
  User,
} from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  DingTalkClient,
  type DingTalkOAuthLoginIdentity,
} from '../enterprise-integrations/dingtalk.client'
import { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { DingTalkLoginCallbackDto, StartDingTalkLoginDto } from './dto/dingtalk-sso.dto'

const PROVIDER = 'DINGTALK' as const
const QR_FLOW = 'QR_DINGTALK' as const
const WORKBENCH_FLOW = 'DINGTALK' as const
const QR_STATE_PREFIX = 'qr-dingtalk'
const WORKBENCH_STATE_PREFIX = 'dingtalk'
const STATE_TTL_MS = 10 * 60 * 1_000

type MappingWithUser = ExternalUserMapping & { user: User }

@Injectable()
export class DingTalkSsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly dingTalkClient: DingTalkClient,
    private readonly auth: AuthService,
    @Optional() private readonly authCache?: AuthContextCacheService,
  ) {}

  async discovery(tenantSlug?: string): Promise<DingTalkLoginDiscoveryVO> {
    const tenant = await this.resolveLoginTenant(tenantSlug)
    const integration = await this.prisma.enterpriseIntegration.findUnique({
      where: { tenantId_provider: { tenantId: tenant.id, provider: PROVIDER } },
    })
    const reason =
      tenant.status !== 'ACTIVE'
        ? '企业账户已停用'
        : !integration
          ? '钉钉尚未配置'
          : integration.lastTestSucceeded !== true
            ? '钉钉连接尚未验证'
            : !integration.syncEnabled
              ? '钉钉统一登录尚未开启'
              : !integration.clientId
                ? '钉钉 AppKey 配置缺失'
                : null
    return {
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      available: reason === null,
      reason,
      corpId: reason === null ? (integration?.corpId ?? null) : null,
      clientId: reason === null ? (integration?.clientId ?? null) : null,
      loginPath: `/login?tenant=${encodeURIComponent(tenant.slug)}`,
    }
  }

  async start(
    input: StartDingTalkLoginDto,
    requestOrigin?: string,
  ): Promise<{ value: DingTalkLoginStartVO; browserNonce: string; secureCookie: boolean }> {
    const login = await this.createLoginState(input, requestOrigin, QR_FLOW, QR_STATE_PREFIX)
    return this.loginStartResult(login, this.authorizationUrl(login, false))
  }

  async startWorkbench(
    input: StartDingTalkLoginDto,
    requestOrigin?: string,
  ): Promise<{ value: DingTalkLoginStartVO; browserNonce: string; secureCookie: boolean }> {
    const login = await this.createLoginState(
      input,
      requestOrigin,
      WORKBENCH_FLOW,
      WORKBENCH_STATE_PREFIX,
    )
    return this.loginStartResult(login, this.authorizationUrl(login, true))
  }

  async callback(
    input: DingTalkLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
  ): Promise<LoginResult & { returnPath: string }> {
    return this.callbackForFlow(input, browserNonce, context, QR_FLOW, QR_STATE_PREFIX)
  }

  async callbackWorkbench(
    input: DingTalkLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
  ): Promise<LoginResult & { returnPath: string }> {
    return this.callbackForFlow(
      input,
      browserNonce,
      context,
      WORKBENCH_FLOW,
      WORKBENCH_STATE_PREFIX,
    )
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
    if (!mapping?.active) throw new BadRequestException('该成员没有有效的钉钉同步映射')
    const integration = await this.prisma.enterpriseIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: PROVIDER } },
    })
    if (!integration) throw new BadRequestException('请先配置钉钉')

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
      throw new ConflictException('该钉钉身份已绑定其他成员')
    }
    const userIdentity = await this.prisma.externalIdentity.findUnique({
      where: { tenantId_provider_userId: { tenantId, provider: PROVIDER, userId } },
    })
    if (userIdentity && userIdentity.externalSubject !== mapping.externalId) {
      throw new ConflictException('该成员已绑定其他钉钉身份')
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
    const otherActiveIdentity = await this.prisma.externalIdentity.findFirst({
      where: {
        tenantId,
        userId,
        provider: { not: PROVIDER },
        status: 'ACTIVE',
      },
      select: { id: true },
    })
    if (!user.passwordLoginEnabled && !otherActiveIdentity) {
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

  private async createLoginState(
    input: StartDingTalkLoginDto,
    requestOrigin: string | undefined,
    flow: ExternalOAuthFlow,
    statePrefix: string,
  ) {
    const discovery = await this.discovery(input.tenantSlug)
    if (!discovery.available) throw new BadRequestException(discovery.reason ?? '钉钉登录不可用')
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { slug: discovery.tenantSlug },
    })
    const context = await this.integrations.getDingTalkRuntimeContext(tenant.id)
    if (!context.integration.syncEnabled) throw new BadRequestException('钉钉统一登录尚未开启')
    const state = `${statePrefix}.${randomBytes(32).toString('base64url')}`
    const browserNonce = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + STATE_TTL_MS)
    const returnPath = this.safeReturnPath(input.returnPath)

    await this.prisma.$transaction([
      this.prisma.externalOAuthState.deleteMany({
        where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] },
      }),
      this.prisma.externalOAuthState.create({
        data: {
          tenantId: tenant.id,
          integrationId: context.integration.id,
          flow,
          stateHash: this.hash(state),
          browserNonceHash: this.hash(browserNonce),
          returnPath,
          expiresAt,
        },
      }),
    ])

    const redirectUri = this.callbackUrl(requestOrigin)
    return {
      corpId: context.credentials.corpId,
      clientId: context.credentials.clientId,
      redirectUri,
      state,
      expiresAt: expiresAt.toISOString(),
      browserNonce,
      secureCookie: new URL(redirectUri).protocol === 'https:',
    }
  }

  private authorizationUrl(
    login: Awaited<ReturnType<DingTalkSsoService['createLoginState']>>,
    workbench: boolean,
  ): string {
    const configured = workbench
      ? this.config.get<string>('DINGTALK_WORKBENCH_LOGIN_BASE_URL')
      : this.config.get<string>('DINGTALK_LOGIN_BASE_URL')
    const authorizationUrl = new URL(configured ?? 'https://login.dingtalk.com/oauth2/auth')
    authorizationUrl.searchParams.set('redirect_uri', login.redirectUri)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('client_id', login.clientId)
    authorizationUrl.searchParams.set('scope', 'openid corpid')
    authorizationUrl.searchParams.set('state', login.state)
    authorizationUrl.searchParams.set('prompt', 'consent')
    authorizationUrl.searchParams.set('corpid', login.corpId)
    return authorizationUrl.toString()
  }

  private loginStartResult(
    login: Awaited<ReturnType<DingTalkSsoService['createLoginState']>>,
    authorizationUrl: string,
  ): { value: DingTalkLoginStartVO; browserNonce: string; secureCookie: boolean } {
    return {
      value: {
        authorizationUrl,
        clientId: login.clientId,
        redirectUri: login.redirectUri,
        state: login.state,
        expiresAt: login.expiresAt,
      },
      browserNonce: login.browserNonce,
      secureCookie: login.secureCookie,
    }
  }

  private async callbackForFlow(
    input: DingTalkLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
    flow: ExternalOAuthFlow,
    statePrefix: string,
  ): Promise<LoginResult & { returnPath: string }> {
    const state = await this.consumeState(input.state, browserNonce, context, flow, statePrefix)
    let externalSubject: string | undefined
    let mapping: MappingWithUser | null = null
    let identity: ExternalIdentity | null = null
    const authType = flow === WORKBENCH_FLOW ? 'DINGTALK_OAUTH2' : 'DINGTALK'
    try {
      const runtime = await this.integrations.getDingTalkRuntimeContext(state.tenantId)
      if (!runtime.integration.syncEnabled || runtime.integration.id !== state.integrationId) {
        throw new UnauthorizedException('钉钉登录状态已失效')
      }
      const profile = await this.dingTalkClient.exchangeOAuthLoginCode(
        runtime.credentials,
        input.code,
      )
      externalSubject = profile.userId
      mapping = await this.prisma.externalUserMapping.findUnique({
        where: {
          tenantId_provider_externalKey: {
            tenantId: state.tenantId,
            provider: PROVIDER,
            externalKey: profile.externalKey,
          },
        },
        include: { user: true },
      })
      if (!mapping?.active) throw new UnauthorizedException('钉钉成员未同步或映射已失效')
      if (mapping.user.status !== 'ACTIVE') throw new ForbiddenException('账号已被禁用')

      await this.updateProfile(mapping.user, profile)
      identity = await this.ensureLoginIdentity(state.integrationId, mapping, profile.userId)
      if (identity.status !== 'ACTIVE') {
        throw new ForbiddenException('钉钉身份已解绑，请联系管理员恢复')
      }
      const result = await this.auth.loginExternal(
        mapping.userId,
        {
          authType,
          externalSubject: profile.userId,
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
          email: mapping?.user.email ?? `DINGTALK:${externalSubject ?? 'unknown'}`,
          authType,
          externalSubject,
          externalIdentityId: identity?.id,
        },
        this.errorMessage(error),
        context,
      )
      throw error
    }
  }

  private async consumeState(
    state: string,
    browserNonce: string | undefined,
    context: LoginContext,
    flow: ExternalOAuthFlow,
    statePrefix: string,
  ) {
    const authType = flow === WORKBENCH_FLOW ? 'DINGTALK_OAUTH2' : 'DINGTALK'
    if (!state.startsWith(`${statePrefix}.`)) {
      throw new UnauthorizedException('钉钉登录状态无效或已过期')
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
      row.flow !== flow ||
      row.expiresAt.getTime() < Date.now() ||
      !browserNonce ||
      row.browserNonceHash !== this.hash(browserNonce)
    ) {
      if (row) {
        await this.auth.recordExternalLoginFailure(
          { tenantId: row.tenantId, email: 'DINGTALK:unknown', authType },
          '钉钉登录状态无效、已过期或已被使用',
          context,
        )
      }
      throw new UnauthorizedException('钉钉登录状态无效或已过期')
    }
    return row
  }

  private async updateProfile(user: User, profile: DingTalkOAuthLoginIdentity): Promise<void> {
    const data: { email?: string; phone?: string; gender?: boolean } = {}
    if (profile.phone) data.phone = profile.phone
    if (profile.gender !== null) data.gender = profile.gender
    if (profile.email && !user.email) {
      const owner = await this.prisma.user.findFirst({ where: { email: profile.email } })
      if (!owner || owner.id === user.id) data.email = profile.email
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data })
      await this.authCache?.invalidate(user.id)
    }
    if (profile.avatarUrl) {
      await this.prisma.userExtension.upsert({
        where: { id: user.id },
        create: { id: user.id, avatar: profile.avatarUrl },
        update: { avatar: profile.avatarUrl },
      })
    }
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
        throw new ConflictException('钉钉身份绑定冲突')
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
    if (byUser) throw new ConflictException('本地成员已绑定其他钉钉身份')
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

  private async resolveLoginTenant(tenantSlug?: string) {
    const configuredDefault = this.config.get<string>('DINGTALK_DEFAULT_TENANT_SLUG')?.trim()
    const requestedSlug = tenantSlug?.trim() || configuredDefault
    if (requestedSlug) {
      const tenant = await this.prisma.tenant.findUnique({ where: { slug: requestedSlug } })
      if (!tenant) throw new NotFoundException('企业标识不存在')
      return tenant
    }
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        enterpriseIntegrations: {
          some: { provider: PROVIDER, lastTestSucceeded: true, syncEnabled: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 2,
    })
    if (tenants.length === 0) throw new NotFoundException('钉钉统一登录尚未配置')
    if (tenants.length > 1)
      throw new BadRequestException('存在多个可用企业，请使用企业专属登录地址')
    return tenants[0]!
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
    const configured = this.config.get<string>('DINGTALK_OAUTH_REDIRECT_URI')
    if (configured) return this.validHttpUrl(configured)
    const publicUrl = this.config.get<string>('WEB_PUBLIC_URL')
    if (publicUrl)
      return new URL('/login/dingtalk/callback', this.validHttpUrl(publicUrl)).toString()
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new BadRequestException('生产环境尚未配置钉钉回调地址')
    }
    return new URL(
      '/login/dingtalk/callback',
      this.validHttpUrl(requestOrigin ?? 'http://localhost:5173'),
    ).toString()
  }

  private validHttpUrl(value: string): string {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new BadRequestException('钉钉回调地址配置无效')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('钉钉回调地址配置无效')
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
    return error instanceof Error ? error.message.slice(0, 500) : '钉钉登录失败'
  }
}
