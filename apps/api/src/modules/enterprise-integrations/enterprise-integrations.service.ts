import { BadRequestException, Injectable } from '@nestjs/common'
import type { EnterpriseIntegrationVO, WeComConnectionTestVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { EnterpriseIntegration } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CredentialCipherService } from './credential-cipher.service'
import type { SaveWeComIntegrationDto } from './dto/wecom-integration.dto'
import { WeComClient } from './wecom.client'

const PROVIDER = 'WECOM' as const

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

  async saveWeCom(
    user: AuthUser,
    input: SaveWeComIntegrationDto,
  ): Promise<EnterpriseIntegrationVO> {
    const existing = await this.findWeCom(user.tenantId)
    const appSecret = input.appSecret?.trim() || null
    if (!existing && !appSecret) throw new BadRequestException('首次配置必须填写应用 Secret')

    const credentialsChanged =
      !existing ||
      existing.corpId !== input.corpId ||
      existing.agentId !== input.agentId ||
      appSecret !== null
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

    const row = await this.prisma.enterpriseIntegration.upsert({
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
        syncEnabled: false,
        createdById: user.id,
        updatedById: user.id,
      },
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

    const appSecret =
      submittedSecret ??
      this.cipher.decrypt({
        ciphertext: existing!.secretCiphertext,
        iv: existing!.secretIv,
        authTag: existing!.secretAuthTag,
        keyVersion: existing!.secretKeyVersion,
      })
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

    const row = await this.prisma.enterpriseIntegration.upsert({
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
        syncEnabled: false,
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
        syncEnabled: false,
        lastTestSucceeded: result.success,
        lastTestMessage: result.message.slice(0, 500),
        lastTestedAt: testedAt,
        createdById: user.id,
        updatedById: user.id,
      },
    })

    return {
      ...result,
      integration: this.toVO(row),
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
        syncEnabled: false,
        lastTestSucceeded: null,
        lastTestMessage: null,
        lastTestedAt: null,
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
      syncEnabled: row.syncEnabled,
      lastTestSucceeded: row.lastTestSucceeded,
      lastTestMessage: row.lastTestMessage,
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
