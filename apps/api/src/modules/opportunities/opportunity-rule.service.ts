import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import type { Opportunity, OpportunityRule, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { resolveScopeUserIds } from '../pool-rules/pool-repository.helpers'
import type {
  OpportunityRuleAddDto,
  OpportunityRuleConditionDto,
  OpportunityRulePageDto,
  OpportunityRuleUpdateDto,
} from './dto/opportunity-rule.dto'

type ScopeName = { id: string; name: string }

@Injectable()
export class OpportunityRuleService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  async page(organizationId: string, dto: OpportunityRulePageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const where: Prisma.OpportunityRuleWhereInput = {
      organizationId,
      ...(dto.keyword?.trim() ? { name: { contains: dto.keyword.trim(), mode: 'insensitive' } } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.opportunityRule.findMany({
        where,
        orderBy: { createTime: 'desc' },
        skip: (current - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunityRule.count({ where }),
    ])
    const list = await Promise.all(rows.map((row) => this.toVO(row)))
    return { list, total, current, pageSize }
  }

  async add(organizationId: string, actorId: string, dto: OpportunityRuleAddDto) {
    await this.assertPayload(organizationId, dto)
    const now = BigInt(Date.now())
    return this.prisma.opportunityRule.create({
      data: {
        name: dto.name.trim(),
        organizationId,
        ownerId: JSON.stringify(dto.ownerIds),
        scopeId: JSON.stringify(dto.scopeIds),
        enable: dto.enable,
        auto: dto.auto,
        operator: dto.operator ?? 'AND',
        condition: JSON.stringify(dto.auto ? (dto.conditions ?? []) : []),
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      },
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
    return this.prisma.opportunityRule.update({
      where: { id: dto.id },
      data: {
        name: merged.name.trim(),
        scopeId: JSON.stringify(merged.scopeIds),
        ownerId: JSON.stringify(merged.ownerIds),
        enable: merged.enable,
        auto: merged.auto,
        operator: merged.operator ?? 'AND',
        condition: JSON.stringify(merged.auto ? (merged.conditions ?? []) : []),
        updateTime: BigInt(Date.now()),
        updateUser: actorId,
      },
    })
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id)
    await this.prisma.opportunityRule.delete({ where: { id } })
  }

  async toggle(organizationId: string, actorId: string, id: string) {
    const row = await this.ensureOwned(organizationId, id)
    await this.prisma.opportunityRule.update({
      where: { id },
      data: { enable: !row.enable, updateTime: BigInt(Date.now()), updateUser: actorId },
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
    const rules = await this.prisma.opportunityRule.findMany({
      where: {
        enable: true,
        auto: true,
        ...(onlyRuleIds?.length ? { id: { in: onlyRuleIds } } : {}),
      },
      orderBy: { createTime: 'desc' },
    })
    if (!rules.length) return { rules: 0, affected: 0 }

    const failStages = await this.prisma.opportunityStageConfig.findMany({
      where: { type: 'END', rate: '0' },
      orderBy: { pos: 'asc' },
      select: { id: true, organizationId: true },
    })
    const failStageByOrg = new Map(failStages.map((row) => [row.organizationId, row.id]))
    const assignedOwners = new Set<string>()
    let affected = 0

    for (const rule of rules) {
      const ownerIds = await this.prisma.$transaction((tx) =>
        resolveScopeUserIds(tx, rule.organizationId, this.parseArray(rule.scopeId)),
      )
      const matchedOwners = [...ownerIds].filter((id) => !assignedOwners.has(id))
      matchedOwners.forEach((id) => assignedOwners.add(id))
      if (!matchedOwners.length) continue

      const failStage = failStageByOrg.get(rule.organizationId)
      if (!failStage) continue
      const opportunities = await this.prisma.opportunity.findMany({
        where: { organizationId: rule.organizationId, owner: { in: matchedOwners } },
      })
      const conditions = this.parseConditions(rule.condition)
      for (const opportunity of opportunities) {
        if (!this.matches(rule.operator, conditions, opportunity, now)) continue
        await this.prisma.opportunity.update({
          where: { id: opportunity.id },
          data: {
            lastStage: opportunity.stage,
            stage: failStage,
            failureReason: 'system',
          },
        })
        affected++
      }
    }
    return { rules: rules.length, affected }
  }

  private async ensureOwned(organizationId: string, id: string) {
    const row = await this.prisma.opportunityRule.findFirst({ where: { id, organizationId } })
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
      const count = await this.prisma.opportunityStageConfig.count({
        where: { organizationId, id: { in: [...stageIds] } },
      })
      if (count !== stageIds.size) throw new BadRequestException('关闭规则包含无效商机阶段')
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
    opportunity: Opportunity,
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

  private async toVO(row: OpportunityRule) {
    const [members, owners, users] = await Promise.all([
      this.scopeNames(row.organizationId, this.parseArray(row.scopeId)),
      this.scopeNames(row.organizationId, this.parseArray(row.ownerId)),
      this.prisma.user.findMany({
        where: { tenantId: row.organizationId, id: { in: [row.createUser, row.updateUser] } },
        select: { id: true, name: true },
      }),
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
      this.prisma.user.findMany({ where: { tenantId: organizationId, id: { in: normalized } }, select: { id: true, name: true } }),
      this.prisma.department.findMany({ where: { tenantId: organizationId, id: { in: normalized } }, select: { id: true, name: true } }),
      this.prisma.role.findMany({ where: { tenantId: organizationId, id: { in: normalized } }, select: { id: true, name: true } }),
    ])
    const names = new Map<string, string>([
      ...users.map((item) => [item.id, item.name] as const),
      ...departments.map((item) => [item.id, item.name] as const),
      ...roles.map((item) => [item.id, item.name] as const),
    ])
    return ids.map((id, index) => ({ id, name: names.get(normalized[index] ?? '') ?? id }))
  }
}

