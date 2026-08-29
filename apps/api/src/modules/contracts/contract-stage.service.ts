import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
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
  constructor(private readonly prisma: PrismaService) {}

  async get(user: AuthUser) {
    await this.ensureDefaults(user)
    const [stages, counts, advanced] = await Promise.all([
      this.prisma.contractStageConfig.findMany({
        where: { organizationId: user.tenantId },
        orderBy: { pos: 'asc' },
      }),
      this.prisma.contract.groupBy({
        by: ['stage'],
        where: { organizationId: user.tenantId },
        _count: { _all: true },
      }),
      this.prisma.stageAdvancedConfig.findMany({
        where: { organizationId: user.tenantId, moduleType: MODULE_TYPE },
        orderBy: [{ originId: 'asc' }, { targetId: 'asc' }],
      }),
    ])
    const countMap = new Map(counts.map((item) => [item.stage, item._count._all]))
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
        type: stage.type,
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
    const created = await this.prisma.contractStageConfig.create({
      data: {
        name: dto.name.trim(),
        type: dto.type ?? 'AFOOT',
        afootRollBack: first?.afootRollBack ?? true,
        endRollBack: first?.endRollBack ?? false,
        pos: BigInt(insertAt + 1),
        organizationId: user.tenantId,
        circulationType: first?.circulationType ?? 'NORMAL',
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      },
    })
    const ids = stages.map((item) => item.id)
    ids.splice(insertAt, 0, created.id)
    await this.sort(user, ids)
    return created.id
  }

  async update(user: AuthUser, dto: ContractStageUpdateDto) {
    const stage = await this.ensureStage(user.tenantId, dto.id)
    if (dto.name && dto.name.trim() !== stage.name) {
      const duplicate = await this.prisma.contractStageConfig.findFirst({
        where: { organizationId: user.tenantId, name: dto.name.trim(), NOT: { id: dto.id } },
        select: { id: true },
      })
      if (duplicate) throw new BadRequestException('合同阶段名称不能重复')
    }
    await this.prisma.contractStageConfig.update({
      where: { id: dto.id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
    })
  }

  async remove(user: AuthUser, id: string) {
    const stage = await this.ensureStage(user.tenantId, id)
    const count = await this.prisma.contract.count({
      where: { organizationId: user.tenantId, stage: id },
    })
    if (count > 0) throw new BadRequestException('该阶段下存在合同，无法删除')
    await this.prisma.$transaction([
      this.prisma.stageAdvancedConfig.deleteMany({
        where: {
          organizationId: user.tenantId,
          moduleType: MODULE_TYPE,
          OR: [{ originId: id }, { targetId: id }],
        },
      }),
      this.prisma.contractStageConfig.delete({ where: { id } }),
    ])
    await this.normalizePositions(user)
    return { id, name: stage.name }
  }

  async updateRollback(user: AuthUser, dto: ContractStageRollbackDto) {
    await this.ensureDefaults(user)
    await this.prisma.contractStageConfig.updateMany({
      where: { organizationId: user.tenantId },
      data: {
        afootRollBack: dto.afootRollBack,
        endRollBack: dto.endRollBack,
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
    })
  }

  async sort(user: AuthUser, ids: string[]) {
    const stages = await this.list(user.tenantId)
    const current = new Set(stages.map((item) => item.id))
    if (ids.length !== current.size || new Set(ids).size !== current.size || ids.some((id) => !current.has(id))) {
      throw new BadRequestException('阶段排序必须包含当前全部阶段且不能重复')
    }
    const now = BigInt(Date.now())
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.contractStageConfig.update({
          where: { id },
          data: { pos: BigInt(index + 1), updateTime: now, updateUser: user.id },
        }),
      ),
    )
  }

  async switchCirculationType(user: AuthUser, type: string) {
    if (!['NORMAL', 'ADVANCED'].includes(type)) throw new BadRequestException('合同阶段流转类型无效')
    await this.ensureDefaults(user)
    await this.prisma.contractStageConfig.updateMany({
      where: { organizationId: user.tenantId },
      data: {
        circulationType: type,
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
    })
  }

  async saveAdvancedConfig(user: AuthUser, dto: ContractStageAdvancedConfigDto) {
    const stages = await this.list(user.tenantId)
    const stageIds = new Set(stages.map((item) => item.id))
    const now = BigInt(Date.now())
    const rows: Prisma.StageAdvancedConfigCreateManyInput[] = []
    const seen = new Set<string>()
    for (const setting of dto.circulationSettings) {
      if (!stageIds.has(setting.originId)) throw new BadRequestException('高级流转源阶段不存在')
      for (const target of setting.targets) {
        if (!stageIds.has(target.targetId)) throw new BadRequestException('高级流转目标阶段不存在')
        const key = `${setting.originId}:${target.targetId}`
        if (seen.has(key)) throw new BadRequestException('高级流转配置重复')
        seen.add(key)
        rows.push({
          originId: setting.originId,
          targetId: target.targetId,
          enable: target.enable,
          fieldConfig: JSON.stringify(target.circulationFieldValues ?? []),
          moduleType: MODULE_TYPE,
          organizationId: user.tenantId,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        })
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.stageAdvancedConfig.deleteMany({
        where: { organizationId: user.tenantId, moduleType: MODULE_TYPE },
      })
      if (rows.length) await tx.stageAdvancedConfig.createMany({ data: rows })
      await tx.contractStageConfig.updateMany({
        where: { organizationId: user.tenantId },
        data: {
          circulationType: dto.circulationType,
          updateTime: now,
          updateUser: user.id,
        },
      })
    })
  }

  async assertTransition(organizationId: string, originId: string, targetId: string) {
    if (originId === targetId) return [] as unknown[]
    const [origin, target, first] = await Promise.all([
      this.ensureStage(organizationId, originId),
      this.ensureStage(organizationId, targetId),
      this.prisma.contractStageConfig.findFirst({
        where: { organizationId },
        orderBy: { pos: 'asc' },
      }),
    ])
    if (first?.circulationType === 'ADVANCED') {
      const config = await this.prisma.stageAdvancedConfig.findUnique({
        where: {
          organizationId_moduleType_originId_targetId: {
            organizationId,
            moduleType: MODULE_TYPE,
            originId,
            targetId,
          },
        },
      })
      if (!config?.enable) throw new BadRequestException('当前合同阶段不允许流转到目标阶段')
      return this.parseFieldConfig(config.fieldConfig)
    }
    if (target.pos < origin.pos) {
      const rollback = origin.type === 'END' ? origin.endRollBack : origin.afootRollBack
      if (!rollback) throw new BadRequestException('当前合同阶段不允许回退')
    }
    return [] as unknown[]
  }

  private async list(organizationId: string) {
    return this.prisma.contractStageConfig.findMany({
      where: { organizationId },
      orderBy: { pos: 'asc' },
    })
  }

  private async ensureStage(organizationId: string, id: string) {
    const stage = await this.prisma.contractStageConfig.findFirst({
      where: { id, organizationId },
    })
    if (!stage) throw new NotFoundException('合同阶段不存在')
    return stage
  }

  private async ensureDefaults(user: AuthUser) {
    if ((await this.prisma.contractStageConfig.count({ where: { organizationId: user.tenantId } })) > 0) return
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
    await this.prisma.contractStageConfig.createMany({
      data: defaults.map(([name, type], index) => ({
        name,
        type,
        afootRollBack: true,
        endRollBack: false,
        pos: BigInt(index + 1),
        organizationId: user.tenantId,
        circulationType: 'NORMAL',
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })),
    })
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
}
