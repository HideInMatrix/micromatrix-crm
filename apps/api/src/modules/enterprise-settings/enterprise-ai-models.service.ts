import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  EnterpriseAiModelOptionVO,
  EnterpriseAiModelVO,
  EnterpriseAiRouteStrategyVO,
} from '@micromatrix/shared'
import { or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import { CredentialCipherService } from '../../common/services/credential-cipher.service'
import { PrismaService } from '../../prisma/prisma.service.js'
import { nowInstant, instantToISOString } from '../../prisma/temporal.js'
import type { SaveEnterpriseAiModelDto } from './dto/ai-model.dto'

type InstantTimestamp = Parameters<typeof instantToISOString>[0]

type EnterpriseAiModelRow = {
  id: string
  tenantId: string
  displayName: string
  modelName: string
  provider: string
  apiUrl: string
  apiKeyCiphertext: string | null
  apiKeyIv: string | null
  apiKeyAuthTag: string | null
  apiKeyKeyVersion: number | null
  enable: boolean
  temperature: number
  maxTokens: number
  topP: number
  globalDailyLimit: number | null
  userDailyLimit: number | null
  createdById: string
  updatedById: string
  createdAt: InstantTimestamp
  updatedAt: InstantTimestamp
}

@Injectable()
export class EnterpriseAiModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
  ) {}

  async list(tenantId: string, keyword?: string): Promise<EnterpriseAiModelVO[]> {
    const normalized = keyword?.trim()
    const scoped = this.aiModels().where({ tenantId })
    const filtered = normalized
      ? scoped.where((model) =>
          or(
            model.displayName.ilike(`%${normalized}%`),
            model.modelName.ilike(`%${normalized}%`),
            model.provider.ilike(`%${normalized}%`),
          ),
        )
      : scoped
    const rows = await filtered
      .orderBy([(model) => model.createdAt.desc(), (model) => model.id.asc()])
      .all()
    return rows.map((row) => this.toVO(row))
  }

  async options(tenantId: string): Promise<EnterpriseAiModelOptionVO[]> {
    const rows = await this.aiModels()
      .where({ tenantId, enable: true })
      .select('id', 'displayName')
      .orderBy([(model) => model.displayName.asc(), (model) => model.id.asc()])
      .all()
    return rows.map((row) => ({ id: row.id, name: row.displayName }))
  }

  async create(user: AuthUser, input: SaveEnterpriseAiModelDto): Promise<EnterpriseAiModelVO> {
    await this.assertDisplayNameAvailable(user.tenantId, input.displayName)
    const encrypted = input.apiKey?.trim() ? this.cipher.encrypt(input.apiKey.trim()) : null
    const row = await this.aiModels().create({
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
      updatedAt: nowInstant(),
      ...(encrypted && {
        apiKeyCiphertext: encrypted.ciphertext,
        apiKeyIv: encrypted.iv,
        apiKeyAuthTag: encrypted.authTag,
        apiKeyKeyVersion: encrypted.keyVersion,
      }),
    })
    return this.toVO(row)
  }

  async update(user: AuthUser, id: string, input: SaveEnterpriseAiModelDto) {
    const existing = await this.ensureOwned(user.tenantId, id)
    await this.assertDisplayNameAvailable(user.tenantId, input.displayName, id)
    const encrypted = input.apiKey?.trim() ? this.cipher.encrypt(input.apiKey.trim()) : null
    const row = await this.aiModels()
      .where({ id: existing.id, tenantId: user.tenantId })
      .update({
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
        updatedAt: nowInstant(),
        ...(encrypted && {
          apiKeyCiphertext: encrypted.ciphertext,
          apiKeyIv: encrypted.iv,
          apiKeyAuthTag: encrypted.authTag,
          apiKeyKeyVersion: encrypted.keyVersion,
        }),
      })
    if (!row) throw new NotFoundException('模型不存在')
    return this.toVO(row)
  }

  async setStatus(tenantId: string, id: string, enable: boolean) {
    const existing = await this.ensureOwned(tenantId, id)
    const row = await this.aiModels().where({ id: existing.id, tenantId }).update({
      enable,
      updatedAt: nowInstant(),
    })
    if (!row) throw new NotFoundException('模型不存在')
    return this.toVO(row)
  }

  async remove(tenantId: string, id: string) {
    await this.ensureOwned(tenantId, id)
    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.EnterpriseAiModelRoutes.where({ tenantId, modelId: id }).deleteAll()
      const deleted = await tx.orm.public.EnterpriseAiModels.where({ id, tenantId }).delete()
      if (!deleted) throw new NotFoundException('模型不存在')
    })
    return { id }
  }

  async getRouteStrategy(tenantId: string): Promise<EnterpriseAiRouteStrategyVO> {
    const routes = await this.aiModelRoutes()
      .where({ tenantId })
      .select('modelId')
      .orderBy((route) => route.sort.asc())
      .all()
    if (!routes.length) return { modelIds: [] }

    const existing = await this.aiModels()
      .where({ tenantId })
      .where((model) => model.id.in(routes.map((row) => row.modelId)))
      .select('id')
      .all()
    const valid = new Set(existing.map((row) => row.id))
    return { modelIds: routes.map((row) => row.modelId).filter((id) => valid.has(id)) }
  }

  async updateRouteStrategy(
    tenantId: string,
    modelIds: string[],
  ): Promise<EnterpriseAiRouteStrategyVO> {
    if (modelIds.length) {
      const models = await this.aiModels()
        .where({ tenantId })
        .where((model) => model.id.in(modelIds))
        .select('id')
        .all()
      if (models.length !== modelIds.length)
        throw new BadRequestException('路由策略包含不存在的模型')
    }
    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.EnterpriseAiModelRoutes.where({ tenantId }).deleteAll()
      if (modelIds.length) {
        const updatedAt = nowInstant()
        await tx.orm.public.EnterpriseAiModelRoutes.createAll(
          modelIds.map((modelId, sort) => ({ tenantId, modelId, sort, updatedAt })),
        )
      }
    })
    return { modelIds }
  }

  private async ensureOwned(tenantId: string, id: string) {
    const row = await this.aiModels().where({ id, tenantId }).first()
    if (!row) throw new NotFoundException('模型不存在')
    return row
  }

  private async assertDisplayNameAvailable(
    tenantId: string,
    displayName: string,
    excludeId?: string,
  ) {
    const duplicate = await this.aiModels().where({ tenantId, displayName }).select('id').first()
    if (duplicate && duplicate.id !== excludeId) throw new BadRequestException('模型名称已存在')
  }

  private aiModels() {
    return this.prisma.client.orm.public.EnterpriseAiModels
  }

  private aiModelRoutes() {
    return this.prisma.client.orm.public.EnterpriseAiModelRoutes
  }

  private toVO(row: EnterpriseAiModelRow): EnterpriseAiModelVO {
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
      createdAt: instantToISOString(row.createdAt),
      updatedAt: instantToISOString(row.updatedAt),
    }
  }
}
