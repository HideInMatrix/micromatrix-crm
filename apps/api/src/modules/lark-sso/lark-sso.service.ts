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
  LarkLoginDiscoveryVO,
  LarkLoginStartVO,
  LoginResult,
} from '@micromatrix/shared'
import { createHash, randomBytes } from 'node:crypto'
import { or } from '@prisma/orm-postgres/orm-client'
import { AuthService, type LoginContext } from '../../auth/auth.service'
import { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import {
  prisma8Now,
  prisma8TimestampFromDate,
  prisma8TimestampToISOString,
} from '../../prisma/prisma8-temporal'
import { LarkClient, type LarkOAuthLoginIdentity } from '../enterprise-integrations/lark.client'
import { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { LarkLoginCallbackDto, StartLarkLoginDto } from './dto/lark-sso.dto'

const PROVIDER = 'LARK' as const
const QR_FLOW = 'QR_LARK' as const
const OAUTH_FLOW = 'LARK' as const
const MOBILE_FLOW = 'LARK_MOBILE' as const
const QR_STATE_PREFIX = 'qr-lark'
const OAUTH_STATE_PREFIX = 'lark'
const MOBILE_STATE_PREFIX = 'lark-mobile'
const STATE_TTL_MS = 10 * 60 * 1_000

type ExternalOAuthFlow = typeof QR_FLOW | typeof OAUTH_FLOW | typeof MOBILE_FLOW
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
  boundAt: Parameters<typeof prisma8TimestampToISOString>[0]
  revokedAt: Parameters<typeof prisma8TimestampToISOString>[0] | null
  lastLoginAt: Parameters<typeof prisma8TimestampToISOString>[0] | null
}
type MappingWithUser = MappingRow & { user: UserRow }

@Injectable()
export class LarkSsoService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly config: ConfigService,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly larkClient: LarkClient,
    private readonly auth: AuthService,
    @Optional() private readonly authCache?: AuthContextCacheService,
  ) {}

  async discovery(tenantSlug?: string): Promise<LarkLoginDiscoveryVO> {
    const tenant = await this.resolveLoginTenant(tenantSlug)
    const integration = await this.prisma8.client.orm.public.EnterpriseIntegrations.where({
      tenantId: tenant.id,
      provider: PROVIDER,
    }).first()
    const activePlatform = await this.integrations.getActivePlatform(tenant.id)
    const reason =
      tenant.status !== 'ACTIVE'
        ? '企业账户已停用'
        : activePlatform.syncResource !== PROVIDER
          ? '当前企业协同平台不是飞书'
          : !integration
            ? '飞书尚未配置'
            : integration.lastTestSucceeded !== true
              ? '飞书连接尚未验证'
              : !integration.syncEnabled
                ? '飞书统一登录尚未开启'
                : !integration.redirectUrl
                  ? '飞书回调地址配置缺失'
                  : null
    return {
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      available: reason === null,
      reason,
      corpId: reason === null ? (integration?.corpId ?? null) : null,
      appId: reason === null ? (integration?.agentId ?? null) : null,
      redirectUrl: reason === null ? (integration?.redirectUrl ?? null) : null,
      loginPath: `/login?tenant=${encodeURIComponent(tenant.slug)}`,
    }
  }

  async start(
    input: StartLarkLoginDto,
  ): Promise<{ value: LarkLoginStartVO; browserNonce: string; secureCookie: boolean }> {
    const login = await this.createLoginState(input, QR_FLOW, QR_STATE_PREFIX)
    return this.loginStartResult(login, this.authorizationUrl(login, QR_FLOW))
  }

  async startOauth(
    input: StartLarkLoginDto,
  ): Promise<{ value: LarkLoginStartVO; browserNonce: string; secureCookie: boolean }> {
    const login = await this.createLoginState(input, OAUTH_FLOW, OAUTH_STATE_PREFIX)
    return this.loginStartResult(login, this.authorizationUrl(login, OAUTH_FLOW))
  }

  async startMobile(
    input: StartLarkLoginDto,
  ): Promise<{ value: LarkLoginStartVO; browserNonce: string; secureCookie: boolean }> {
    const login = await this.createLoginState(input, MOBILE_FLOW, MOBILE_STATE_PREFIX)
    return this.loginStartResult(login, this.authorizationUrl(login, MOBILE_FLOW))
  }

  async callback(
    input: LarkLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
  ): Promise<LoginResult & { returnPath: string }> {
    return this.callbackForFlow(input, browserNonce, context, QR_FLOW, QR_STATE_PREFIX)
  }

  async callbackOauth(
    input: LarkLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
  ): Promise<LoginResult & { returnPath: string }> {
    return this.callbackForFlow(input, browserNonce, context, OAUTH_FLOW, OAUTH_STATE_PREFIX)
  }

  async callbackMobile(
    input: LarkLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
  ): Promise<LoginResult & { returnPath: string }> {
    return this.callbackForFlow(input, browserNonce, context, MOBILE_FLOW, MOBILE_STATE_PREFIX)
  }

  async getIdentity(tenantId: string, userId: string): Promise<ExternalIdentityVO> {
    await this.requireUser(tenantId, userId)
    const [mapping, identity] = await Promise.all([
      this.prisma8.client.orm.public.ExternalUserMappings.where({ tenantId, provider: PROVIDER, userId }).first(),
      this.prisma8.client.orm.public.ExternalIdentities.where({ tenantId, provider: PROVIDER, userId }).first(),
    ])
    return this.identityVO(mapping, identity)
  }

  async bindIdentity(
    tenantId: string,
    userId: string,
    operatorId: string,
  ): Promise<ExternalIdentityVO> {
    await this.requireUser(tenantId, userId)
    const mapping = await this.prisma8.client.orm.public.ExternalUserMappings.where({
      tenantId,
      provider: PROVIDER,
      userId,
    }).first()
    if (!mapping?.active) throw new BadRequestException('该成员没有有效的飞书同步映射')
    const integration = await this.prisma8.client.orm.public.EnterpriseIntegrations.where({
      tenantId,
      provider: PROVIDER,
    }).first()
    if (!integration) throw new BadRequestException('请先配置飞书')

    const subjectOwner = await this.prisma8.client.orm.public.ExternalIdentities.where({
      tenantId,
      provider: PROVIDER,
      externalSubject: mapping.externalId,
    }).first()
    if (subjectOwner && subjectOwner.userId !== userId) {
      throw new ConflictException('该飞书身份已绑定其他成员')
    }
    const userIdentity = await this.prisma8.client.orm.public.ExternalIdentities.where({
      tenantId,
      provider: PROVIDER,
      userId,
    }).first()
    if (userIdentity && userIdentity.externalSubject !== mapping.externalId) {
      throw new ConflictException('该成员已绑定其他飞书身份')
    }
    const now = prisma8Now()
    const identity = userIdentity
      ? await this.prisma8.client.orm.public.ExternalIdentities.where({ id: userIdentity.id }).update({
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
      : await this.prisma8.client.orm.public.ExternalIdentities.create({
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
    if (!identity) throw new NotFoundException('飞书身份不存在')
    return this.identityVO(mapping, identity)
  }

  async unbindIdentity(
    tenantId: string,
    userId: string,
    operatorId: string,
  ): Promise<ExternalIdentityVO> {
    const user = await this.requireUser(tenantId, userId)
    const otherActiveIdentity = await this.prisma8.client.orm.public.ExternalIdentities.where({
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
      this.prisma8.client.orm.public.ExternalUserMappings.where({ tenantId, provider: PROVIDER, userId }).first(),
      this.prisma8.client.orm.public.ExternalIdentities.where({ tenantId, provider: PROVIDER, userId }).first(),
    ])
    if (!identity) return this.identityVO(mapping, null)
    const now = prisma8Now()
    const revoked = await this.prisma8.client.orm.public.ExternalIdentities.where({ id: identity.id }).update({
      status: 'REVOKED',
      revokedById: operatorId,
      revokedAt: now,
      updatedAt: now,
    })
    if (!revoked) throw new NotFoundException('飞书身份不存在')
    return this.identityVO(mapping, revoked)
  }

  private async createLoginState(
    input: StartLarkLoginDto,
    flow: ExternalOAuthFlow,
    statePrefix: string,
  ) {
    const discovery = await this.discovery(input.tenantSlug)
    if (!discovery.available) throw new BadRequestException(discovery.reason ?? '飞书登录不可用')
    const tenant = await this.prisma8.client.orm.public.Tenants.where({ slug: discovery.tenantSlug }).first()
    if (!tenant) throw new NotFoundException('企业标识不存在')
    const context = await this.integrations.getLarkRuntimeContext(tenant.id)
    if (!context.integration.syncEnabled) throw new BadRequestException('飞书统一登录尚未开启')
    const state = `${statePrefix}.${randomBytes(32).toString('base64url')}`
    const browserNonce = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + STATE_TTL_MS)
    const returnPath = this.safeReturnPath(input.returnPath)

    await this.prisma8.client.transaction(async (tx) => {
      const now = prisma8Now()
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
        expiresAt: prisma8TimestampFromDate(expiresAt),
      })
    })

    const redirectUri = this.redirectUri(context.credentials.redirectUrl, flow)
    return {
      appId: context.credentials.agentId,
      redirectUri,
      state,
      expiresAt: expiresAt.toISOString(),
      browserNonce,
      secureCookie: new URL(redirectUri).protocol === 'https:',
    }
  }

  private authorizationUrl(
    login: Awaited<ReturnType<LarkSsoService['createLoginState']>>,
    flow: ExternalOAuthFlow,
  ): string {
    const configured = this.config.get<string>(
      flow === QR_FLOW ? 'LARK_QR_LOGIN_BASE_URL' : 'LARK_OAUTH_LOGIN_BASE_URL',
    )
    const authorizationUrl = new URL(
      configured ??
        (flow === QR_FLOW
          ? 'https://passport.feishu.cn/suite/passport/oauth/authorize'
          : 'https://open.feishu.cn/open-apis/authen/v1/authorize'),
    )
    authorizationUrl.searchParams.set('redirect_uri', login.redirectUri)
    authorizationUrl.searchParams.set('state', login.state)
    if (flow === QR_FLOW) {
      authorizationUrl.searchParams.set('client_id', login.appId)
      authorizationUrl.searchParams.set('response_type', 'code')
    } else {
      authorizationUrl.searchParams.set('app_id', login.appId)
    }
    return authorizationUrl.toString()
  }

  private loginStartResult(
    login: Awaited<ReturnType<LarkSsoService['createLoginState']>>,
    authorizationUrl: string,
  ): { value: LarkLoginStartVO; browserNonce: string; secureCookie: boolean } {
    return {
      value: {
        authorizationUrl,
        appId: login.appId,
        redirectUri: login.redirectUri,
        state: login.state,
        expiresAt: login.expiresAt,
      },
      browserNonce: login.browserNonce,
      secureCookie: login.secureCookie,
    }
  }

  private async callbackForFlow(
    input: LarkLoginCallbackDto,
    browserNonce: string | undefined,
    context: LoginContext,
    flow: ExternalOAuthFlow,
    statePrefix: string,
  ): Promise<LoginResult & { returnPath: string }> {
    const state = await this.consumeState(input.state, browserNonce, context, flow, statePrefix)
    let externalSubject: string | undefined
    let mapping: MappingWithUser | null = null
    let identity: IdentityRow | null = null
    const authType = flow === QR_FLOW ? 'LARK' : 'LARK_OAUTH2'
    try {
      const runtime = await this.integrations.getLarkRuntimeContext(state.tenantId)
      if (!runtime.integration.syncEnabled || runtime.integration.id !== state.integrationId) {
        throw new UnauthorizedException('飞书登录状态已失效')
      }
      const profile = await this.larkClient.exchangeOAuthLoginCode(
        runtime.credentials,
        input.code,
        this.redirectUri(runtime.credentials.redirectUrl, flow),
      )
      externalSubject = profile.userId
      const mapped = await this.prisma8.client.orm.public.ExternalUserMappings.where({
        tenantId: state.tenantId,
        provider: PROVIDER,
        externalKey: profile.externalKey,
      }).first()
      if (!mapped?.active) throw new UnauthorizedException('飞书成员未同步或映射已失效')
      const mappedUser = await this.prisma8.client.orm.public.Users.where({
        id: mapped.userId,
        tenantId: state.tenantId,
      }).first()
      if (!mappedUser) throw new UnauthorizedException('飞书成员未同步或映射已失效')
      mapping = { ...mapped, user: mappedUser }
      if (mapping.user.status !== 'ACTIVE') throw new ForbiddenException('账号已被禁用')

      await this.updateProfile(mapping.user, profile)
      identity = await this.ensureLoginIdentity(state.integrationId, mapping, profile.userId)
      if (identity.status !== 'ACTIVE') {
        throw new ForbiddenException('飞书身份已解绑，请联系管理员恢复')
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
      const lastLoginAt = prisma8Now()
      await this.prisma8.client.orm.public.ExternalIdentities.where({ id: identity.id }).update({
        lastLoginAt,
        updatedAt: lastLoginAt,
      })
      return { ...result, returnPath: state.returnPath }
    } catch (error) {
      await this.auth.recordExternalLoginFailure(
        {
          tenantId: state.tenantId,
          userId: mapping?.userId,
          email: mapping?.user.email ?? `LARK:${externalSubject ?? 'unknown'}`,
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
    const authType = flow === QR_FLOW ? 'LARK' : 'LARK_OAUTH2'
    if (!state.startsWith(`${statePrefix}.`)) {
      throw new UnauthorizedException('飞书登录状态无效或已过期')
    }
    const result = await this.prisma8.client.transaction(async (tx) => {
      const found = await tx.orm.public.ExternalOauthStates.where({ stateHash: this.hash(state) }).first()
      if (!found) return null
      const consumed = await tx.orm.public.ExternalOauthStates.where({
        id: found.id,
        consumedAt: null,
      }).updateAndCount({ consumedAt: prisma8Now() })
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
          { tenantId: row.tenantId, email: 'LARK:unknown', authType },
          '飞书登录状态无效、已过期或已被使用',
          context,
        )
      }
      throw new UnauthorizedException('飞书登录状态无效或已过期')
    }
    return row
  }

  private async updateProfile(user: UserRow, profile: LarkOAuthLoginIdentity): Promise<void> {
    const data: { email?: string; phone?: string; gender?: boolean } = {}
    if (profile.phone) data.phone = profile.phone
    if (profile.gender !== null) data.gender = profile.gender
    if (profile.email && !user.email) {
      const owner = await this.prisma8.client.orm.public.Users.where({ email: profile.email }).select('id').first()
      if (!owner || owner.id === user.id) data.email = profile.email
    }
    if (Object.keys(data).length > 0) {
      await this.prisma8.client.orm.public.Users.where({ id: user.id }).update({
        ...data,
        updatedAt: prisma8Now(),
      })
      await this.authCache?.invalidate(user.id)
    }
    if (profile.avatarUrl) {
      const extension = await this.prisma8.client.orm.public.UserExtensions.where({ id: user.id })
        .select('id')
        .first()
      if (extension) {
        await this.prisma8.client.orm.public.UserExtensions.where({ id: user.id }).update({
          avatar: profile.avatarUrl,
        })
      } else {
        await this.prisma8.client.orm.public.UserExtensions.create({ id: user.id, avatar: profile.avatarUrl })
      }
    }
  }

  private async ensureLoginIdentity(
    integrationId: string,
    mapping: MappingRow,
    externalSubject: string,
  ): Promise<IdentityRow> {
    const existing = await this.prisma8.client.orm.public.ExternalIdentities.where({
      tenantId: mapping.tenantId,
      provider: PROVIDER,
      externalSubject,
    }).first()
    if (existing) {
      if (existing.userId !== mapping.userId || existing.mappingId !== mapping.id) {
        throw new ConflictException('飞书身份绑定冲突')
      }
      return existing
    }
    const byUser = await this.prisma8.client.orm.public.ExternalIdentities.where({
      tenantId: mapping.tenantId,
      provider: PROVIDER,
      userId: mapping.userId,
    }).first()
    if (byUser) throw new ConflictException('本地成员已绑定其他飞书身份')
    return this.prisma8.client.orm.public.ExternalIdentities.create({
      tenantId: mapping.tenantId,
      integrationId,
      mappingId: mapping.id,
      provider: PROVIDER,
      externalSubject,
      userId: mapping.userId,
      bindingSource: 'LOGIN',
      updatedAt: prisma8Now(),
    })
  }

  private async resolveLoginTenant(tenantSlug?: string) {
    const configuredDefault = this.config.get<string>('LARK_DEFAULT_TENANT_SLUG')?.trim()
    const requestedSlug = tenantSlug?.trim() || configuredDefault
    if (requestedSlug) {
      const tenant = await this.prisma8.client.orm.public.Tenants.where({ slug: requestedSlug }).first()
      if (!tenant) throw new NotFoundException('企业标识不存在')
      return tenant
    }
    const integrations = await this.prisma8.client.orm.public.EnterpriseIntegrations.where({
      provider: PROVIDER,
      lastTestSucceeded: true,
      syncEnabled: true,
    })
      .select('tenantId')
      .all()
    const tenantIds = [...new Set(integrations.map((integration) => integration.tenantId))]
    const tenants = tenantIds.length
      ? await this.prisma8.client.orm.public.Tenants.where({ status: 'ACTIVE' })
          .where((tenant) => tenant.id.in(tenantIds))
          .orderBy((tenant) => tenant.createdAt.asc())
          .limit(2)
          .all()
      : []
    if (tenants.length === 0) throw new NotFoundException('飞书统一登录尚未配置')
    if (tenants.length > 1)
      throw new BadRequestException('存在多个可用企业，请使用企业专属登录地址')
    return tenants[0]!
  }

  private async requireUser(tenantId: string, userId: string): Promise<UserRow> {
    const user = await this.prisma8.client.orm.public.Users.where({ id: userId, tenantId }).first()
    if (!user) throw new NotFoundException('成员不存在')
    return user
  }

  private identityVO(
    mapping: MappingRow | null,
    identity: IdentityRow | null,
  ): ExternalIdentityVO {
    return {
      provider: PROVIDER,
      mapped: Boolean(mapping?.active),
      externalSubject: identity?.externalSubject ?? mapping?.externalId ?? null,
      status: identity?.status ?? null,
      boundAt: identity ? prisma8TimestampToISOString(identity.boundAt) : null,
      revokedAt: identity?.revokedAt ? prisma8TimestampToISOString(identity.revokedAt) : null,
      lastLoginAt: identity?.lastLoginAt
        ? prisma8TimestampToISOString(identity.lastLoginAt)
        : null,
    }
  }

  private redirectUri(configured: string, flow: ExternalOAuthFlow): string {
    const base = this.validHttpUrl(configured)
    if (flow !== MOBILE_FLOW) return base
    return new URL('/mobile/lark/callback', base).toString()
  }

  private validHttpUrl(value: string): string {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new BadRequestException('飞书回调地址配置无效')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('飞书回调地址配置无效')
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
    return error instanceof Error ? error.message.slice(0, 500) : '飞书登录失败'
  }
}
