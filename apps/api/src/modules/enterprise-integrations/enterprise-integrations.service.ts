import { BadRequestException, Injectable } from '@nestjs/common'
import type {
  EnterpriseIntegrationVO,
  WeComConnectionTestVO,
  WeComIntegrationSecretVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { EnterpriseIntegration } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CredentialCipherService } from './credential-cipher.service'
import type { SaveWeComIntegrationDto, UpdateWeComSyncDto } from './dto/wecom-integration.dto'
import { WeComClient } from './wecom.client'

const PROVIDER = 'WECOM' as const

export interface WeComSyncContext {
  integration: EnterpriseIntegration
  credentials: { corpId: string; agentId: string; appSecret: string }
}

export type WeComRuntimeContext = WeComSyncContext

@Injectable()
export class EnterpriseIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly weComClient: WeComClient,
  ) {}

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

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.enterpriseIntegration.upsert({
        where: { tenantId_provider: { tenantId: user.tenantId, provider: PROVIDER } },
        update: {
          corpId: input.corpId,
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
                credentialVersion: { increment: 1 },
                syncEnabled: false,
                lastTestSucceeded: null,
                lastTestMessage: null,
                lastTestedAt: null,
              }
            : {}),
          updatedById: user.id,
        },
        create: {
          tenantId: user.tenantId,
          provider: PROVIDER,
          corpId: input.corpId,
          agentId: input.agentId,
          secretCiphertext: storedCredential.ciphertext,
          secretIv: storedCredential.iv,
          secretAuthTag: storedCredential.authTag,
          secretKeyVersion: storedCredential.keyVersion,
          credentialVersion: 1,
          syncEnabled: false,
          createdById: user.id,
          updatedById: user.id,
        },
      })
      if (existing && credentialsChanged) {
        await tx.organizationSyncBatch.updateMany({
          where: { integrationId: saved.id, status: 'PREVIEW_READY' },
          data: {
            status: 'INVALIDATED',
            errorCode: 'CREDENTIALS_CHANGED',
            errorMessage: '企业微信配置已变化，请重新生成同步预览',
            finishedAt: new Date(),
          },
        })
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
    const credentialsChanged =
      !existing ||
      existing.corpId !== input.corpId ||
      existing.agentId !== input.agentId ||
      (submittedSecret !== null && submittedSecret !== existingSecret)

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.enterpriseIntegration.upsert({
        where: { tenantId_provider: { tenantId: user.tenantId, provider: PROVIDER } },
        update: {
          corpId: input.corpId,
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
            ? { credentialVersion: { increment: 1 }, syncEnabled: false }
            : {}),
          lastTestSucceeded: result.success,
          lastTestMessage: result.message.slice(0, 500),
          lastTestedAt: testedAt,
          updatedById: user.id,
        },
        create: {
          tenantId: user.tenantId,
          provider: PROVIDER,
          corpId: input.corpId,
          agentId: input.agentId,
          secretCiphertext: storedCredential.ciphertext,
          secretIv: storedCredential.iv,
          secretAuthTag: storedCredential.authTag,
          secretKeyVersion: storedCredential.keyVersion,
          credentialVersion: 1,
          syncEnabled: false,
          lastTestSucceeded: result.success,
          lastTestMessage: result.message.slice(0, 500),
          lastTestedAt: testedAt,
          createdById: user.id,
          updatedById: user.id,
        },
      })
      if (existing && credentialsChanged) {
        await tx.organizationSyncBatch.updateMany({
          where: { integrationId: saved.id, status: 'PREVIEW_READY' },
          data: {
            status: 'INVALIDATED',
            errorCode: 'CREDENTIALS_CHANGED',
            errorMessage: '企业微信配置已变化，请重新生成同步预览',
            finishedAt: testedAt,
          },
        })
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

    const roleId = input.defaultRoleId ?? existing.syncDefaultRoleId
    if (input.enabled && !roleId) throw new BadRequestException('请选择新成员默认角色')
    if (roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: roleId, tenantId: user.tenantId },
        select: { id: true },
      })
      if (!role) throw new BadRequestException('默认角色不存在或不属于当前企业')
    }

    const row = await this.prisma.enterpriseIntegration.update({
      where: { id: existing.id },
      data: {
        syncEnabled: input.enabled,
        ...(roleId ? { syncDefaultRoleId: roleId } : {}),
        updatedById: user.id,
      },
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

  private findWeCom(tenantId: string) {
    return this.prisma.enterpriseIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: PROVIDER } },
    })
  }

  private toVO(row: EnterpriseIntegration | null): EnterpriseIntegrationVO {
    if (!row) {
      return {
        id: null,
        provider: PROVIDER,
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
      agentId: row.agentId,
      secretConfigured: Boolean(row.secretCiphertext && row.secretIv && row.secretAuthTag),
      credentialVersion: row.credentialVersion,
      syncEnabled: row.syncEnabled,
      syncDefaultRoleId: row.syncDefaultRoleId,
      lastTestSucceeded: row.lastTestSucceeded,
      lastTestMessage: row.lastTestMessage,
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      lastSyncStatus: row.lastSyncStatus,
      lastSyncMessage: row.lastSyncMessage,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
