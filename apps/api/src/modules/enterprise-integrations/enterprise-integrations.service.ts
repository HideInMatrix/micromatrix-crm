import { BadRequestException, Injectable, Optional } from '@nestjs/common'
import type {
  DingTalkConnectionTestVO,
  DingTalkIntegrationSecretVO,
  EnterpriseIntegrationPlatformStateVO,
  EnterpriseIntegrationProvider,
  EnterpriseIntegrationVO,
  LarkConnectionTestVO,
  LarkIntegrationSecretVO,
  WeComConnectionTestVO,
  WeComIntegrationSecretVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { CredentialCipherService } from '../../common/services/credential-cipher.service'
import { PrismaService } from '../../prisma/prisma.service'
import { nowInstant, instantFromDate, instantToISOString } from '../../prisma/temporal'
import type { SaveWeComIntegrationDto, UpdateWeComSyncDto } from './dto/wecom-integration.dto'
import type {
  SaveDingTalkIntegrationDto,
  UpdateDingTalkSyncDto,
} from './dto/dingtalk-integration.dto'
import type { SaveLarkIntegrationDto, UpdateLarkSyncDto } from './dto/lark-integration.dto'
import { DingTalkClient } from './dingtalk.client'
import { LarkClient } from './lark.client'
import { WeComClient } from './wecom.client'

const PROVIDER = 'WECOM' as const

type InstantTimestamp = Parameters<typeof instantToISOString>[0]
export type EnterpriseIntegrationRow = {
  id: string
  tenantId: string
  provider: EnterpriseIntegrationProvider
  corpId: string
  clientId: string | null
  agentId: string
  redirectUrl: string | null
  secretCiphertext: string
  secretIv: string
  secretAuthTag: string
  secretKeyVersion: number
  credentialVersion: number
  syncEnabled: boolean
  syncDefaultRoleId: string | null
  lastTestSucceeded: boolean | null
  lastTestMessage: string | null
  lastTestedAt: InstantTimestamp | null
  lastSyncStatus: EnterpriseIntegrationVO['lastSyncStatus']
  lastSyncMessage: string | null
  lastSyncedAt: InstantTimestamp | null
  createdById: string
  updatedById: string
  createdAt: InstantTimestamp
  updatedAt: InstantTimestamp
}

export interface WeComSyncContext {
  integration: EnterpriseIntegrationRow
  credentials: { corpId: string; agentId: string; appSecret: string }
}

export type WeComRuntimeContext = WeComSyncContext

export interface DingTalkSyncContext {
  integration: EnterpriseIntegrationRow
  credentials: { corpId: string; clientId: string; agentId: string; appSecret: string }
}

export type DingTalkRuntimeContext = DingTalkSyncContext

export interface LarkSyncContext {
  integration: EnterpriseIntegrationRow
  credentials: { corpId: string; agentId: string; appSecret: string; redirectUrl: string }
}

export type LarkRuntimeContext = LarkSyncContext

@Injectable()
export class EnterpriseIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly weComClient: WeComClient,
    @Optional() private readonly dingTalkClient?: DingTalkClient,
    @Optional() private readonly larkClient?: LarkClient,
  ) {}

  async getActivePlatform(tenantId: string): Promise<EnterpriseIntegrationPlatformStateVO> {
    const tenant = await this.prisma.client.orm.public.Tenants.where({ id: tenantId })
      .select('enterpriseSyncResource', 'enterpriseSynced')
      .first()
    if (!tenant) throw new BadRequestException('企业不存在')
    return {
      syncResource: tenant.enterpriseSyncResource,
      sync: tenant.enterpriseSynced,
    }
  }

  async switchActivePlatform(
    user: AuthUser,
    provider: EnterpriseIntegrationProvider,
  ): Promise<EnterpriseIntegrationPlatformStateVO> {
    const current = await this.getActivePlatform(user.tenantId)
    if (current.syncResource === provider) return current

    const switchedAt = nowInstant()
    return this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.EnterpriseIntegrations.where({
        tenantId: user.tenantId,
        syncEnabled: true,
      }).updateAll({ syncEnabled: false, updatedById: user.id, updatedAt: switchedAt })
      await tx.orm.public.OrganizationSyncBatches.where({
        tenantId: user.tenantId,
        status: 'PREVIEW_READY',
      }).updateAll({
        status: 'INVALIDATED',
        errorCode: 'ACTIVE_PROVIDER_CHANGED',
        errorMessage: '企业协同平台已切换，请重新生成同步预览',
        finishedAt: switchedAt,
        updatedAt: switchedAt,
      })
      const tenant = await tx.orm.public.Tenants.where({ id: user.tenantId }).update({
        enterpriseSyncResource: provider,
        enterpriseSynced: false,
        updatedAt: switchedAt,
      })
      if (!tenant) throw new BadRequestException('企业不存在')
      return {
        syncResource: tenant.enterpriseSyncResource,
        sync: tenant.enterpriseSynced,
      }
    })
  }

  async getWeCom(tenantId: string): Promise<EnterpriseIntegrationVO> {
    const row = await this.findWeCom(tenantId)
    return this.toVO(row)
  }

  async getWeComSecret(tenantId: string): Promise<WeComIntegrationSecretVO> {
    const row = await this.findWeCom(tenantId)
    if (!row) throw new BadRequestException('请先配置企业微信')
    return {
      appSecret: this.cipher.decrypt({
        ciphertext: row.secretCiphertext,
        iv: row.secretIv,
        authTag: row.secretAuthTag,
        keyVersion: row.secretKeyVersion,
      }),
    }
  }

  async saveWeCom(
    user: AuthUser,
    input: SaveWeComIntegrationDto,
  ): Promise<EnterpriseIntegrationVO> {
    const existing = await this.findWeCom(user.tenantId)
    const appSecret = input.appSecret?.trim() || null
    if (!existing && !appSecret) throw new BadRequestException('首次配置必须填写应用 Secret')

    const existingSecret =
      existing && appSecret
        ? this.cipher.decrypt({
            ciphertext: existing.secretCiphertext,
            iv: existing.secretIv,
            authTag: existing.secretAuthTag,
            keyVersion: existing.secretKeyVersion,
          })
        : null

    const credentialsChanged =
      !existing ||
      existing.corpId !== input.corpId ||
      existing.agentId !== input.agentId ||
      (appSecret !== null && appSecret !== existingSecret)
    const encrypted = appSecret ? this.cipher.encrypt(appSecret) : null
    const storedCredential =
      encrypted ??
      (existing
        ? {
            ciphertext: existing.secretCiphertext,
            iv: existing.secretIv,
            authTag: existing.secretAuthTag,
            keyVersion: existing.secretKeyVersion,
          }
        : null)
    if (!storedCredential) throw new BadRequestException('首次配置必须填写应用 Secret')

    const row = await this.prisma.client.transaction(async (tx) => {
      const updatedAt = nowInstant()
      const lockQuery = this.prisma.client.raw.sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`enterprise-integration:${user.tenantId}:WECOM`}, 0)
      )::text AS locked`.returnsRow({ locked: 'pg/text@1' })
      for await (const _row of tx.query(lockQuery.build())) break
      const current = await tx.orm.public.EnterpriseIntegrations.where({
        tenantId: user.tenantId,
        provider: PROVIDER,
      }).first()
      const saved = current
        ? await tx.orm.public.EnterpriseIntegrations.where({ id: current.id }).update({
            corpId: input.corpId,
            agentId: input.agentId,
            ...(input.redirectUrl !== undefined
              ? { redirectUrl: input.redirectUrl.trim() || null }
              : {}),
            ...(encrypted
              ? {
                  secretCiphertext: encrypted.ciphertext,
                  secretIv: encrypted.iv,
                  secretAuthTag: encrypted.authTag,
                  secretKeyVersion: encrypted.keyVersion,
                }
              : {}),
            ...(credentialsChanged
              ? {
                  credentialVersion: current.credentialVersion + 1,
                  syncEnabled: false,
                  lastTestSucceeded: null,
                  lastTestMessage: null,
                  lastTestedAt: null,
                }
              : {}),
            updatedById: user.id,
            updatedAt,
          })
        : await tx.orm.public.EnterpriseIntegrations.create({
            tenantId: user.tenantId,
            provider: PROVIDER,
            corpId: input.corpId,
            agentId: input.agentId,
            redirectUrl: input.redirectUrl?.trim() || null,
            secretCiphertext: storedCredential.ciphertext,
            secretIv: storedCredential.iv,
            secretAuthTag: storedCredential.authTag,
            secretKeyVersion: storedCredential.keyVersion,
            credentialVersion: 1,
            syncEnabled: false,
            createdById: user.id,
            updatedById: user.id,
            updatedAt,
          })
      if (!saved) throw new BadRequestException('请先配置企业微信')
      if (existing && credentialsChanged) {
        await tx.orm.public.OrganizationSyncBatches.where({
          integrationId: saved.id,
          status: 'PREVIEW_READY',
        }).updateAll({
          status: 'INVALIDATED',
          errorCode: 'CREDENTIALS_CHANGED',
          errorMessage: '企业微信配置已变化，请重新生成同步预览',
          finishedAt: updatedAt,
          updatedAt,
        })
      }
      if (existing && existing.corpId !== input.corpId) {
        await tx.orm.public.Tenants.where({
          id: user.tenantId,
          enterpriseSyncResource: PROVIDER,
        }).updateAll({ enterpriseSynced: false, updatedAt })
      }
      return saved
    })
    return this.toVO(row)
  }

  async testWeCom(user: AuthUser, input: SaveWeComIntegrationDto): Promise<WeComConnectionTestVO> {
    const existing = await this.findWeCom(user.tenantId)
    const submittedSecret = input.appSecret?.trim() || null
    if (!existing && !submittedSecret) {
      throw new BadRequestException('首次测试必须填写应用 Secret')
    }
    if (existing && existing.corpId !== input.corpId && !submittedSecret) {
      throw new BadRequestException('企业 ID 变化时必须重新填写应用 Secret')
    }

    const existingSecret = existing
      ? this.cipher.decrypt({
          ciphertext: existing.secretCiphertext,
          iv: existing.secretIv,
          authTag: existing.secretAuthTag,
          keyVersion: existing.secretKeyVersion,
        })
      : null
    const appSecret = submittedSecret ?? existingSecret
    if (!appSecret) throw new BadRequestException('首次测试必须填写应用 Secret')
    const result = await this.weComClient.testConnection({
      corpId: input.corpId,
      agentId: input.agentId,
      appSecret,
    })
    const encrypted = submittedSecret ? this.cipher.encrypt(submittedSecret) : null
    const storedCredential =
      encrypted ??
      (existing
        ? {
            ciphertext: existing.secretCiphertext,
            iv: existing.secretIv,
            authTag: existing.secretAuthTag,
            keyVersion: existing.secretKeyVersion,
          }
        : null)
    if (!storedCredential) throw new BadRequestException('首次测试必须填写应用 Secret')
    const testedAt = new Date()
    const testedAtTimestamp = instantFromDate(testedAt)
    const credentialsChanged =
      !existing ||
      existing.corpId !== input.corpId ||
      existing.agentId !== input.agentId ||
      (submittedSecret !== null && submittedSecret !== existingSecret)

    const row = await this.prisma.client.transaction(async (tx) => {
      const updatedAt = nowInstant()
      const lockQuery = this.prisma.client.raw.sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`enterprise-integration:${user.tenantId}:WECOM`}, 0)
      )::text AS locked`.returnsRow({ locked: 'pg/text@1' })
      for await (const _row of tx.query(lockQuery.build())) break
      const current = await tx.orm.public.EnterpriseIntegrations.where({
        tenantId: user.tenantId,
        provider: PROVIDER,
      }).first()
      const saved = current
        ? await tx.orm.public.EnterpriseIntegrations.where({ id: current.id }).update({
            corpId: input.corpId,
            agentId: input.agentId,
            ...(input.redirectUrl !== undefined
              ? { redirectUrl: input.redirectUrl.trim() || null }
              : {}),
            ...(encrypted
              ? {
                  secretCiphertext: encrypted.ciphertext,
                  secretIv: encrypted.iv,
                  secretAuthTag: encrypted.authTag,
                  secretKeyVersion: encrypted.keyVersion,
                }
              : {}),
            ...(credentialsChanged
              ? { credentialVersion: current.credentialVersion + 1, syncEnabled: false }
              : {}),
            lastTestSucceeded: result.success,
            lastTestMessage: result.message.slice(0, 500),
            lastTestedAt: testedAtTimestamp,
            updatedById: user.id,
            updatedAt,
          })
        : await tx.orm.public.EnterpriseIntegrations.create({
            tenantId: user.tenantId,
            provider: PROVIDER,
            corpId: input.corpId,
            agentId: input.agentId,
            redirectUrl: input.redirectUrl?.trim() || null,
            secretCiphertext: storedCredential.ciphertext,
            secretIv: storedCredential.iv,
            secretAuthTag: storedCredential.authTag,
            secretKeyVersion: storedCredential.keyVersion,
            credentialVersion: 1,
            syncEnabled: false,
            lastTestSucceeded: result.success,
            lastTestMessage: result.message.slice(0, 500),
            lastTestedAt: testedAtTimestamp,
            createdById: user.id,
            updatedById: user.id,
            updatedAt,
          })
      if (!saved) throw new BadRequestException('请先配置企业微信')
      if (existing && credentialsChanged) {
        await tx.orm.public.OrganizationSyncBatches.where({
          integrationId: saved.id,
          status: 'PREVIEW_READY',
        }).updateAll({
          status: 'INVALIDATED',
          errorCode: 'CREDENTIALS_CHANGED',
          errorMessage: '企业微信配置已变化，请重新生成同步预览',
          finishedAt: testedAtTimestamp,
          updatedAt,
        })
      }
      if (existing && existing.corpId !== input.corpId) {
        await tx.orm.public.Tenants.where({
          id: user.tenantId,
          enterpriseSyncResource: PROVIDER,
        }).updateAll({ enterpriseSynced: false, updatedAt })
      }
      return saved
    })

    return {
      ...result,
      integration: this.toVO(row),
    }
  }

  async updateWeComSync(
    user: AuthUser,
    input: UpdateWeComSyncDto,
  ): Promise<EnterpriseIntegrationVO> {
    const existing = await this.findWeCom(user.tenantId)
    if (!existing) throw new BadRequestException('请先配置企业微信')
    if (input.enabled && existing.lastTestSucceeded !== true) {
      throw new BadRequestException('请先完成企业微信连接测试')
    }
    if (input.enabled) await this.assertActiveProvider(user.tenantId, 'WECOM')

    const roleId = input.defaultRoleId ?? existing.syncDefaultRoleId
    if (input.enabled && !roleId) throw new BadRequestException('请选择新成员默认角色')
    if (roleId) {
      const role = await this.prisma.client.orm.public.Roles.where({
        id: roleId,
        tenantId: user.tenantId,
      })
        .select('id')
        .first()
      if (!role) throw new BadRequestException('默认角色不存在或不属于当前企业')
    }

    const row = await this.prisma.client.transaction(async (tx) => {
      const updatedAt = nowInstant()
      if (input.enabled) {
        await tx.orm.public.EnterpriseIntegrations.where({
          tenantId: user.tenantId,
          syncEnabled: true,
        })
          .where((integration) => integration.provider.neq('WECOM'))
          .updateAll({ syncEnabled: false, updatedById: user.id, updatedAt })
      }
      const saved = await tx.orm.public.EnterpriseIntegrations.where({ id: existing.id }).update({
        syncEnabled: input.enabled,
        ...(roleId ? { syncDefaultRoleId: roleId } : {}),
        updatedById: user.id,
        updatedAt,
      })
      if (!saved) throw new BadRequestException('请先配置企业微信')
      return saved
    })
    return this.toVO(row)
  }

  async getWeComSyncContext(tenantId: string): Promise<WeComSyncContext> {
    const context = await this.getWeComRuntimeContext(tenantId)
    if (!context.integration.syncDefaultRoleId) {
      throw new BadRequestException('请选择新成员默认角色')
    }
    return context
  }

  async getWeComRuntimeContext(tenantId: string): Promise<WeComRuntimeContext> {
    await this.assertActiveProvider(tenantId, 'WECOM')
    const integration = await this.findWeCom(tenantId)
    if (!integration) throw new BadRequestException('请先配置企业微信')
    if (integration.lastTestSucceeded !== true) {
      throw new BadRequestException('请先完成企业微信连接测试')
    }
    if (!integration.syncEnabled) throw new BadRequestException('请先开启同步组织架构')
    return {
      integration,
      credentials: {
        corpId: integration.corpId,
        agentId: integration.agentId,
        appSecret: this.cipher.decrypt({
          ciphertext: integration.secretCiphertext,
          iv: integration.secretIv,
          authTag: integration.secretAuthTag,
          keyVersion: integration.secretKeyVersion,
        }),
      },
    }
  }

  async getDingTalk(tenantId: string): Promise<EnterpriseIntegrationVO> {
    return this.toVO(await this.findDingTalk(tenantId), 'DINGTALK')
  }

  async getDingTalkSecret(tenantId: string): Promise<DingTalkIntegrationSecretVO> {
    const row = await this.findDingTalk(tenantId)
    if (!row) throw new BadRequestException('请先配置钉钉')
    return { appSecret: this.decryptSecret(row) }
  }

  async saveDingTalk(
    user: AuthUser,
    input: SaveDingTalkIntegrationDto,
  ): Promise<EnterpriseIntegrationVO> {
    const existing = await this.findDingTalk(user.tenantId)
    const submittedSecret = input.appSecret?.trim() || null
    if (!existing && !submittedSecret) throw new BadRequestException('首次配置必须填写应用 Secret')
    const existingSecret = existing ? this.decryptSecret(existing) : null
    const appSecret = submittedSecret ?? existingSecret
    if (!appSecret) throw new BadRequestException('首次配置必须填写应用 Secret')
    const credentialsChanged =
      !existing ||
      existing.corpId !== input.corpId ||
      existing.clientId !== input.clientId ||
      existing.agentId !== input.agentId ||
      (submittedSecret !== null && submittedSecret !== existingSecret)
    const encrypted = submittedSecret ? this.cipher.encrypt(submittedSecret) : null
    const credential = encrypted ?? {
      ciphertext: existing!.secretCiphertext,
      iv: existing!.secretIv,
      authTag: existing!.secretAuthTag,
      keyVersion: existing!.secretKeyVersion,
    }
    const row = await this.prisma.client.transaction(async (tx) => {
      const updatedAt = nowInstant()
      const lockQuery = this.prisma.client.raw.sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`enterprise-integration:${user.tenantId}:DINGTALK`}, 0)
      )::text AS locked`.returnsRow({ locked: 'pg/text@1' })
      for await (const _row of tx.query(lockQuery.build())) break
      const current = await tx.orm.public.EnterpriseIntegrations.where({
        tenantId: user.tenantId,
        provider: 'DINGTALK',
      }).first()
      const saved = current
        ? await tx.orm.public.EnterpriseIntegrations.where({ id: current.id }).update({
            corpId: input.corpId,
            clientId: input.clientId,
            agentId: input.agentId,
            ...(encrypted
              ? {
                  secretCiphertext: encrypted.ciphertext,
                  secretIv: encrypted.iv,
                  secretAuthTag: encrypted.authTag,
                  secretKeyVersion: encrypted.keyVersion,
                }
              : {}),
            ...(credentialsChanged
              ? {
                  credentialVersion: current.credentialVersion + 1,
                  syncEnabled: false,
                  lastTestSucceeded: null,
                  lastTestMessage: null,
                  lastTestedAt: null,
                }
              : {}),
            updatedById: user.id,
            updatedAt,
          })
        : await tx.orm.public.EnterpriseIntegrations.create({
            tenantId: user.tenantId,
            provider: 'DINGTALK',
            corpId: input.corpId,
            clientId: input.clientId,
            agentId: input.agentId,
            secretCiphertext: credential.ciphertext,
            secretIv: credential.iv,
            secretAuthTag: credential.authTag,
            secretKeyVersion: credential.keyVersion,
            credentialVersion: 1,
            syncEnabled: false,
            createdById: user.id,
            updatedById: user.id,
            updatedAt,
          })
      if (!saved) throw new BadRequestException('请先配置钉钉')
      if (existing && credentialsChanged) {
        await tx.orm.public.OrganizationSyncBatches.where({
          integrationId: saved.id,
          status: 'PREVIEW_READY',
        }).updateAll({
          status: 'INVALIDATED',
          errorCode: 'CREDENTIALS_CHANGED',
          errorMessage: '钉钉配置已变化，请重新生成同步预览',
          finishedAt: updatedAt,
          updatedAt,
        })
      }
      if (existing && existing.corpId !== input.corpId) {
        await tx.orm.public.Tenants.where({
          id: user.tenantId,
          enterpriseSyncResource: 'DINGTALK',
        }).updateAll({ enterpriseSynced: false, updatedAt })
      }
      return saved
    })
    return this.toVO(row)
  }

  async testDingTalk(
    user: AuthUser,
    input: SaveDingTalkIntegrationDto,
  ): Promise<DingTalkConnectionTestVO> {
    const existing = await this.findDingTalk(user.tenantId)
    const submittedSecret = input.appSecret?.trim() || null
    if (!existing && !submittedSecret) throw new BadRequestException('首次测试必须填写应用 Secret')
    const existingSecret = existing ? this.decryptSecret(existing) : null
    if (
      existing &&
      (existing.clientId !== input.clientId || existing.corpId !== input.corpId) &&
      !submittedSecret
    ) {
      throw new BadRequestException('AppKey 或企业 ID 变化时必须重新填写应用 Secret')
    }
    const appSecret = submittedSecret ?? existingSecret
    if (!appSecret) throw new BadRequestException('首次测试必须填写应用 Secret')
    if (!this.dingTalkClient) throw new BadRequestException('钉钉 Provider 未加载')
    const result = await this.dingTalkClient.testConnection({
      corpId: input.corpId,
      clientId: input.clientId,
      agentId: input.agentId,
      appSecret,
    })
    const encrypted = submittedSecret ? this.cipher.encrypt(submittedSecret) : null
    const credential = encrypted ?? {
      ciphertext: existing!.secretCiphertext,
      iv: existing!.secretIv,
      authTag: existing!.secretAuthTag,
      keyVersion: existing!.secretKeyVersion,
    }
    const credentialsChanged =
      !existing ||
      existing.corpId !== input.corpId ||
      existing.clientId !== input.clientId ||
      existing.agentId !== input.agentId ||
      (submittedSecret !== null && submittedSecret !== existingSecret)
    const testedAt = new Date()
    const testedAtTimestamp = instantFromDate(testedAt)
    const row = await this.prisma.client.transaction(async (tx) => {
      const updatedAt = nowInstant()
      const lockQuery = this.prisma.client.raw.sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`enterprise-integration:${user.tenantId}:DINGTALK`}, 0)
      )::text AS locked`.returnsRow({ locked: 'pg/text@1' })
      for await (const _row of tx.query(lockQuery.build())) break
      const current = await tx.orm.public.EnterpriseIntegrations.where({
        tenantId: user.tenantId,
        provider: 'DINGTALK',
      }).first()
      const saved = current
        ? await tx.orm.public.EnterpriseIntegrations.where({ id: current.id }).update({
            corpId: input.corpId,
            clientId: input.clientId,
            agentId: input.agentId,
            ...(encrypted
              ? {
                  secretCiphertext: encrypted.ciphertext,
                  secretIv: encrypted.iv,
                  secretAuthTag: encrypted.authTag,
                  secretKeyVersion: encrypted.keyVersion,
                }
              : {}),
            ...(credentialsChanged
              ? { credentialVersion: current.credentialVersion + 1, syncEnabled: false }
              : {}),
            lastTestSucceeded: result.success,
            lastTestMessage: result.message.slice(0, 500),
            lastTestedAt: testedAtTimestamp,
            updatedById: user.id,
            updatedAt,
          })
        : await tx.orm.public.EnterpriseIntegrations.create({
            tenantId: user.tenantId,
            provider: 'DINGTALK',
            corpId: input.corpId,
            clientId: input.clientId,
            agentId: input.agentId,
            secretCiphertext: credential.ciphertext,
            secretIv: credential.iv,
            secretAuthTag: credential.authTag,
            secretKeyVersion: credential.keyVersion,
            credentialVersion: 1,
            syncEnabled: false,
            lastTestSucceeded: result.success,
            lastTestMessage: result.message.slice(0, 500),
            lastTestedAt: testedAtTimestamp,
            createdById: user.id,
            updatedById: user.id,
            updatedAt,
          })
      if (!saved) throw new BadRequestException('请先配置钉钉')
      if (existing && credentialsChanged) {
        await tx.orm.public.OrganizationSyncBatches.where({
          integrationId: saved.id,
          status: 'PREVIEW_READY',
        }).updateAll({
          status: 'INVALIDATED',
          errorCode: 'CREDENTIALS_CHANGED',
          errorMessage: '钉钉配置已变化，请重新生成同步预览',
          finishedAt: testedAtTimestamp,
          updatedAt,
        })
      }
      if (existing && existing.corpId !== input.corpId) {
        await tx.orm.public.Tenants.where({
          id: user.tenantId,
          enterpriseSyncResource: 'DINGTALK',
        }).updateAll({ enterpriseSynced: false, updatedAt })
      }
      return saved
    })
    return { ...result, integration: this.toVO(row) }
  }

  async updateDingTalkSync(
    user: AuthUser,
    input: UpdateDingTalkSyncDto,
  ): Promise<EnterpriseIntegrationVO> {
    const existing = await this.findDingTalk(user.tenantId)
    if (!existing) throw new BadRequestException('请先配置钉钉')
    if (input.enabled && existing.lastTestSucceeded !== true) {
      throw new BadRequestException('请先完成钉钉连接测试')
    }
    if (input.enabled) await this.assertActiveProvider(user.tenantId, 'DINGTALK')
    const roleId = input.defaultRoleId ?? existing.syncDefaultRoleId
    if (input.enabled && !roleId) throw new BadRequestException('请选择新成员默认角色')
    if (roleId) {
      const role = await this.prisma.client.orm.public.Roles.where({
        id: roleId,
        tenantId: user.tenantId,
      })
        .select('id')
        .first()
      if (!role) throw new BadRequestException('默认角色不存在或不属于当前企业')
    }
    const row = await this.prisma.client.transaction(async (tx) => {
      const updatedAt = nowInstant()
      if (input.enabled) {
        await tx.orm.public.EnterpriseIntegrations.where({
          tenantId: user.tenantId,
          syncEnabled: true,
        })
          .where((integration) => integration.provider.neq('DINGTALK'))
          .updateAll({ syncEnabled: false, updatedById: user.id, updatedAt })
      }
      const saved = await tx.orm.public.EnterpriseIntegrations.where({ id: existing.id }).update({
        syncEnabled: input.enabled,
        ...(roleId ? { syncDefaultRoleId: roleId } : {}),
        updatedById: user.id,
        updatedAt,
      })
      if (!saved) throw new BadRequestException('请先配置钉钉')
      return saved
    })
    return this.toVO(row)
  }

  async getDingTalkRuntimeContext(tenantId: string): Promise<DingTalkRuntimeContext> {
    await this.assertActiveProvider(tenantId, 'DINGTALK')
    const integration = await this.findDingTalk(tenantId)
    if (!integration) throw new BadRequestException('请先配置钉钉')
    if (integration.lastTestSucceeded !== true)
      throw new BadRequestException('请先完成钉钉连接测试')
    if (!integration.clientId) throw new BadRequestException('钉钉 AppKey 配置缺失')
    return {
      integration,
      credentials: {
        corpId: integration.corpId,
        clientId: integration.clientId,
        agentId: integration.agentId,
        appSecret: this.decryptSecret(integration),
      },
    }
  }

  async getDingTalkSyncContext(tenantId: string): Promise<DingTalkSyncContext> {
    const context = await this.getDingTalkRuntimeContext(tenantId)
    if (!context.integration.syncEnabled) throw new BadRequestException('请先开启钉钉组织同步')
    if (!context.integration.syncDefaultRoleId)
      throw new BadRequestException('请选择新成员默认角色')
    return context
  }

  async getLark(tenantId: string): Promise<EnterpriseIntegrationVO> {
    return this.toVO(await this.findLark(tenantId), 'LARK')
  }

  async getLarkSecret(tenantId: string): Promise<LarkIntegrationSecretVO> {
    const row = await this.findLark(tenantId)
    if (!row) throw new BadRequestException('请先配置飞书')
    return { appSecret: this.decryptSecret(row) }
  }

  async saveLark(user: AuthUser, input: SaveLarkIntegrationDto): Promise<EnterpriseIntegrationVO> {
    const existing = await this.findLark(user.tenantId)
    const submittedSecret = input.appSecret?.trim() || null
    if (!existing && !submittedSecret) throw new BadRequestException('首次配置必须填写应用 Secret')
    const existingSecret = existing ? this.decryptSecret(existing) : null
    const appSecret = submittedSecret ?? existingSecret
    if (!appSecret) throw new BadRequestException('首次配置必须填写应用 Secret')
    const credentialsChanged =
      !existing ||
      existing.corpId !== input.corpId ||
      existing.agentId !== input.agentId ||
      existing.redirectUrl !== input.redirectUrl ||
      (submittedSecret !== null && submittedSecret !== existingSecret)
    const encrypted = submittedSecret ? this.cipher.encrypt(submittedSecret) : null
    const credential = encrypted ?? {
      ciphertext: existing!.secretCiphertext,
      iv: existing!.secretIv,
      authTag: existing!.secretAuthTag,
      keyVersion: existing!.secretKeyVersion,
    }

    const row = await this.prisma.client.transaction(async (tx) => {
      const updatedAt = nowInstant()
      const lockQuery = this.prisma.client.raw.sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`enterprise-integration:${user.tenantId}:LARK`}, 0)
      )::text AS locked`.returnsRow({ locked: 'pg/text@1' })
      for await (const _row of tx.query(lockQuery.build())) break
      const current = await tx.orm.public.EnterpriseIntegrations.where({
        tenantId: user.tenantId,
        provider: 'LARK',
      }).first()
      const saved = current
        ? await tx.orm.public.EnterpriseIntegrations.where({ id: current.id }).update({
            corpId: input.corpId,
            agentId: input.agentId,
            redirectUrl: input.redirectUrl,
            ...(encrypted
              ? {
                  secretCiphertext: encrypted.ciphertext,
                  secretIv: encrypted.iv,
                  secretAuthTag: encrypted.authTag,
                  secretKeyVersion: encrypted.keyVersion,
                }
              : {}),
            ...(credentialsChanged
              ? {
                  credentialVersion: current.credentialVersion + 1,
                  syncEnabled: false,
                  lastTestSucceeded: null,
                  lastTestMessage: null,
                  lastTestedAt: null,
                }
              : {}),
            updatedById: user.id,
            updatedAt,
          })
        : await tx.orm.public.EnterpriseIntegrations.create({
            tenantId: user.tenantId,
            provider: 'LARK',
            corpId: input.corpId,
            agentId: input.agentId,
            redirectUrl: input.redirectUrl,
            secretCiphertext: credential.ciphertext,
            secretIv: credential.iv,
            secretAuthTag: credential.authTag,
            secretKeyVersion: credential.keyVersion,
            credentialVersion: 1,
            syncEnabled: false,
            createdById: user.id,
            updatedById: user.id,
            updatedAt,
          })
      if (!saved) throw new BadRequestException('请先配置飞书')
      if (existing && credentialsChanged) {
        await tx.orm.public.OrganizationSyncBatches.where({
          integrationId: saved.id,
          status: 'PREVIEW_READY',
        }).updateAll({
          status: 'INVALIDATED',
          errorCode: 'CREDENTIALS_CHANGED',
          errorMessage: '飞书配置已变化，请重新生成同步预览',
          finishedAt: updatedAt,
          updatedAt,
        })
      }
      if (existing && existing.corpId !== input.corpId) {
        await tx.orm.public.Tenants.where({
          id: user.tenantId,
          enterpriseSyncResource: 'LARK',
        }).updateAll({ enterpriseSynced: false, updatedAt })
      }
      return saved
    })
    return this.toVO(row)
  }

  async testLark(user: AuthUser, input: SaveLarkIntegrationDto): Promise<LarkConnectionTestVO> {
    const existing = await this.findLark(user.tenantId)
    const submittedSecret = input.appSecret?.trim() || null
    if (!existing && !submittedSecret) throw new BadRequestException('首次测试必须填写应用 Secret')
    const existingSecret = existing ? this.decryptSecret(existing) : null
    if (
      existing &&
      (existing.corpId !== input.corpId ||
        existing.agentId !== input.agentId ||
        existing.redirectUrl !== input.redirectUrl) &&
      !submittedSecret
    ) {
      throw new BadRequestException('企业 ID、应用 ID 或回调地址变化时必须重新填写应用 Secret')
    }
    const appSecret = submittedSecret ?? existingSecret
    if (!appSecret) throw new BadRequestException('首次测试必须填写应用 Secret')
    if (!this.larkClient) throw new BadRequestException('飞书 Provider 未加载')
    const result = await this.larkClient.testConnection({
      corpId: input.corpId,
      agentId: input.agentId,
      appSecret,
      redirectUrl: input.redirectUrl,
    })
    const encrypted = submittedSecret ? this.cipher.encrypt(submittedSecret) : null
    const credential = encrypted ?? {
      ciphertext: existing!.secretCiphertext,
      iv: existing!.secretIv,
      authTag: existing!.secretAuthTag,
      keyVersion: existing!.secretKeyVersion,
    }
    const credentialsChanged =
      !existing ||
      existing.corpId !== input.corpId ||
      existing.agentId !== input.agentId ||
      existing.redirectUrl !== input.redirectUrl ||
      (submittedSecret !== null && submittedSecret !== existingSecret)
    const testedAt = new Date()
    const testedAtTimestamp = instantFromDate(testedAt)

    const row = await this.prisma.client.transaction(async (tx) => {
      const updatedAt = nowInstant()
      const lockQuery = this.prisma.client.raw.sql`SELECT pg_advisory_xact_lock(
        hashtextextended(${`enterprise-integration:${user.tenantId}:LARK`}, 0)
      )::text AS locked`.returnsRow({ locked: 'pg/text@1' })
      for await (const _row of tx.query(lockQuery.build())) break
      const current = await tx.orm.public.EnterpriseIntegrations.where({
        tenantId: user.tenantId,
        provider: 'LARK',
      }).first()
      const saved = current
        ? await tx.orm.public.EnterpriseIntegrations.where({ id: current.id }).update({
            corpId: input.corpId,
            agentId: input.agentId,
            redirectUrl: input.redirectUrl,
            ...(encrypted
              ? {
                  secretCiphertext: encrypted.ciphertext,
                  secretIv: encrypted.iv,
                  secretAuthTag: encrypted.authTag,
                  secretKeyVersion: encrypted.keyVersion,
                }
              : {}),
            ...(credentialsChanged
              ? { credentialVersion: current.credentialVersion + 1, syncEnabled: false }
              : {}),
            lastTestSucceeded: result.success,
            lastTestMessage: result.message.slice(0, 500),
            lastTestedAt: testedAtTimestamp,
            updatedById: user.id,
            updatedAt,
          })
        : await tx.orm.public.EnterpriseIntegrations.create({
            tenantId: user.tenantId,
            provider: 'LARK',
            corpId: input.corpId,
            agentId: input.agentId,
            redirectUrl: input.redirectUrl,
            secretCiphertext: credential.ciphertext,
            secretIv: credential.iv,
            secretAuthTag: credential.authTag,
            secretKeyVersion: credential.keyVersion,
            credentialVersion: 1,
            syncEnabled: false,
            lastTestSucceeded: result.success,
            lastTestMessage: result.message.slice(0, 500),
            lastTestedAt: testedAtTimestamp,
            createdById: user.id,
            updatedById: user.id,
            updatedAt,
          })
      if (!saved) throw new BadRequestException('请先配置飞书')
      if (existing && credentialsChanged) {
        await tx.orm.public.OrganizationSyncBatches.where({
          integrationId: saved.id,
          status: 'PREVIEW_READY',
        }).updateAll({
          status: 'INVALIDATED',
          errorCode: 'CREDENTIALS_CHANGED',
          errorMessage: '飞书配置已变化，请重新生成同步预览',
          finishedAt: testedAtTimestamp,
          updatedAt,
        })
      }
      if (existing && existing.corpId !== input.corpId) {
        await tx.orm.public.Tenants.where({
          id: user.tenantId,
          enterpriseSyncResource: 'LARK',
        }).updateAll({ enterpriseSynced: false, updatedAt })
      }
      return saved
    })
    return { ...result, integration: this.toVO(row) }
  }

  async updateLarkSync(user: AuthUser, input: UpdateLarkSyncDto): Promise<EnterpriseIntegrationVO> {
    const existing = await this.findLark(user.tenantId)
    if (!existing) throw new BadRequestException('请先配置飞书')
    if (input.enabled && existing.lastTestSucceeded !== true) {
      throw new BadRequestException('请先完成飞书连接测试')
    }
    if (input.enabled) await this.assertActiveProvider(user.tenantId, 'LARK')
    const roleId = input.defaultRoleId ?? existing.syncDefaultRoleId
    if (input.enabled && !roleId) throw new BadRequestException('请选择新成员默认角色')
    if (roleId) {
      const role = await this.prisma.client.orm.public.Roles.where({
        id: roleId,
        tenantId: user.tenantId,
      })
        .select('id')
        .first()
      if (!role) throw new BadRequestException('默认角色不存在或不属于当前企业')
    }
    const row = await this.prisma.client.transaction(async (tx) => {
      const updatedAt = nowInstant()
      if (input.enabled) {
        await tx.orm.public.EnterpriseIntegrations.where({
          tenantId: user.tenantId,
          syncEnabled: true,
        })
          .where((integration) => integration.provider.neq('LARK'))
          .updateAll({ syncEnabled: false, updatedById: user.id, updatedAt })
      }
      const saved = await tx.orm.public.EnterpriseIntegrations.where({ id: existing.id }).update({
        syncEnabled: input.enabled,
        ...(roleId ? { syncDefaultRoleId: roleId } : {}),
        updatedById: user.id,
        updatedAt,
      })
      if (!saved) throw new BadRequestException('请先配置飞书')
      return saved
    })
    return this.toVO(row)
  }

  async getLarkRuntimeContext(tenantId: string): Promise<LarkRuntimeContext> {
    await this.assertActiveProvider(tenantId, 'LARK')
    const integration = await this.findLark(tenantId)
    if (!integration) throw new BadRequestException('请先配置飞书')
    if (integration.lastTestSucceeded !== true)
      throw new BadRequestException('请先完成飞书连接测试')
    if (!integration.redirectUrl) throw new BadRequestException('飞书回调地址配置缺失')
    return {
      integration,
      credentials: {
        corpId: integration.corpId,
        agentId: integration.agentId,
        appSecret: this.decryptSecret(integration),
        redirectUrl: integration.redirectUrl,
      },
    }
  }

  async getLarkSyncContext(tenantId: string): Promise<LarkSyncContext> {
    const context = await this.getLarkRuntimeContext(tenantId)
    if (!context.integration.syncEnabled) throw new BadRequestException('请先开启飞书组织同步')
    if (!context.integration.syncDefaultRoleId)
      throw new BadRequestException('请选择新成员默认角色')
    return context
  }

  private findDingTalk(tenantId: string) {
    return this.prisma.client.orm.public.EnterpriseIntegrations.where({
      tenantId,
      provider: 'DINGTALK',
    }).first()
  }

  private findLark(tenantId: string) {
    return this.prisma.client.orm.public.EnterpriseIntegrations.where({
      tenantId,
      provider: 'LARK',
    }).first()
  }

  private decryptSecret(row: EnterpriseIntegrationRow): string {
    return this.cipher.decrypt({
      ciphertext: row.secretCiphertext,
      iv: row.secretIv,
      authTag: row.secretAuthTag,
      keyVersion: row.secretKeyVersion,
    })
  }

  private findWeCom(tenantId: string) {
    return this.prisma.client.orm.public.EnterpriseIntegrations.where({
      tenantId,
      provider: PROVIDER,
    }).first()
  }

  private async assertActiveProvider(
    tenantId: string,
    provider: EnterpriseIntegrationProvider,
  ): Promise<void> {
    const state = await this.getActivePlatform(tenantId)
    if (state.syncResource === provider) return
    throw new BadRequestException(
      `当前企业协同平台为${this.providerName(state.syncResource)}，请先切换平台`,
    )
  }

  private providerName(provider: EnterpriseIntegrationProvider): string {
    if (provider === 'DINGTALK') return '钉钉'
    if (provider === 'LARK') return '飞书'
    return '企业微信'
  }

  private toVO(
    row: EnterpriseIntegrationRow | null,
    provider: EnterpriseIntegrationVO['provider'] = PROVIDER,
  ): EnterpriseIntegrationVO {
    if (!row) {
      return {
        id: null,
        provider,
        configured: false,
        corpId: '',
        agentId: '',
        secretConfigured: false,
        credentialVersion: 0,
        syncEnabled: false,
        syncDefaultRoleId: null,
        lastTestSucceeded: null,
        lastTestMessage: null,
        lastTestedAt: null,
        lastSyncStatus: null,
        lastSyncMessage: null,
        lastSyncedAt: null,
        createdAt: null,
        updatedAt: null,
      }
    }
    return {
      id: row.id,
      provider: row.provider,
      configured: true,
      corpId: row.corpId,
      clientId: row.clientId,
      agentId: row.agentId,
      redirectUrl: row.redirectUrl,
      secretConfigured: Boolean(row.secretCiphertext && row.secretIv && row.secretAuthTag),
      credentialVersion: row.credentialVersion,
      syncEnabled: row.syncEnabled,
      syncDefaultRoleId: row.syncDefaultRoleId,
      lastTestSucceeded: row.lastTestSucceeded,
      lastTestMessage: row.lastTestMessage,
      lastTestedAt: row.lastTestedAt ? instantToISOString(row.lastTestedAt) : null,
      lastSyncStatus: row.lastSyncStatus,
      lastSyncMessage: row.lastSyncMessage,
      lastSyncedAt: row.lastSyncedAt ? instantToISOString(row.lastSyncedAt) : null,
      createdAt: instantToISOString(row.createdAt),
      updatedAt: instantToISOString(row.updatedAt),
    }
  }
}
