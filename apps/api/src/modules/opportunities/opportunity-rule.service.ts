import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import type { Prisma8Client } from '../../prisma/prisma8-client.js'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import { prisma8Id32, prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar.js'
import type {
  OpportunityRuleAddDto,
  OpportunityRuleConditionDto,
  OpportunityRulePageDto,
  OpportunityRuleUpdateDto,
} from './dto/opportunity-rule.dto'

type ScopeName = { id: string; name: string }
type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]
type OpportunityMatchRow = { id: string; stage: string; createTime: bigint }

@Injectable()
export class OpportunityRuleService {
  constructor(
    private readonly prisma8: Prisma8Service,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  async page(organizationId: string, dto: OpportunityRulePageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    let query = this.prisma8.client.orm.public.OpportunityRule.where({
      organizationId: prisma8Varchar(organizationId, 32),
    })
    const keyword = dto.keyword?.trim()
    if (keyword) query = query.where((rule) => rule.name.ilike(`%${keyword}%`))
    const [rows, aggregate] = await Promise.all([
      query
        .orderBy((rule) => rule.createTime.desc())
        .offset((current - 1) * pageSize)
        .limit(pageSize)
        .all(),
      query.aggregate((agg) => ({ count: agg.count() })),
    ])
    const list = await Promise.all(rows.map((row) => this.toVO(row)))
    return { list, total: aggregate.count, current, pageSize }
  }

  async add(organizationId: string, actorId: string, dto: OpportunityRuleAddDto) {
    await this.assertPayload(organizationId, dto)
    const now = BigInt(Date.now())
    return this.prisma8.client.orm.public.OpportunityRule.create({
      id: prisma8Id32(),
      name: prisma8Varchar(dto.name.trim(), 255),
      organizationId: prisma8Varchar(organizationId, 32),
      ownerId: JSON.stringify(dto.ownerIds),
      scopeId: JSON.stringify(dto.scopeIds),
      enable: dto.enable,
      auto: dto.auto,
      operator: prisma8Varchar(dto.operator ?? 'AND', 10),
      condition: JSON.stringify(dto.auto ? (dto.conditions ?? []) : []),
      createTime: now,
      updateTime: now,
      createUser: prisma8Varchar(actorId, 32),
      updateUser: prisma8Varchar(actorId, 32),
    })
  }

  async update(organizationId: string, actorId: string, dto: OpportunityRuleUpdateDto) {
    const current = await this.ensureOwned(organizationId, dto.id)
    const merged: OpportunityRuleAddDto = {
      name: dto.name ?? current.name,
      scopeIds: dto.scopeIds ?? this.parseArray(current.scopeId),
      ownerIds: dto.ownerIds ?? this.parseArray(current.ownerId),
      enable: dto.enable ?? current.enable,
      auto: dto.auto ?? current.auto,
      operator: dto.operator ?? ((current.operator === 'OR' ? 'OR' : 'AND') as 'AND' | 'OR'),
      conditions: dto.conditions ?? this.parseConditions(current.condition),
    }
    await this.assertPayload(organizationId, merged)
    return this.prisma8.client.orm.public.OpportunityRule.where({
      id: prisma8Varchar(dto.id, 32),
    }).update({
      name: prisma8Varchar(merged.name.trim(), 255),
      scopeId: JSON.stringify(merged.scopeIds),
      ownerId: JSON.stringify(merged.ownerIds),
      enable: merged.enable,
      auto: merged.auto,
      operator: prisma8Varchar(merged.operator ?? 'AND', 10),
      condition: JSON.stringify(merged.auto ? (merged.conditions ?? []) : []),
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(actorId, 32),
    })
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id)
    await this.prisma8.client.orm.public.OpportunityRule.where({
      id: prisma8Varchar(id, 32),
    }).deleteAndCount()
  }

  async toggle(organizationId: string, actorId: string, id: string) {
    const row = await this.ensureOwned(organizationId, id)
    await this.prisma8.client.orm.public.OpportunityRule.where({
      id: prisma8Varchar(id, 32),
    }).update({
      enable: !row.enable,
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(actorId, 32),
    })
  }

  /** Cordys TaskCleanupJob 同频：每天 03:00 执行自动商机关闭。 */
  @Cron('0 0 3 * * *')
  async scheduledAutoClose() {
    if (!this.coordinator) return void (await this.executeAutoClose())
    await this.coordinator.runScheduledOnce('opportunity-auto-close', 'DAILY', () =>
      this.executeAutoClose(),
    )
  }

  async executeAutoClose(now = new Date(), onlyRuleIds?: string[]) {
    const scopedRules = this.prisma8.client.orm.public.OpportunityRule.where({
      enable: true,
      auto: true,
    })
    const rules = await (onlyRuleIds?.length
      ? scopedRules.where((rule) => rule.id.in(prisma8Varchars(onlyRuleIds, 32)))
      : scopedRules
    )
      .select('id', 'organizationId', 'scopeId', 'operator', 'condition', 'createTime')
      .orderBy((rule) => rule.createTime.desc())
      .all()
    if (!rules.length) return { rules: 0, affected: 0 }

    const failStages = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      _type: prisma8Varchar('END', 50),
      rate: prisma8Varchar('0', 10),
    })
      .select('id', 'organizationId')
      .orderBy((stage) => stage.pos.asc())
      .all()
    const failStageByOrg = new Map(failStages.map((row) => [row.organizationId, row.id]))
    const assignedOwners = new Set<string>()
    let affected = 0

    for (const rule of rules) {
      const ownerIds = await this.prisma8.client.transaction((tx) =>
        this.resolveScopeUserIdsPrisma8(tx, rule.organizationId, this.parseArray(rule.scopeId)),
      )
      const matchedOwners = [...ownerIds].filter((id) => !assignedOwners.has(id))
      matchedOwners.forEach((id) => assignedOwners.add(id))
      if (!matchedOwners.length) continue

      const failStage = failStageByOrg.get(rule.organizationId)
      if (!failStage) continue
      const opportunities = await this.prisma8.client.orm.public.Opportunity.where({
        organizationId: rule.organizationId,
      })
        .where((opportunity) => opportunity.owner.in(prisma8Varchars(matchedOwners, 32)))
        .select('id', 'stage', 'createTime')
        .all()
      const conditions = this.parseConditions(rule.condition)
      for (const opportunity of opportunities) {
        if (!this.matches(rule.operator, conditions, opportunity, now)) continue
        await this.prisma8.client.orm.public.Opportunity.where({ id: opportunity.id }).update({
          lastStage: opportunity.stage,
          stage: failStage,
          failureReason: prisma8Varchar('system', 50),
        })
        affected++
      }
    }
    return { rules: rules.length, affected }
  }

  private async resolveScopeUserIdsPrisma8(
    tx: Prisma8Transaction,
    organizationId: string,
    scopeIds: string[],
  ): Promise<Set<string>> {
    const users = await tx.orm.public.Users.where({ tenantId: organizationId, status: 'ACTIVE' })
      .select('id', 'deptId')
      .all()
    if (scopeIds.includes('*')) return new Set(users.map((user) => user.id))

    const departments = await tx.orm.public.Departments.where({ tenantId: organizationId })
      .select('id', 'parentId')
      .all()
    const departmentIds = new Set(departments.map((department) => department.id))
    const children = new Map<string, string[]>()
    for (const department of departments) {
      if (!department.parentId) continue
      children.set(department.parentId, [...(children.get(department.parentId) ?? []), department.id])
    }
    const selectedDepartments = new Set(
      scopeIds
        .map((scopeId) => (scopeId.startsWith('dept:') ? scopeId.slice(5) : scopeId))
        .filter((scopeId) => departmentIds.has(scopeId)),
    )
    const queue = [...selectedDepartments]
    while (queue.length) {
      const current = queue.shift()!
      for (const child of children.get(current) ?? []) {
        if (selectedDepartments.has(child)) continue
        selectedDepartments.add(child)
        queue.push(child)
      }
    }

    const explicitUsers = new Set(
      scopeIds.map((scopeId) => (scopeId.startsWith('user:') ? scopeId.slice(5) : scopeId)),
    )
    const roles = await tx.orm.public.Roles.where({ tenantId: organizationId }).select('id').all()
    const roleIds = new Set(roles.map((role) => role.id))
    const selectedRoles = new Set(
      scopeIds
        .map((scopeId) => (scopeId.startsWith('role:') ? scopeId.slice(5) : scopeId))
        .filter((scopeId) => roleIds.has(scopeId)),
    )
    const userRoles = await tx.orm.public.UserRoles.where({ tenantId: organizationId })
      .select('userId', 'roleId')
      .all()
    const rolesByUser = new Map<string, Set<string>>()
    for (const userRole of userRoles) {
      const assigned = rolesByUser.get(userRole.userId) ?? new Set<string>()
      assigned.add(userRole.roleId)
      rolesByUser.set(userRole.userId, assigned)
    }

    return new Set(
      users
        .filter(
          (user) =>
            explicitUsers.has(user.id) ||
            (!!user.deptId && selectedDepartments.has(user.deptId)) ||
            [...(rolesByUser.get(user.id) ?? [])].some((roleId) => selectedRoles.has(roleId)),
        )
        .map((user) => user.id),
    )
  }

  private async ensureOwned(organizationId: string, id: string) {
    const row = await this.prisma8.client.orm.public.OpportunityRule.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(organizationId, 32),
    }).first()
    if (!row) throw new NotFoundException('商机关闭规则不存在')
    return row
  }

  private async assertPayload(organizationId: string, dto: OpportunityRuleAddDto) {
    if (!dto.scopeIds.length) throw new BadRequestException('规则适用范围不能为空')
    if (!dto.ownerIds.length) throw new BadRequestException('规则管理员不能为空')
    const conditions = dto.conditions ?? []
    if (dto.auto && !conditions.length) throw new BadRequestException('自动关闭规则至少需要一个条件')
    const stageIds = new Set(
      conditions
        .filter((condition) => condition.column === 'opportunityStage')
        .flatMap((condition) => condition.value.split(',').map((value) => value.trim()).filter(Boolean)),
    )
    if (stageIds.size) {
      const rows = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
        organizationId: prisma8Varchar(organizationId, 32),
      })
        .where((stage) => stage.id.in(prisma8Varchars([...stageIds], 32)))
        .select('id')
        .all()
      if (rows.length !== stageIds.size) throw new BadRequestException('关闭规则包含无效商机阶段')
    }
    for (const condition of conditions) this.assertCondition(condition)
  }

  private assertCondition(condition: OpportunityRuleConditionDto) {
    if (condition.column === 'opportunityStage') {
      if (condition.operator !== 'IN' && condition.operator !== 'NOT_IN') {
        throw new BadRequestException('商机阶段条件仅支持 IN/NOT_IN')
      }
      if (!condition.value.split(',').some((value) => value.trim())) {
        throw new BadRequestException('请选择商机阶段')
      }
      return
    }
    if (condition.operator !== 'FIXED' && condition.operator !== 'DYNAMICS') {
      throw new BadRequestException('创建时间条件仅支持 FIXED/DYNAMICS')
    }
    if (!this.timeMatcher(condition, Date.now(), new Date())) {
      // timeMatcher 返回 false 也可能只是当前时间不命中，因此这里只验证格式。
      if (!this.isValidTimeCondition(condition)) throw new BadRequestException('关闭规则时间条件格式不正确')
    }
  }

  private matches(
    operator: string | null,
    conditions: OpportunityRuleConditionDto[],
    opportunity: OpportunityMatchRow,
    now: Date,
  ) {
    if (!conditions.length) return false
    const results = conditions.map((condition) => {
      if (condition.column === 'opportunityStage') {
        const stages = condition.value.split(',').map((value) => value.trim()).filter(Boolean)
        const included = stages.includes(opportunity.stage)
        return condition.operator === 'IN' ? included : !included
      }
      return this.timeMatcher(condition, Number(opportunity.createTime), now)
    })
    return operator === 'OR' ? results.some(Boolean) : results.every(Boolean)
  }

  private timeMatcher(condition: OpportunityRuleConditionDto, time: number, now: Date) {
    const parts = condition.value.split(',').map((value) => value.trim()).filter(Boolean)
    if (condition.operator === 'FIXED') {
      if (parts.length !== 2) return false
      const start = this.parseTime(parts[0])
      const end = this.parseTime(parts[1])
      return start !== null && end !== null && time >= start && time <= end
    }
    const threshold = this.dynamicThreshold(parts, now)
    if (!threshold) return false
    return threshold.direction === 'before' ? time < threshold.time : time > threshold.time
  }

  private isValidTimeCondition(condition: OpportunityRuleConditionDto) {
    const parts = condition.value.split(',').map((value) => value.trim()).filter(Boolean)
    if (condition.operator === 'FIXED') {
      return parts.length === 2 && this.parseTime(parts[0]) !== null && this.parseTime(parts[1]) !== null
    }
    return this.dynamicThreshold(parts, new Date()) !== null
  }

  private dynamicThreshold(parts: string[], now: Date): { time: number; direction: 'before' | 'after' } | null {
    let amount: number
    let unit: string
    if (parts.length === 2) {
      amount = Number(parts[0])
      unit = parts[1] === 'day' ? 'BEFORE_DAY' : parts[1] === 'week' ? 'BEFORE_WEEK' : parts[1] === 'month' ? 'BEFORE_MONTH' : ''
    } else if (parts.length === 3) {
      amount = Number(parts[1])
      unit = parts[2]
    } else {
      return null
    }
    if (!Number.isFinite(amount) || !unit) return null
    const direction = unit.startsWith('BEFORE_') ? 'before' : unit.startsWith('AFTER_') ? 'after' : null
    if (!direction) return null
    const date = new Date(now)
    const sign = direction === 'before' ? -1 : 1
    if (unit.endsWith('_DAY')) date.setDate(date.getDate() + sign * amount)
    else if (unit.endsWith('_WEEK')) date.setDate(date.getDate() + sign * amount * 7)
    else if (unit.endsWith('_MONTH')) date.setMonth(date.getMonth() + sign * amount)
    else return null
    return { time: date.getTime(), direction }
  }

  private parseTime(value: string) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }

  private parseArray(value: string) {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  private parseConditions(value: string | null): OpportunityRuleConditionDto[] {
    if (!value) return []
    try {
      const parsed: unknown = JSON.parse(value)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is OpportunityRuleConditionDto => !!item && typeof item === 'object')
    } catch {
      return []
    }
  }

  private async toVO(row: Awaited<ReturnType<OpportunityRuleService['ensureOwned']>>) {
    const [members, owners, users] = await Promise.all([
      this.scopeNames(row.organizationId, this.parseArray(row.scopeId)),
      this.scopeNames(row.organizationId, this.parseArray(row.ownerId)),
      this.prisma8.client.orm.public.Users.where({ tenantId: row.organizationId })
        .where((user) => user.id.in([row.createUser, row.updateUser]))
        .select('id', 'name')
        .all(),
    ])
    const userMap = new Map(users.map((user) => [user.id, user.name]))
    return {
      ...row,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      members,
      owners,
      createUserName: userMap.get(row.createUser) ?? null,
      updateUserName: userMap.get(row.updateUser) ?? null,
    }
  }

  private async scopeNames(organizationId: string, ids: string[]): Promise<ScopeName[]> {
    if (ids.includes('*')) return [{ id: '*', name: '全部' }]
    const normalized = ids.map((id) => id.replace(/^(user|dept|role):/, ''))
    const [users, departments, roles] = await Promise.all([
      this.prisma8.client.orm.public.Users.where({ tenantId: organizationId })
        .where((user) => user.id.in(normalized))
        .select('id', 'name')
        .all(),
      this.prisma8.client.orm.public.Departments.where({ tenantId: organizationId })
        .where((department) => department.id.in(normalized))
        .select('id', 'name')
        .all(),
      this.prisma8.client.orm.public.Roles.where({ tenantId: organizationId })
        .where((role) => role.id.in(normalized))
        .select('id', 'name')
        .all(),
    ])
    const names = new Map<string, string>([
      ...users.map((item) => [item.id, item.name] as const),
      ...departments.map((item) => [item.id, item.name] as const),
      ...roles.map((item) => [item.id, item.name] as const),
    ])
    return ids.map((id, index) => ({ id, name: names.get(normalized[index] ?? '') ?? id }))
  }
}

