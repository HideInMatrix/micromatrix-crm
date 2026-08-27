import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { FieldVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import { MetadataService } from '../metadata/metadata.service'
import { CluePoolRepository } from '../pool-rules/clue-pool.repository'
import type { DirectPoolConfigurationInput } from '../pool-rules/pool-domain.types'
import {
  loadUserScopeTokens,
  parseStringArray,
  scopeMatches,
} from '../pool-rules/pool-repository.helpers'
import { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import type {
  ClueCapacityAddDto,
  ClueCapacityUpdateDto,
  CluePoolAddDto,
  CluePoolPageRequestDto,
  CluePoolRecycleConditionDto,
  CluePoolUpdateDto,
} from './dto/clue-pool-config.dto'

type CluePoolRow = Awaited<ReturnType<CluePoolRepository['listPools']>>[number]

@Injectable()
export class CluePoolConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metadata: MetadataService,
    private readonly cluePools: CluePoolRepository,
    private readonly pools: ResourcePoolsService,
  ) {}

  async options(user: AuthUser) {
    const [rows, fields] = await Promise.all([
      this.pools.options(user, 'lead'),
      this.metadata.listFields(user.tenantId, 'lead'),
    ])
    return this.mapPools(user, rows, fields)
  }

  async page(user: AuthUser, dto: CluePoolPageRequestDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 20
    const keyword = dto.keyword?.trim().toLowerCase()
    const [allRows, fields] = await Promise.all([
      this.cluePools.listPools(user.tenantId),
      this.metadata.listFields(user.tenantId, 'lead'),
    ])
    const filtered = keyword
      ? allRows.filter((row) => row.name.toLowerCase().includes(keyword))
      : allRows
    const rows = filtered.slice((current - 1) * pageSize, current * pageSize)
    return {
      list: await this.mapPools(user, rows, fields),
      total: filtered.length,
      current,
      pageSize,
    }
  }

  async add(user: AuthUser, dto: CluePoolAddDto) {
    await this.assertHiddenFields(user.tenantId, dto.hiddenFieldIds ?? [])
    await this.cluePools.createPool(user.tenantId, user.id, this.toPoolInput(dto))
  }

  async update(user: AuthUser, dto: CluePoolUpdateDto) {
    await this.assertHiddenFields(user.tenantId, dto.hiddenFieldIds ?? [])
    await this.cluePools.updatePool(user.tenantId, dto.id, user.id, this.toPoolInput(dto))
  }

  async quickUpdate(user: AuthUser, dto: CluePoolUpdateDto) {
    await this.assertPoolManager(user, dto.id)
    await this.update(user, dto)
  }

  async noPick(user: AuthUser, poolId: string) {
    await this.assertPoolExists(user.tenantId, poolId)
    return (
      (await this.prisma.clue.count({
        where: { organizationId: user.tenantId, poolId, inSharedPool: true },
      })) > 0
    )
  }

  async remove(user: AuthUser, poolId: string) {
    await this.cluePools.deletePool(user.tenantId, poolId)
  }

  async switchStatus(user: AuthUser, poolId: string) {
    await this.cluePools.togglePool(user.tenantId, poolId, user.id)
  }

  async capacities(user: AuthUser) {
    const rows = await this.cluePools.listCapacities(user.tenantId)
    return rows.map((row) => {
      const scopeIds = parseStringArray(row.scopeId)
      return {
        id: row.id,
        scopeIds,
        members: scopeIds,
        capacity: row.capacity,
        createTime: Number(row.createTime),
        updateTime: Number(row.updateTime),
      }
    })
  }

  async addCapacity(user: AuthUser, dto: ClueCapacityAddDto) {
    await this.cluePools.createCapacity(user.tenantId, user.id, {
      scopeIds: dto.scopeIds,
      capacity: dto.capacity ?? null,
    })
  }

  async updateCapacity(user: AuthUser, dto: ClueCapacityUpdateDto) {
    await this.cluePools.updateCapacity(user.tenantId, dto.id, user.id, {
      scopeIds: dto.scopeIds,
      capacity: dto.capacity ?? null,
    })
  }

  async deleteCapacity(user: AuthUser, capacityId: string) {
    await this.cluePools.deleteCapacity(user.tenantId, capacityId)
  }

  private toPoolInput(dto: CluePoolAddDto | CluePoolUpdateDto): DirectPoolConfigurationInput {
    return {
      name: dto.name,
      scopeIds: dto.scopeIds,
      ownerIds: dto.ownerIds,
      enable: dto.enable,
      auto: dto.auto,
      hiddenFieldIds: dto.hiddenFieldIds ?? [],
      pickRule: {
        limitOnNumber: dto.pickRule.limitOnNumber,
        pickNumber: dto.pickRule.pickNumber ?? null,
        limitPreOwner: dto.pickRule.limitPreOwner,
        pickIntervalDays: dto.pickRule.pickIntervalDays ?? null,
        limitNew: dto.pickRule.limitNew,
        newPickInterval: dto.pickRule.newPickInterval ?? null,
      },
      recycleRule: {
        operator: dto.recycleRule.operator,
        condition: JSON.stringify(dto.recycleRule.conditions ?? []),
      },
    }
  }

  private async assertHiddenFields(organizationId: string, hiddenFieldIds: string[]) {
    if (!hiddenFieldIds.length) return
    const fields = await this.metadata.listFields(organizationId, 'lead')
    const ids = new Set(fields.map((field) => field.id))
    const unknown = hiddenFieldIds.find((id) => !ids.has(id))
    if (unknown) throw new NotFoundException(`线索字段「${unknown}」不存在`)
  }

  private async assertPoolManager(user: AuthUser, poolId: string) {
    const pool = await this.assertPoolExists(user.tenantId, poolId)
    if (user.permissions.includes('*')) return
    const tokens = await this.prisma.$transaction((tx) =>
      loadUserScopeTokens(tx, user.tenantId, user.id),
    )
    if (!scopeMatches(pool.ownerId, tokens)) {
      throw new ForbiddenException('只有线索池管理员可以快捷保存该线索池')
    }
  }

  private async assertPoolExists(organizationId: string, poolId: string) {
    const pool = (await this.cluePools.listPools(organizationId)).find((item) => item.id === poolId)
    if (!pool) throw new NotFoundException('线索池不存在')
    return pool
  }

  private async mapPools(user: AuthUser, rows: CluePoolRow[], fields: FieldVO[]) {
    if (!rows.length) return []
    const userIds = [
      ...new Set(rows.flatMap((row) => [row.createUser, row.updateUser]).filter(Boolean)),
    ]
    const users = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, id: { in: userIds } },
      select: { id: true, name: true },
    })
    const userMap = new Map(users.map((item) => [item.id, item.name]))
    const tokens = user.permissions.includes('*')
      ? null
      : await this.prisma.$transaction((tx) => loadUserScopeTokens(tx, user.tenantId, user.id))

    return rows.map((pool) => {
      const scopeIds = parseStringArray(pool.scopeId)
      const ownerIds = parseStringArray(pool.ownerId)
      const hiddenFieldIds = pool.hiddenFields.map((item) => item.fieldId)
      const hidden = new Set(hiddenFieldIds)
      const editable = user.permissions.includes('*') || Boolean(tokens && scopeMatches(pool.ownerId, tokens))
      return {
        id: pool.id,
        name: pool.name,
        scopeIds,
        ownerIds,
        members: scopeIds,
        owners: ownerIds,
        enable: pool.enable,
        auto: pool.auto,
        editable,
        hiddenFieldIds,
        fieldConfigs: fields.map((field) => ({
          fieldId: field.id,
          fieldName: field.label,
          enable: !hidden.has(field.id),
          editable: field.key !== 'name',
        })),
        pickRule: pool.pickRule
          ? {
              limitOnNumber: pool.pickRule.limitOnNumber,
              pickNumber: pool.pickRule.pickNumber,
              limitPreOwner: pool.pickRule.limitPreOwner,
              pickIntervalDays: pool.pickRule.pickIntervalDays,
              limitNew: pool.pickRule.limitNew,
              newPickInterval: pool.pickRule.newPickInterval,
            }
          : null,
        recycleRule: pool.recycleRule
          ? {
              operator: pool.recycleRule.operator === 'OR' ? 'OR' : 'AND',
              conditions: this.parseRecycleConditions(pool.recycleRule.condition),
            }
          : null,
        createUserName: userMap.get(pool.createUser) ?? null,
        updateUserName: userMap.get(pool.updateUser) ?? null,
        createTime: Number(pool.createTime),
        updateTime: Number(pool.updateTime),
      }
    })
  }

  private parseRecycleConditions(raw: string | null): CluePoolRecycleConditionDto[] {
    if (!raw) return []
    try {
      const value: unknown = JSON.parse(raw)
      return Array.isArray(value) ? (value as CluePoolRecycleConditionDto[]) : []
    } catch {
      return []
    }
  }
}
