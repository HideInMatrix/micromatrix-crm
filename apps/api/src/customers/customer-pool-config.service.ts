import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { FieldVO } from '@micromatrix/shared'
import type { AuthUser } from '../common/auth-user'
import { PrismaService } from '../prisma/prisma.service'
import { MetadataService } from '../modules/metadata/metadata.service'
import { CustomerPoolRepository } from '../modules/pool-rules/customer-pool.repository'
import type {
  CapacityExclusionCondition,
  DirectPoolConfigurationInput,
} from '../modules/pool-rules/pool-domain.types'
import { parseStringArray } from '../modules/pool-rules/pool-repository.helpers'
import type {
  AccountCapacityAddDto,
  AccountCapacityFilterDto,
  AccountCapacityUpdateDto,
  AccountPoolAddDto,
  AccountPoolPageDto,
  AccountPoolRecycleConditionDto,
  AccountPoolUpdateDto,
} from './dto/account-pool-config.dto'

type CustomerPoolRow = Awaited<ReturnType<CustomerPoolRepository['listPools']>>[number]

@Injectable()
export class CustomerPoolConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metadata: MetadataService,
    private readonly customerPools: CustomerPoolRepository,
  ) {}

  async page(user: AuthUser, dto: AccountPoolPageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 20
    const keyword = dto.keyword?.trim().toLowerCase()
    const [allRows, fields] = await Promise.all([
      this.customerPools.listPools(user.tenantId),
      this.metadata.listFields(user.tenantId, 'customer'),
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

  async add(user: AuthUser, dto: AccountPoolAddDto) {
    await this.assertPoolInput(user.tenantId, dto)
    await this.customerPools.createPool(user.tenantId, user.id, this.toPoolInput(dto))
  }

  async update(user: AuthUser, dto: AccountPoolUpdateDto) {
    await this.assertPoolInput(user.tenantId, dto)
    await this.customerPools.updatePool(user.tenantId, dto.id, user.id, this.toPoolInput(dto))
  }

  async noPick(user: AuthUser, poolId: string) {
    await this.assertPoolExists(user.tenantId, poolId)
    return (
      (await this.prisma.customer.count({
        where: { organizationId: user.tenantId, poolId, inSharedPool: true },
      })) > 0
    )
  }

  async remove(user: AuthUser, poolId: string) {
    await this.customerPools.deletePool(user.tenantId, poolId)
  }

  async switchStatus(user: AuthUser, poolId: string) {
    await this.customerPools.togglePool(user.tenantId, poolId, user.id)
  }

  async capacities(user: AuthUser) {
    const rows = await this.customerPools.listCapacities(user.tenantId)
    return rows.map((row) => {
      const scopeIds = parseStringArray(row.scopeId)
      return {
        id: row.id,
        scopeIds,
        members: scopeIds,
        capacity: row.capacity,
        filters: this.parseCapacityFilters(row.filter),
        createTime: Number(row.createTime),
        updateTime: Number(row.updateTime),
      }
    })
  }

  async addCapacity(user: AuthUser, dto: AccountCapacityAddDto) {
    const filters = await this.normalizeCapacityFilters(user, dto.capacity ?? null, dto.filters)
    await this.customerPools.createCapacity(user.tenantId, user.id, {
      scopeIds: dto.scopeIds,
      capacity: dto.capacity ?? null,
      filters,
    })
  }

  async updateCapacity(user: AuthUser, dto: AccountCapacityUpdateDto) {
    const filters = await this.normalizeCapacityFilters(user, dto.capacity ?? null, dto.filters)
    await this.customerPools.updateCapacity(user.tenantId, dto.id, user.id, {
      scopeIds: dto.scopeIds,
      capacity: dto.capacity ?? null,
      filters,
    })
  }

  async deleteCapacity(user: AuthUser, capacityId: string) {
    await this.customerPools.deleteCapacity(user.tenantId, capacityId)
  }

  private async assertPoolInput(
    organizationId: string,
    dto: AccountPoolAddDto | AccountPoolUpdateDto,
  ) {
    if (!dto.scopeIds.length) throw new BadRequestException('客户公海成员不能为空')
    if (!dto.ownerIds.length) throw new BadRequestException('客户公海管理员不能为空')
    if (dto.auto && !dto.recycleRule.conditions.length) {
      throw new BadRequestException('启用自动回收时至少配置一条回收条件')
    }
    await this.assertHiddenFields(organizationId, dto.hiddenFieldIds ?? [])
  }

  private toPoolInput(dto: AccountPoolAddDto | AccountPoolUpdateDto): DirectPoolConfigurationInput {
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
    const fields = await this.metadata.listFields(organizationId, 'customer')
    const fieldMap = new Map(fields.map((field) => [field.id, field]))
    const unknown = hiddenFieldIds.find((id) => !fieldMap.has(id))
    if (unknown) throw new NotFoundException(`客户字段「${unknown}」不存在`)
    const name = fields.find((field) => field.key === 'name')
    if (name && hiddenFieldIds.includes(name.id)) {
      throw new BadRequestException('客户名称固定显示，不能隐藏')
    }
  }

  private async normalizeCapacityFilters(
    user: AuthUser,
    capacity: number | null,
    filters?: AccountCapacityFilterDto[],
  ): Promise<CapacityExclusionCondition[]> {
    if (capacity === null || capacity === 0) return []
    const values = filters ?? []
    if (!values.length) return []
    if (values.length > 1) throw new BadRequestException('客户库容最多配置一条排除条件')
    const filter = values[0]
    if (!filter || filter.column !== 'stage') throw new BadRequestException('客户库容仅支持按商机阶段排除')
    if (!filter.value.length) throw new BadRequestException('请选择要排除的商机阶段')
    const stageCount = await this.prisma.opportunityStageConfig.count({
      where: { organizationId: user.tenantId, id: { in: filter.value } },
    })
    if (stageCount !== new Set(filter.value).size) {
      throw new BadRequestException('客户库容排除条件包含不存在的商机阶段')
    }
    return [{ column: 'stage', operator: filter.operator, value: [...filter.value] }]
  }

  private async assertPoolExists(organizationId: string, poolId: string) {
    const pool = (await this.customerPools.listPools(organizationId)).find((item) => item.id === poolId)
    if (!pool) throw new NotFoundException('客户公海不存在')
    return pool
  }

  private async mapPools(user: AuthUser, rows: CustomerPoolRow[], fields: FieldVO[]) {
    if (!rows.length) return []
    const userIds = [
      ...new Set(rows.flatMap((row) => [row.createUser, row.updateUser]).filter(Boolean)),
    ]
    const users = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, id: { in: userIds } },
      select: { id: true, name: true },
    })
    const userMap = new Map(users.map((item) => [item.id, item.name]))
    return rows.map((pool) => {
      const scopeIds = parseStringArray(pool.scopeId)
      const ownerIds = parseStringArray(pool.ownerId)
      const hiddenFieldIds = pool.hiddenFields.map((item) => item.fieldId)
      const hidden = new Set(hiddenFieldIds)
      return {
        id: pool.id,
        name: pool.name,
        scopeIds,
        ownerIds,
        members: scopeIds,
        owners: ownerIds,
        enable: pool.enable,
        auto: pool.auto,
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

  private parseRecycleConditions(raw: string | null): AccountPoolRecycleConditionDto[] {
    if (!raw) return []
    try {
      const value: unknown = JSON.parse(raw)
      return Array.isArray(value) ? (value as AccountPoolRecycleConditionDto[]) : []
    } catch {
      return []
    }
  }

  private parseCapacityFilters(raw: string | null): CapacityExclusionCondition[] {
    if (!raw) return []
    try {
      const value: unknown = JSON.parse(raw)
      return Array.isArray(value) ? (value as CapacityExclusionCondition[]) : []
    } catch {
      return []
    }
  }
}
