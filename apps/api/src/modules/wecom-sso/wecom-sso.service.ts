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
  ExternalIdentityVO,
  LoginResult,
  WeComLoginDiscoveryVO,
  WeComLoginStartVO,
} from '@micromatrix/shared'
import { createHash, randomBytes } from 'node:crypto'
import { or } from '@prisma/orm-postgres/orm-client'
import { AuthService, type LoginContext } from '../../auth/auth.service'
import { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { PrismaService } from '../../prisma/prisma.service'
import { nowInstant, instantFromDate, instantToISOString } from '../../prisma/temporal'
import { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import {
  WeComClient,
  type WeComLoginIdentity,
  type WeComOAuthLoginIdentity,
} from '../enterprise-integrations/wecom.client'
import type { StartWeComLoginDto, WeComLoginCallbackDto } from './dto/wecom-sso.dto'

const PROVIDER = 'WECOM' as const
const QR_FLOW = 'QR_WECOM' as const
const WORKBENCH_FLOW = 'WECOM' as const
const QR_STATE_PREFIX = 'qr-wecom'
const WORKBENCH_STATE_PREFIX = 'wecom'
const STATE_TTL_MS = 10 * 60 * 1_000

type ExternalOAuthFlow = typeof QR_FLOW | typeof WORKBENCH_FLOW
type UserRow = {
  id: string
  tenantId: string
  email: string | null
  name: string
  status: 'ACTIVE' | 'DISABLED'
  passwordLoginEnabled: boolean
  phone: string | null
  gender: boolean
}
type MappingRow = {
  id: string
  tenantId: string
  externalId: string
  externalKey: string
  userId: string
  active: boolean
}
type IdentityRow = {
  id: string
  tenantId: string
  integrationId: string
  mappingId: string
  externalSubject: string
  userId: string
  status: NonNullable<ExternalIdentityVO['status']>
  boundAt: Parameters<typeof instantToISOString>[0]
  revokedAt: Parameters<typeof instantToISOString>[0] | null
  lastLoginAt: Parameters<typeof instantToISOString>[0] | null
}
type MappingWithUser = MappingRow & { user: UserRow }

@Injectable()
export class WeComSsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly weComClient: WeComClient,
    private readonly auth: AuthService,
    @Optional() private readonly authCache?: AuthContextCacheService,
  ) {}

  async discovery(tenantSlug?: string): Promise<WeComLoginDiscoveryVO> {
    const tenant = await this.resolveLoginTenant(tenantSlug)
    const integration = await this.prisma.client.orm.public.EnterpriseIntegrations.where({
      tenantId: tenant.id,
      provider: PROVIDER,
    }).first()
    const activePlatform = await this.integrations.getActivePlatform(tenant.id)
    const reason =
      tenant.status !== 'ACTIVE'
        ? '企业账户已停用'
        : activePlatform.syncResource !== PROVIDER
          ? '当前企业协同平台不是企业微信'
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
    const login = await this.createLoginState(input, requestOrigin, QR_FLOW, QR_STATE_PREFIX)
    const authorizationUrl = new URL(
      this.config.get<string>('WECOM_LOGIN_BASE_URL') ??
        'https://login.work.weixin.qq.com/wwlogin/sso/login',
    )
    authorizationUrl.searchParams.set('login_type', 'CorpApp')
    authorizationUrl.searchParams.set('appid', login.corpId)
    authorizationUrl.searchParams.set('agentid', login.agentId)
    authorizationUrl.searchParams.set('redirect_uri', login.redirectUri)
    authorizationUrl.searchParams.set('state', login.state)
    return this.loginStartResult(login, authorizationUrl.toString())
  }

  async startWorkbench(
    input: StartWeComLoginDto,
    requestOrigin?: string,
  ): Promise<{ value: WeComLoginStartVO; browserNonce: string; secureCookie: boolean }> {
    const login = await this.createLoginState(
      input,
      requestOrigin,
      WORKBENCH_FLOW,
      WORKBENCH_STATE_PREFIX,
    )
    const authorizationUrl = new URL(
      this.config.get<string>('WECOM_WORKBENCH_LOGIN_BASE_URL') ??
        'https://open.weixin.qq.com/connect/oauth2/authorize',
    )
    authorizationUrl.searchParams.set('appid', login.corpId)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('redirect_uri', login.redirectUri)
    authorizationUrl.searchParams.set('scope', 'snsapi_base')
    authorizationUrl.searchParams.set('agentid', login.agentId)
    authorizationUrl.searchParams.set('state', login.state)
    return this.loginStartResult(login, `${authorizationUrl.toString()}#wechat_redirect`)
  }

  async startWorkbenchEntry(
    input: { tenantSlug?: string; target?: string },
    requestOrigin?: string,
  ): Promise<{ value: WeComLoginStartVO; browserNonce: string; secureCookie: boolean }> {
    return this.startWorkbench(
      {
        tenantSlug: input.tenantSlug,
        returnPath: this.workbenchReturnPath(input.target, requestOrigin),
      },
      requestOrigin,
    )
  }

  private async createLoginState(
    input: StartWeComLoginDto,
    requestOrigin: string | undefined,
    flow: ExternalOAuthFlow,
    statePrefix: string,
  ) {
    const discovery = await this.discovery(input.tenantSlug)
    if (!discovery.available)
      throw new BadRequestException(discovery.reason ?? '企业微信登录不可用')
    const tenant = await this.prisma.client.orm.public.Tenants.where({
      slug: discovery.tenantSlug,
    }).first()
    if (!tenant) throw new NotFoundException('企业标识不存在')
    const context = await this.integrations.getWeComRuntimeContext(tenant.id)
    const state = `${statePrefix}.${randomBytes(32).toString('base64url')}`
    const browserNonce = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + STATE_TTL_MS)
    const returnPath = this.safeReturnPath(input.returnPath)

    await this.prisma.client.transaction(async (tx) => {
      const now = nowInstant()
      await tx.orm.public.ExternalOauthStates.where((row) =>
        or(row.expiresAt.lt(now), row.consumedAt.isNotNull()),
      ).deleteAndCount()
      await tx.orm.public.ExternalOauthStates.create({
        tenantId: tenant.id,
        integrationId: context.integration.id,
        flow,
        stateHash: this.hash(state),
        browserNonceHash: this.hash(browserNonce),
        returnPath,
        expiresAt: instantFromDate(expiresAt),
      })
    })

    const redirectUri = this.callbackUrl(requestOrigin)
    return {
      corpId: context.credentials.corpId,
      agentId: context.credentials.agentId,
      redirectUri,
      state,
      expiresAt: expiresAt.toISOString(),
      browserNonce,
      secureCookie: new URL(redirectUri).protocol === 'https:',
    }
  }

  private loginStartResult(
    login: Awaited<ReturnType<WeComSsoService['createLoginState']>>,
    authorizationUrl: string,
  ): { value: WeComLoginStartVO; browserNonce: string; secureCookie: boolean } {
    return {
      value: {
        authorizationUrl,
        corpId: login.corpId,
        agentId: login.agentId,
        redirectUri: login.redirectUri,
        state: login.state,
        expiresAt: login.expiresAt,
      },
      browserNonce: login.browserNonce,
      secureCookie: login.secureCookie,
    }
  }

  private async resolveLoginTenant(tenantSlug?: string) {
    // Cordys 是单企业部署；多租户版本通过部署配置保留同样的“一键扫码”入口。
    const configuredDefault = this.config.get<string>('WECOM_DEFAULT_TENANT_SLUG')?.trim()
    const requestedSlug = tenantSlug?.trim() || configuredDefault
    if (requestedSlug) {
      const tenant = await this.prisma.client.orm.public.Tenants.where({
        slug: requestedSlug,
      }).first()
      if (!tenant) throw new NotFoundException('企业标识不存在')
      return tenant
    }

    const integrations = await this.prisma.client.orm.public.EnterpriseIntegrations.where({
      provider: PROVIDER,
      lastTestSucceeded: true,
      syncEnabled: true,
    })
      .select('tenantId')
      .all()
    const tenantIds = [...new Set(integrations.map((integration) => integration.tenantId))]
    const tenants = tenantIds.length
      ? await this.prisma.client.orm.public.Tenants.where({ status: 'ACTIVE' })
          .where((tenant) => tenant.id.in(tenantIds))
          .orderBy((tenant) => tenant.createdAt.asc())
          .limit(2)
          .all()
      : []
    if (tenants.length === 0) throw new NotFoundException('企业微信统一登录尚未配置')
    if (tenants.length > 1) {
      throw new BadRequestException('存在多个可用企业，请使用企业专属登录地址')
    }
    return tenants[0]!
  }

  async callback(
    input: WeComLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
  ): Promise<LoginResult & { returnPath: string }> {
    return this.callbackForFlow(input, browserNonce, context, QR_FLOW, QR_STATE_PREFIX)
  }

  async callbackWorkbench(
    input: WeComLoginCallbackDto,
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

  private async callbackForFlow(
    input: WeComLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
    flow: ExternalOAuthFlow,
    statePrefix: string,
  ): Promise<LoginResult & { returnPath: string }> {
    const state = await this.consumeState(input.state, browserNonce, context, flow, statePrefix)
    let externalSubject: string | undefined
    let mapping: MappingWithUser | null = null
    let identity: IdentityRow | null = null
    try {
      const runtime = await this.integrations.getWeComRuntimeContext(state.tenantId)
      if (runtime.integration.id !== state.integrationId) {
        throw new UnauthorizedException('企业微信登录状态已失效')
      }
      let external: WeComLoginIdentity
      let profile: WeComOAuthLoginIdentity | null = null
      if (flow === WORKBENCH_FLOW) {
        profile = await this.weComClient.exchangeOAuthLoginCode(runtime.credentials, input.code)
        external = profile
      } else {
        external = await this.weComClient.exchangeLoginCode(runtime.credentials, input.code)
      }
      externalSubject = external.userId
      const mapped = await this.prisma.client.orm.public.ExternalUserMappings.where({
        tenantId: state.tenantId,
        provider: PROVIDER,
        externalKey: external.externalKey,
      }).first()
      if (!mapped?.active) throw new UnauthorizedException('企业微信成员未同步或映射已失效')
      const mappedUser = await this.prisma.client.orm.public.Users.where({
        id: mapped.userId,
        tenantId: state.tenantId,
      }).first()
      if (!mappedUser) throw new UnauthorizedException('企业微信成员未同步或映射已失效')
      mapping = { ...mapped, user: mappedUser }
      if (mapping.user.status !== 'ACTIVE') throw new ForbiddenException('账号已被禁用')

      if (profile) await this.updateWorkbenchProfile(mapping.user, profile)

      identity = await this.ensureLoginIdentity(state.integrationId, mapping, external.userId)
      if (identity.status !== 'ACTIVE') {
        throw new ForbiddenException('企业微信身份已解绑，请联系管理员恢复')
      }
      const result = await this.auth.loginExternal(
        mapping.userId,
        {
          authType: flow === WORKBENCH_FLOW ? 'WECOM_OAUTH2' : 'WECOM',
          externalSubject: external.userId,
          externalIdentityId: identity.id,
        },
        context,
      )
      const lastLoginAt = nowInstant()
      await this.prisma.client.orm.public.ExternalIdentities.where({ id: identity.id }).update({
        lastLoginAt,
        updatedAt: lastLoginAt,
      })
      return { ...result, returnPath: state.returnPath }
    } catch (error) {
      await this.auth.recordExternalLoginFailure(
        {
          tenantId: state.tenantId,
          userId: mapping?.userId,
          email: mapping?.user.email ?? `WECOM:${externalSubject ?? 'unknown'}`,
          authType: flow === WORKBENCH_FLOW ? 'WECOM_OAUTH2' : 'WECOM',
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
      this.prisma.client.orm.public.ExternalUserMappings.where({
        tenantId,
        provider: PROVIDER,
        userId,
      }).first(),
      this.prisma.client.orm.public.ExternalIdentities.where({
        tenantId,
        provider: PROVIDER,
        userId,
      }).first(),
    ])
    return this.identityVO(mapping, identity)
  }

  async bindIdentity(
    tenantId: string,
    userId: string,
    operatorId: string,
  ): Promise<ExternalIdentityVO> {
    await this.requireUser(tenantId, userId)
    const mapping = await this.prisma.client.orm.public.ExternalUserMappings.where({
      tenantId,
      provider: PROVIDER,
      userId,
    }).first()
    if (!mapping?.active) throw new BadRequestException('该成员没有有效的企业微信同步映射')
    const integration = await this.prisma.client.orm.public.EnterpriseIntegrations.where({
      tenantId,
      provider: PROVIDER,
    }).first()
    if (!integration) throw new BadRequestException('请先配置企业微信')

    const subjectOwner = await this.prisma.client.orm.public.ExternalIdentities.where({
      tenantId,
      provider: PROVIDER,
      externalSubject: mapping.externalId,
    }).first()
    if (subjectOwner && subjectOwner.userId !== userId) {
      throw new ConflictException('该企业微信身份已绑定其他成员')
    }
    const userIdentity = await this.prisma.client.orm.public.ExternalIdentities.where({
      tenantId,
      provider: PROVIDER,
      userId,
    }).first()
    if (userIdentity && userIdentity.externalSubject !== mapping.externalId) {
      throw new ConflictException('该成员已绑定其他企业微信身份')
    }
    const now = nowInstant()
    const identity = userIdentity
      ? await this.prisma.client.orm.public.ExternalIdentities.where({
          id: userIdentity.id,
        }).update({
          mappingId: mapping.id,
          integrationId: integration.id,
          status: 'ACTIVE',
          bindingSource: 'ADMIN',
          boundById: operatorId,
          boundAt: now,
          revokedById: null,
          revokedAt: null,
          updatedAt: now,
        })
      : await this.prisma.client.orm.public.ExternalIdentities.create({
          tenantId,
          integrationId: integration.id,
          mappingId: mapping.id,
          provider: PROVIDER,
          externalSubject: mapping.externalId,
          userId,
          bindingSource: 'ADMIN',
          boundById: operatorId,
          updatedAt: now,
        })
    if (!identity) throw new NotFoundException('企业微信身份不存在')
    return this.identityVO(mapping, identity)
  }

  async unbindIdentity(
    tenantId: string,
    userId: string,
    operatorId: string,
  ): Promise<ExternalIdentityVO> {
    const user = await this.requireUser(tenantId, userId)
    const otherActiveIdentity = await this.prisma.client.orm.public.ExternalIdentities.where({
      tenantId,
      userId,
      status: 'ACTIVE',
    })
      .where((identity) => identity.provider.neq(PROVIDER))
      .select('id')
      .first()
    if (!user.passwordLoginEnabled && !otherActiveIdentity) {
      throw new BadRequestException('该成员未启用密码登录，不能移除最后一个登录方式')
    }
    const [mapping, identity] = await Promise.all([
      this.prisma.client.orm.public.ExternalUserMappings.where({
        tenantId,
        provider: PROVIDER,
        userId,
      }).first(),
      this.prisma.client.orm.public.ExternalIdentities.where({
        tenantId,
        provider: PROVIDER,
        userId,
      }).first(),
    ])
    if (!identity) return this.identityVO(mapping, null)
    const now = nowInstant()
    const revoked = await this.prisma.client.orm.public.ExternalIdentities.where({
      id: identity.id,
    }).update({
      status: 'REVOKED',
      revokedById: operatorId,
      revokedAt: now,
      updatedAt: now,
    })
    if (!revoked) throw new NotFoundException('企业微信身份不存在')
    return this.identityVO(mapping, revoked)
  }

  private async consumeState(
    state: string,
    browserNonce: string | undefined,
    context: LoginContext,
    flow: ExternalOAuthFlow,
    statePrefix: string,
  ) {
    if (!state.startsWith(`${statePrefix}.`)) {
      throw new UnauthorizedException('企业微信登录状态无效或已过期')
    }
    const result = await this.prisma.client.transaction(async (tx) => {
      const found = await tx.orm.public.ExternalOauthStates.where({
        stateHash: this.hash(state),
      }).first()
      if (!found) return null
      const consumed = await tx.orm.public.ExternalOauthStates.where({
        id: found.id,
        consumedAt: null,
      }).updateAndCount({ consumedAt: nowInstant() })
      return { row: found, consumed: consumed === 1 }
    })
    const row = result?.row
    if (
      !row ||
      !result.consumed ||
      row.flow !== flow ||
      row.expiresAt.epochMilliseconds < Date.now() ||
      !browserNonce ||
      row.browserNonceHash !== this.hash(browserNonce)
    ) {
      if (row) {
        await this.auth.recordExternalLoginFailure(
          {
            tenantId: row.tenantId,
            email: 'WECOM:unknown',
            authType: flow === WORKBENCH_FLOW ? 'WECOM_OAUTH2' : 'WECOM',
          },
          '企业微信登录状态无效、已过期或已被使用',
          context,
        )
      }
      throw new UnauthorizedException('企业微信登录状态无效或已过期')
    }
    return row
  }

  private async updateWorkbenchProfile(
    user: UserRow,
    profile: WeComOAuthLoginIdentity,
  ): Promise<void> {
    const data: {
      email?: string
      phone?: string
      gender?: boolean
    } = {}
    if (profile.phone) data.phone = profile.phone
    if (profile.gender !== null) data.gender = profile.gender
    if (profile.email && !user.email) {
      const owner = await this.prisma.client.orm.public.Users.where({ email: profile.email })
        .select('id')
        .first()
      if (!owner || owner.id === user.id) data.email = profile.email
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.client.orm.public.Users.where({ id: user.id }).update({
        ...data,
        updatedAt: nowInstant(),
      })
      await this.authCache?.invalidate(user.id)
    }
    if (profile.avatarUrl) {
      const extension = await this.prisma.client.orm.public.UserExtensions.where({ id: user.id })
        .select('id')
        .first()
      if (extension) {
        await this.prisma.client.orm.public.UserExtensions.where({ id: user.id }).update({
          avatar: profile.avatarUrl,
        })
      } else {
        await this.prisma.client.orm.public.UserExtensions.create({
          id: user.id,
          avatar: profile.avatarUrl,
        })
      }
    }
  }

  private async ensureLoginIdentity(
    integrationId: string,
    mapping: MappingRow,
    externalSubject: string,
  ): Promise<IdentityRow> {
    const existing = await this.prisma.client.orm.public.ExternalIdentities.where({
      tenantId: mapping.tenantId,
      provider: PROVIDER,
      externalSubject,
    }).first()
    if (existing) {
      if (existing.userId !== mapping.userId || existing.mappingId !== mapping.id) {
        throw new ConflictException('企业微信身份绑定冲突')
      }
      return existing
    }
    const byUser = await this.prisma.client.orm.public.ExternalIdentities.where({
      tenantId: mapping.tenantId,
      provider: PROVIDER,
      userId: mapping.userId,
    }).first()
    if (byUser) throw new ConflictException('本地成员已绑定其他企业微信身份')
    return this.prisma.client.orm.public.ExternalIdentities.create({
      tenantId: mapping.tenantId,
      integrationId,
      mappingId: mapping.id,
      provider: PROVIDER,
      externalSubject,
      userId: mapping.userId,
      bindingSource: 'LOGIN',
      updatedAt: nowInstant(),
    })
  }

  private async requireUser(tenantId: string, userId: string): Promise<UserRow> {
    const user = await this.prisma.client.orm.public.Users.where({ id: userId, tenantId }).first()
    if (!user) throw new NotFoundException('成员不存在')
    return user
  }

  private identityVO(mapping: MappingRow | null, identity: IdentityRow | null): ExternalIdentityVO {
    return {
      provider: PROVIDER,
      mapped: Boolean(mapping?.active),
      externalSubject: identity?.externalSubject ?? mapping?.externalId ?? null,
      status: identity?.status ?? null,
      boundAt: identity ? instantToISOString(identity.boundAt) : null,
      revokedAt: identity?.revokedAt ? instantToISOString(identity.revokedAt) : null,
      lastLoginAt: identity?.lastLoginAt ? instantToISOString(identity.lastLoginAt) : null,
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

  private workbenchReturnPath(target: string | undefined, requestOrigin?: string): string {
    const value = target?.trim()
    if (!value) return '/'
    if (value.startsWith('/') && !value.startsWith('//')) return value.slice(0, 500)

    const targetUrl = new URL(this.validHttpUrl(value))
    const publicUrl = this.config.get<string>('WEB_PUBLIC_URL')?.trim() || requestOrigin
    if (!publicUrl) throw new BadRequestException('无法确认企业微信工作台回跳域名')
    const publicOrigin = new URL(this.validHttpUrl(publicUrl)).origin
    if (targetUrl.origin !== publicOrigin) {
      throw new BadRequestException(
        `企业微信工作台回跳地址必须与 CRM 网页同域（当前 CRM 域名：${publicOrigin}）`,
      )
    }
    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`.slice(0, 500)
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
