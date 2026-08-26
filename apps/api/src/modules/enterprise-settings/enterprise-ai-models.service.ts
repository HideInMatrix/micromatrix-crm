import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  EnterpriseAiModelOptionVO,
  EnterpriseAiModelVO,
  EnterpriseAiRouteStrategyVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { CredentialCipherService } from '../../common/services/credential-cipher.service'
import type { EnterpriseAiModel } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type { SaveEnterpriseAiModelDto } from './dto/ai-model.dto'

@Injectable()
export class EnterpriseAiModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
  ) {}

  async list(tenantId: string, keyword?: string): Promise<EnterpriseAiModelVO[]> {
    const normalized = keyword?.trim()
    const rows = await this.prisma.enterpriseAiModel.findMany({
      where: {
        tenantId,
        ...(normalized && {
          OR: [
            { displayName: { contains: normalized, mode: 'insensitive' } },
            { modelName: { contains: normalized, mode: 'insensitive' } },
            { provider: { contains: normalized, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    })
    return rows.map((row) => this.toVO(row))
  }

  async options(tenantId: string): Promise<EnterpriseAiModelOptionVO[]> {
    const rows = await this.prisma.enterpriseAiModel.findMany({
      where: { tenantId, enable: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: { id: true, displayName: true },
    })
    return rows.map((row) => ({ id: row.id, name: row.displayName }))
  }

  async create(user: AuthUser, input: SaveEnterpriseAiModelDto): Promise<EnterpriseAiModelVO> {
    await this.assertDisplayNameAvailable(user.tenantId, input.displayName)
    const encrypted = input.apiKey?.trim() ? this.cipher.encrypt(input.apiKey.trim()) : null
    const row = await this.prisma.enterpriseAiModel.create({
      data: {
        tenantId: user.tenantId,
        displayName: input.displayName,
        modelName: input.modelName,
        provider: input.provider,
        apiUrl: input.apiUrl,
        enable: input.enable,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        topP: input.topP,
        globalDailyLimit: input.globalDailyLimit ?? null,
        userDailyLimit: input.userDailyLimit ?? null,
        createdById: user.id,
        updatedById: user.id,
        ...(encrypted && {
          apiKeyCiphertext: encrypted.ciphertext,
          apiKeyIv: encrypted.iv,
          apiKeyAuthTag: encrypted.authTag,
          apiKeyKeyVersion: encrypted.keyVersion,
        }),
      },
    })
    return this.toVO(row)
  }

  async update(user: AuthUser, id: string, input: SaveEnterpriseAiModelDto) {
    const existing = await this.ensureOwned(user.tenantId, id)
    await this.assertDisplayNameAvailable(user.tenantId, input.displayName, id)
    const encrypted = input.apiKey?.trim() ? this.cipher.encrypt(input.apiKey.trim()) : null
    const row = await this.prisma.enterpriseAiModel.update({
      where: { id: existing.id },
      data: {
        displayName: input.displayName,
        modelName: input.modelName,
        provider: input.provider,
        apiUrl: input.apiUrl,
        enable: input.enable,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        topP: input.topP,
        globalDailyLimit: input.globalDailyLimit ?? null,
        userDailyLimit: input.userDailyLimit ?? null,
        updatedById: user.id,
        ...(encrypted && {
          apiKeyCiphertext: encrypted.ciphertext,
          apiKeyIv: encrypted.iv,
          apiKeyAuthTag: encrypted.authTag,
          apiKeyKeyVersion: encrypted.keyVersion,
        }),
      },
    })
    return this.toVO(row)
  }

  async setStatus(tenantId: string, id: string, enable: boolean) {
    const existing = await this.ensureOwned(tenantId, id)
    const row = await this.prisma.enterpriseAiModel.update({
      where: { id: existing.id },
      data: { enable },
    })
    return this.toVO(row)
  }

  async remove(tenantId: string, id: string) {
    await this.ensureOwned(tenantId, id)
    await this.prisma.$transaction([
      this.prisma.enterpriseAiModelRoute.deleteMany({ where: { tenantId, modelId: id } }),
      this.prisma.enterpriseAiModel.delete({ where: { id } }),
    ])
    return { id }
  }

  async getRouteStrategy(tenantId: string): Promise<EnterpriseAiRouteStrategyVO> {
    const routes = await this.prisma.enterpriseAiModelRoute.findMany({
      where: { tenantId },
      orderBy: { sort: 'asc' },
      select: { modelId: true },
    })
    const existing = await this.prisma.enterpriseAiModel.findMany({
      where: { tenantId, id: { in: routes.map((row) => row.modelId) } },
      select: { id: true },
    })
    const valid = new Set(existing.map((row) => row.id))
    return { modelIds: routes.map((row) => row.modelId).filter((id) => valid.has(id)) }
  }

  async updateRouteStrategy(
    tenantId: string,
    modelIds: string[],
  ): Promise<EnterpriseAiRouteStrategyVO> {
    if (modelIds.length) {
      const models = await this.prisma.enterpriseAiModel.findMany({
        where: { tenantId, id: { in: modelIds } },
        select: { id: true },
      })
      if (models.length !== modelIds.length)
        throw new BadRequestException('路由策略包含不存在的模型')
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.enterpriseAiModelRoute.deleteMany({ where: { tenantId } })
      if (modelIds.length) {
        await tx.enterpriseAiModelRoute.createMany({
          data: modelIds.map((modelId, sort) => ({ tenantId, modelId, sort })),
        })
      }
    })
    return { modelIds }
  }

  private ensureOwned(tenantId: string, id: string) {
    return this.prisma.enterpriseAiModel.findFirst({ where: { id, tenantId } }).then((row) => {
      if (!row) throw new NotFoundException('模型不存在')
      return row
    })
  }

  private async assertDisplayNameAvailable(
    tenantId: string,
    displayName: string,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.enterpriseAiModel.findFirst({
      where: { tenantId, displayName, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true },
    })
    if (duplicate) throw new BadRequestException('模型名称已存在')
  }

  private toVO(row: EnterpriseAiModel): EnterpriseAiModelVO {
    return {
      id: row.id,
      displayName: row.displayName,
      modelName: row.modelName,
      provider: row.provider as EnterpriseAiModelVO['provider'],
      apiUrl: row.apiUrl,
      apiKeyConfigured: Boolean(row.apiKeyCiphertext),
      enable: row.enable,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
      topP: row.topP,
      globalDailyLimit: row.globalDailyLimit,
      userDailyLimit: row.userDailyLimit,
      dailyTotal: 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
