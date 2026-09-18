import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import type {
  ContractStageAddDto,
  ContractStageAdvancedConfigDto,
  ContractStageRollbackDto,
  ContractStageUpdateDto,
} from './dto/contract-stage.dto'

const MODULE_TYPE = 'contract'
const MAX_STAGE_COUNT = 15

@Injectable()
export class ContractStageService {
  constructor(private readonly prisma8: Prisma8Service) {}

  async get(user: AuthUser) {
    await this.ensureDefaults(user)
    const organizationId = prisma8Varchar(user.tenantId, 32)
    const [stages, counts, advanced] = await Promise.all([
      this.contractStages().where({ organizationId }).orderBy((row) => row.pos.asc()).all(),
      this.contracts()
        .where({ organizationId })
        .groupBy('stage')
        .aggregate((aggregate) => ({ count: aggregate.count() })),
      this.advancedConfigs()
        .where({ organizationId, moduleType: prisma8Varchar(MODULE_TYPE, 20) })
        .orderBy((row) => row.originId.asc())
        .orderBy((row) => row.targetId.asc())
        .all(),
    ])
    const countMap = new Map(counts.map((item) => [item.stage, item.count]))
    const grouped = new Map<string, Array<{ targetId: string; enable: boolean; circulationFieldValues: unknown[] }>>()
    for (const item of advanced) {
      const list = grouped.get(item.originId) ?? []
      list.push({
        targetId: item.targetId,
        enable: item.enable,
        circulationFieldValues: this.parseFieldConfig(item.fieldConfig),
      })
      grouped.set(item.originId, list)
    }
    const first = stages[0]
    return {
      stageConfigList: stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        type: stage._type,
        afootRollBack: stage.afootRollBack,
        endRollBack: stage.endRollBack,
        pos: Number(stage.pos),
        circulationType: stage.circulationType,
        stageHasData: (countMap.get(stage.id) ?? 0) > 0,
      })),
      afootRollBack: first?.afootRollBack ?? true,
      endRollBack: first?.endRollBack ?? false,
      circulationType: first?.circulationType ?? 'NORMAL',
      advancedConfigs: stages
        .filter((stage) => grouped.has(stage.id))
        .map((stage) => ({
          originId: stage.id,
          moduleType: MODULE_TYPE,
          targets: grouped.get(stage.id) ?? [],
        })),
    }
  }

  async add(user: AuthUser, dto: ContractStageAddDto) {
    await this.ensureDefaults(user)
    const stages = await this.list(user.tenantId)
    if (stages.length >= MAX_STAGE_COUNT) throw new BadRequestException('合同阶段最多配置 15 个')
    if (stages.some((item) => item.name === dto.name.trim())) throw new BadRequestException('合同阶段名称不能重复')
    const targetIndex = dto.targetId ? stages.findIndex((item) => item.id === dto.targetId) : -1
    const insertAt = targetIndex < 0
      ? stages.length
      : Math.max(0, targetIndex + ((dto.dropPosition ?? 1) > 0 ? 1 : 0))
    const first = stages[0]
    const now = BigInt(Date.now())
    const created = await this.contractStages().create({
      id: prisma8Id32(),
      name: prisma8Varchar(dto.name.trim(), 255),
      _type: prisma8Varchar(dto.type ?? 'AFOOT', 50),
      afootRollBack: first?.afootRollBack ?? true,
      endRollBack: first?.endRollBack ?? false,
      pos: BigInt(insertAt + 1),
      organizationId: prisma8Varchar(user.tenantId, 32),
      circulationType: prisma8Varchar(first?.circulationType ?? 'NORMAL', 50),
      createTime: now,
      updateTime: now,
      createUser: prisma8Varchar(user.id, 32),
      updateUser: prisma8Varchar(user.id, 32),
    })
    const ids = stages.map((item) => item.id)
    ids.splice(insertAt, 0, created.id)
    await this.sort(user, ids)
    return created.id
  }

  async update(user: AuthUser, dto: ContractStageUpdateDto) {
    const stage = await this.ensureStage(user.tenantId, dto.id)
    if (dto.name && dto.name.trim() !== stage.name) {
      const duplicate = await this.contractStages()
        .where({
          organizationId: prisma8Varchar(user.tenantId, 32),
          name: prisma8Varchar(dto.name.trim(), 255),
        })
        .where((row) => row.id.neq(prisma8Varchar(dto.id, 32)))
        .select('id')
        .first()
      if (duplicate) throw new BadRequestException('合同阶段名称不能重复')
    }
    await this.contractStages()
      .where({
        id: prisma8Varchar(dto.id, 32),
        organizationId: prisma8Varchar(user.tenantId, 32),
      })
      .update({
        ...(dto.name === undefined ? {} : { name: prisma8Varchar(dto.name.trim(), 255) }),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(user.id, 32),
      })
  }

  async remove(user: AuthUser, id: string) {
    const stage = await this.ensureStage(user.tenantId, id)
    const { count } = await this.contracts()
      .where({
        organizationId: prisma8Varchar(user.tenantId, 32),
        stage: prisma8Varchar(id, 32),
      })
      .aggregate((aggregate) => ({ count: aggregate.count() }))
    if (count > 0) throw new BadRequestException('该阶段下存在合同，无法删除')
    const stageId = prisma8Varchar(id, 32)
    const organizationId = prisma8Varchar(user.tenantId, 32)
    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.StageAdvancedConfig.where({
        organizationId,
        moduleType: prisma8Varchar(MODULE_TYPE, 20),
      })
        .where((row) => or(row.originId.eq(stageId), row.targetId.eq(stageId)))
        .deleteAndCount()
      await tx.orm.public.ContractStageConfig.where({ id: stageId, organizationId }).delete()
    })
    await this.normalizePositions(user)
    return { id, name: stage.name }
  }

  async updateRollback(user: AuthUser, dto: ContractStageRollbackDto) {
    await this.ensureDefaults(user)
    await this.contractStages()
      .where({ organizationId: prisma8Varchar(user.tenantId, 32) })
      .updateAndCount({
        afootRollBack: dto.afootRollBack,
        endRollBack: dto.endRollBack,
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(user.id, 32),
      })
  }

  async sort(user: AuthUser, ids: string[]) {
    const stages = await this.list(user.tenantId)
    const current = new Set<string>(stages.map((item) => item.id))
    if (ids.length !== current.size || new Set(ids).size !== current.size || ids.some((id) => !current.has(id))) {
      throw new BadRequestException('阶段排序必须包含当前全部阶段且不能重复')
    }
    const now = BigInt(Date.now())
    await this.prisma8.client.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.orm.public.ContractStageConfig.where({
          id: prisma8Varchar(id, 32),
          organizationId: prisma8Varchar(user.tenantId, 32),
        }).update({
          pos: BigInt(index + 1),
          updateTime: now,
          updateUser: prisma8Varchar(user.id, 32),
        })
      }
    })
  }

  async switchCirculationType(user: AuthUser, type: string) {
    if (!['NORMAL', 'ADVANCED'].includes(type)) throw new BadRequestException('合同阶段流转类型无效')
    await this.ensureDefaults(user)
    await this.contractStages()
      .where({ organizationId: prisma8Varchar(user.tenantId, 32) })
      .updateAndCount({
        circulationType: prisma8Varchar(type, 50),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(user.id, 32),
      })
  }

  async saveAdvancedConfig(user: AuthUser, dto: ContractStageAdvancedConfigDto) {
    const stages = await this.list(user.tenantId)
    const stageIds = new Set<string>(stages.map((item) => item.id))
    const now = BigInt(Date.now())
    const rows: Array<{
      id: ReturnType<typeof prisma8Id32>
      originId: ReturnType<typeof prisma8Id32>
      targetId: ReturnType<typeof prisma8Id32>
      enable: boolean
      fieldConfig: string
      moduleType: ReturnType<typeof prisma8Varchar<20>>
      organizationId: ReturnType<typeof prisma8Id32>
      createTime: bigint
      updateTime: bigint
      createUser: ReturnType<typeof prisma8Id32>
      updateUser: ReturnType<typeof prisma8Id32>
    }> = []
    const seen = new Set<string>()
    for (const setting of dto.circulationSettings) {
      if (!stageIds.has(setting.originId)) throw new BadRequestException('高级流转源阶段不存在')
      for (const target of setting.targets) {
        if (!stageIds.has(target.targetId)) throw new BadRequestException('高级流转目标阶段不存在')
        const key = `${setting.originId}:${target.targetId}`
        if (seen.has(key)) throw new BadRequestException('高级流转配置重复')
        seen.add(key)
        rows.push({
          id: prisma8Id32(),
          originId: prisma8Varchar(setting.originId, 32),
          targetId: prisma8Varchar(target.targetId, 32),
          enable: target.enable,
          fieldConfig: JSON.stringify(target.circulationFieldValues ?? []),
          moduleType: prisma8Varchar(MODULE_TYPE, 20),
          organizationId: prisma8Varchar(user.tenantId, 32),
          createTime: now,
          updateTime: now,
          createUser: prisma8Varchar(user.id, 32),
          updateUser: prisma8Varchar(user.id, 32),
        })
      }
    }
    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.StageAdvancedConfig.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
        moduleType: prisma8Varchar(MODULE_TYPE, 20),
      }).deleteAndCount()
      if (rows.length) await tx.orm.public.StageAdvancedConfig.createAll(rows)
      await tx.orm.public.ContractStageConfig.where({
        organizationId: prisma8Varchar(user.tenantId, 32),
      }).updateAndCount({
        circulationType: prisma8Varchar(dto.circulationType, 50),
        updateTime: now,
        updateUser: prisma8Varchar(user.id, 32),
      })
    })
  }

  async assertTransition(organizationId: string, originId: string, targetId: string) {
    if (originId === targetId) return [] as unknown[]
    const [origin, target, first] = await Promise.all([
      this.ensureStage(organizationId, originId),
      this.ensureStage(organizationId, targetId),
      this.contractStages()
        .where({ organizationId: prisma8Varchar(organizationId, 32) })
        .orderBy((row) => row.pos.asc())
        .first(),
    ])
    if (first?.circulationType === 'ADVANCED') {
      const config = await this.advancedConfigs()
        .where({
          organizationId: prisma8Varchar(organizationId, 32),
          moduleType: prisma8Varchar(MODULE_TYPE, 20),
          originId: prisma8Varchar(originId, 32),
          targetId: prisma8Varchar(targetId, 32),
        })
        .first()
      if (!config?.enable) throw new BadRequestException('当前合同阶段不允许流转到目标阶段')
      return this.parseFieldConfig(config.fieldConfig)
    }
    this.assertNormalTransition(origin, target)
    return [] as unknown[]
  }

  private assertNormalTransition(
    origin: {
      name: string
      _type: string
      pos: bigint
      afootRollBack: boolean
      endRollBack: boolean
    },
    target: { name: string; _type: string; pos: bigint },
  ) {
    const deny = () => {
      throw new BadRequestException(`[${origin.name}] 不允许流转至 [${target.name}]`)
    }
    if (origin.endRollBack && origin.afootRollBack) return
    if (!origin.endRollBack && !origin.afootRollBack) {
      if (target.pos > origin.pos) return
      return deny()
    }
    if (origin.endRollBack) {
      if (target.pos > origin.pos) return
      if (!(origin._type === 'AFOOT' && target._type === 'AFOOT')) return
      return deny()
    }
    if (origin.afootRollBack) {
      if (origin._type === 'END') return deny()
      if (target._type === 'AFOOT' || target._type === 'END') return
    }
    return deny()
  }

  private async list(organizationId: string) {
    return this.contractStages()
      .where({ organizationId: prisma8Varchar(organizationId, 32) })
      .orderBy((row) => row.pos.asc())
      .all()
  }

  private async ensureStage(organizationId: string, id: string) {
    const stage = await this.contractStages()
      .where({
        id: prisma8Varchar(id, 32),
        organizationId: prisma8Varchar(organizationId, 32),
      })
      .first()
    if (!stage) throw new NotFoundException('合同阶段不存在')
    return stage
  }

  private async ensureDefaults(user: AuthUser) {
    const { count } = await this.contractStages()
      .where({ organizationId: prisma8Varchar(user.tenantId, 32) })
      .aggregate((aggregate) => ({ count: aggregate.count() }))
    if (count > 0) return
    const defaults = [
      ['待签署', 'AFOOT'],
      ['已签署', 'AFOOT'],
      ['合同变更', 'AFOOT'],
      ['履行中', 'AFOOT'],
      ['履行完毕', 'AFOOT'],
      ['合同完结', 'END'],
      ['作废', 'END'],
    ] as const
    const now = BigInt(Date.now())
    await this.contractStages().createAll(
      defaults.map(([name, type], index) => ({
        id: prisma8Id32(),
        name: prisma8Varchar(name, 255),
        _type: prisma8Varchar(type, 50),
        afootRollBack: true,
        endRollBack: false,
        pos: BigInt(index + 1),
        organizationId: prisma8Varchar(user.tenantId, 32),
        circulationType: prisma8Varchar('NORMAL', 50),
        createTime: now,
        updateTime: now,
        createUser: prisma8Varchar(user.id, 32),
        updateUser: prisma8Varchar(user.id, 32),
      })),
    )
  }

  private async normalizePositions(user: AuthUser) {
    const ids = (await this.list(user.tenantId)).map((item) => item.id)
    if (ids.length) await this.sort(user, ids)
  }

  private parseFieldConfig(value: string | null): unknown[] {
    if (!value) return []
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private contractStages() {
    return this.prisma8.client.orm.public.ContractStageConfig
  }

  private contracts() {
    return this.prisma8.client.orm.public.Contract
  }

  private advancedConfigs() {
    return this.prisma8.client.orm.public.StageAdvancedConfig
  }
}
