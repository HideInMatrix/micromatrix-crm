import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { and, or } from '@prisma/orm-postgres/orm-client'
import {
  filterOpsForType,
  type FieldVO,
  type FilterCondition,
  type FollowUpRecordPrefillVO,
  type MessageTaskEvent,
  FollowUpPlanStatus as SharedFollowUpPlanStatus,
  FollowUpPlanVO,
  PaginatedResult,
  hasPermission,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { CustomerAccessService } from '../../customers/customer-access.service'
import type { Prisma8Client } from '../../prisma/prisma8-client'
import { Prisma8Service } from '../../prisma/prisma8.service'
import {
  prisma8Now,
  prisma8TimestampFromDate,
  prisma8TimestampToDate,
} from '../../prisma/prisma8-temporal'
import { prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { NotificationsService } from '../notifications/notifications.service'
import { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import {
  CreateFollowUpPlanDto,
  FOLLOW_UP_PLAN_STATUSES,
  FOLLOW_UP_PLAN_TARGET_TYPES,
  QueryFollowUpPlansDto,
  UpdateFollowUpPlanDto,
} from './dto/follow-up-plan.dto'

type TargetType = CreateFollowUpPlanDto['targetType']
type FollowUpPlanCollection = ReturnType<Prisma8Client['orm']['public']['FollowUpPlans']['where']>
type FollowUpPlanStatus = SharedFollowUpPlanStatus

export interface FollowUpPlan {
  id: string
  tenantId: string
  targetType: string
  targetId: string
  contactId: string | null
  content: string
  method: string | null
  estimatedAt: Date | null
  status: FollowUpPlanStatus
  converted: boolean
  convertedRecordId: string | null
  ownerId: string
  deptId: string | null
  createdById: string
  dueNotifiedAt: Date | null
  commentCount: number
  customData: unknown
  createdAt: Date
  updatedAt: Date
}

interface Prisma8FollowUpPlanRow {
  id: string
  tenantId: string
  targetType: string
  targetId: string
  contactId: string | null
  content: string
  method: string | null
  estimatedAt: ReturnType<typeof prisma8Now> | Date | null
  status: FollowUpPlanStatus
  converted: boolean
  convertedRecordId: string | null
  ownerId: string
  deptId: string | null
  createdById: string
  dueNotifiedAt: ReturnType<typeof prisma8Now> | Date | null
  commentCount: number
  customData: unknown
  createdAt: ReturnType<typeof prisma8Now> | Date
  updatedAt: ReturnType<typeof prisma8Now> | Date
}

interface TargetContext {
  name: string
  customerId: string | null
  collaboratorOnly: boolean
}

@Injectable()
export class FollowUpPlansService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly dataScope: DataScopeService,
    private readonly customerAccess: CustomerAccessService,
    private readonly pools: ResourcePoolsService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  form(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, 'followPlan')
  }

  async list(
    user: AuthUser,
    query: QueryFollowUpPlansDto,
  ): Promise<PaginatedResult<FollowUpPlanVO>> {
    const { page = 1, pageSize = 10, keyword, status, targetType, targetId, mine, filters } = query
    if (targetId && !targetType) throw new BadRequestException('指定业务对象时必须同时提供类型')

    let plans = this.prisma8.client.orm.public.FollowUpPlans.where({ tenantId: user.tenantId })
    if (targetType && targetId) {
      const context = await this.assertTargetAccess(user, targetType, targetId, false)
      plans = plans.where({ targetType, targetId })
      if (context.collaboratorOnly) plans = plans.where({ createdById: user.id })
    } else {
      plans = await this.applyGlobalAccess(plans, user)
    }

    const filteredIds = filters?.length ? await this.filterIds(user.tenantId, filters) : null
    if (keyword) {
      const targets = await this.keywordTargetIds(user.tenantId, keyword)
      plans = plans.where((plan) =>
        or(
          plan.content.ilike(`%${keyword}%`),
          and(plan.targetType.eq('lead'), plan.targetId.in(targets.lead)),
          and(plan.targetType.eq('customer'), plan.targetId.in(targets.customer)),
          and(plan.targetType.eq('opportunity'), plan.targetId.in(targets.opportunity)),
        ),
      )
    }
    if (mine) plans = plans.where({ ownerId: user.id })
    if (status) plans = plans.where({ status })
    if (filteredIds !== null) plans = plans.where((plan) => plan.id.in(filteredIds))

    const [rows, aggregate] = await Promise.all([
      plans
        .orderBy([(plan) => plan.estimatedAt.desc(), (plan) => plan.createdAt.desc()])
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      plans.aggregate((aggregate) => ({ count: aggregate.count() })),
    ])
    const items = rows.map((row) => this.legacyPlan(row))
    const total = aggregate.count
    return { items: await this.toVOs(user, items), total, page, pageSize }
  }

  async get(user: AuthUser, id: string): Promise<FollowUpPlanVO> {
    const plan = await this.assertPlanAccess(user, id, false)
    return (await this.toVOs(user, [plan]))[0]
  }

  async assertPlanAccess(user: AuthUser, id: string, write = false): Promise<FollowUpPlan> {
    const plan = await this.ensurePlan(user, id)
    const context = await this.assertTargetAccess(
      user,
      plan.targetType as TargetType,
      plan.targetId,
      write,
    )
    if (!write && context.collaboratorOnly && plan.createdById !== user.id) {
      throw new NotFoundException('跟进计划不存在或无权访问')
    }
    return plan
  }

  async create(user: AuthUser, dto: CreateFollowUpPlanDto): Promise<FollowUpPlanVO> {
    await this.assertTargetAccess(user, dto.targetType, dto.targetId, true)
    await this.assertContact(user.tenantId, dto.targetType, dto.targetId, dto.contactId)
    const owner = await this.resolveOwner(user, dto.ownerId)
    const dynamicValues = await this.moduleFieldsToDynamicValues(
      user.tenantId,
      dto.moduleFields ?? [],
    )
    const planId = await this.prisma8.client.transaction(async (tx) => {
      const created = await tx.orm.public.FollowUpPlans.create({
        tenantId: user.tenantId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        contactId: dto.contactId ?? null,
        content: dto.content,
        method: dto.method ?? null,
        estimatedAt: dto.estimatedAt
          ? prisma8TimestampFromDate(new Date(dto.estimatedAt))
          : null,
        ownerId: owner.id,
        deptId: owner.deptId,
        createdById: user.id,
        updatedAt: prisma8Now(),
      })
      await this.fieldValues.save(
        user.tenantId,
        'followPlan',
        created.id,
        dynamicValues,
        'create',
        tx,
        user.id,
      )
      return created.id
    })
    const plan = await this.ensurePlan(user, planId)
    return (await this.toVOs(user, [plan]))[0]
  }

  async update(user: AuthUser, id: string, dto: UpdateFollowUpPlanDto): Promise<FollowUpPlanVO> {
    const existing = await this.ensureManageablePlan(user, id)
    const targetType = dto.targetType ?? (existing.targetType as TargetType)
    const targetId = dto.targetId ?? existing.targetId
    await this.assertTargetAccess(user, targetType, targetId, true)
    const contactId = dto.contactId === undefined ? existing.contactId : dto.contactId || null
    await this.assertContact(user.tenantId, targetType, targetId, contactId ?? undefined)
    const owner = dto.ownerId ? await this.resolveOwner(user, dto.ownerId) : null
    const estimatedAt =
      dto.estimatedAt === undefined
        ? existing.estimatedAt
        : dto.estimatedAt
          ? new Date(dto.estimatedAt)
          : null
    const dueDateChanged = estimatedAt?.getTime() !== existing.estimatedAt?.getTime()
    const dynamicValues =
      dto.moduleFields === undefined
        ? null
        : await this.moduleFieldsToDynamicValues(user.tenantId, dto.moduleFields)

    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.FollowUpPlans.where({ id }).update({
        targetType,
        targetId,
        contactId,
        content: dto.content,
        method: dto.method,
        estimatedAt: estimatedAt ? prisma8TimestampFromDate(estimatedAt) : null,
        ...(owner ? { ownerId: owner.id, deptId: owner.deptId } : {}),
        ...(dueDateChanged ? { dueNotifiedAt: null } : {}),
        updatedAt: prisma8Now(),
      })
      if (dynamicValues !== null) {
        await this.fieldValues.save(
          user.tenantId,
          'followPlan',
          id,
          dynamicValues,
          'update',
          tx,
          user.id,
        )
      }
    })
    const plan = await this.ensurePlan(user, id)
    return (await this.toVOs(user, [plan]))[0]
  }

  async updateStatus(
    user: AuthUser,
    id: string,
    status: SharedFollowUpPlanStatus,
  ): Promise<FollowUpPlanVO> {
    const existing = await this.ensureManageablePlan(user, id)
    if (existing.status === 'COMPLETED' && existing.converted) {
      throw new ConflictException('已转为跟进记录的计划不能再变更状态')
    }
    const row = await this.prisma8.client.orm.public.FollowUpPlans.where({
      id,
      tenantId: user.tenantId,
    }).update({ status: status as FollowUpPlanStatus, updatedAt: prisma8Now() })
    if (!row) throw new NotFoundException('跟进计划不存在')
    const plan = this.legacyPlan(row)
    return (await this.toVOs(user, [plan]))[0]
  }

  async recordPrefill(user: AuthUser, id: string): Promise<FollowUpRecordPrefillVO> {
    const plan = await this.ensureManageablePlan(user, id)
    if (plan.status !== 'COMPLETED') {
      throw new BadRequestException('只有已完成计划才能转为跟进记录')
    }
    if (plan.converted) throw new ConflictException('该计划已转为跟进记录')
    await this.assertTargetAccess(user, plan.targetType as TargetType, plan.targetId, true)

    const [fields, dynamic] = await Promise.all([
      this.moduleForms.listFields(user.tenantId, 'followPlan'),
      this.fieldValues.load(user.tenantId, 'followPlan', [plan.id]),
    ])
    const sourceDynamic = dynamic.get(plan.id) ?? {}
    const sourceValues: Record<string, unknown> = {
      targetType: plan.targetType,
      targetId: plan.targetId,
      ownerId: plan.ownerId,
      contactId: plan.contactId,
      estimatedAt: plan.estimatedAt?.toISOString() ?? null,
      content: plan.content,
      method: plan.method,
      status: plan.status,
    }
    for (const field of fields) {
      if (field.system) continue
      if (Object.prototype.hasOwnProperty.call(sourceDynamic, field.key)) {
        sourceValues[field.key] = sourceDynamic[field.key]
      }
    }

    return {
      sourcePlanId: plan.id,
      values: await this.moduleForms.resolveFormLink(
        user.tenantId,
        'followRecord',
        'followPlan',
        'PLAN_TO_RECORD',
        sourceValues,
      ),
    }
  }

  async remove(user: AuthUser, id: string) {
    const plan = await this.ensureManageablePlan(user, id)
    const deleted = await this.prisma8.client.orm.public.FollowUpPlans.where({
      id,
      tenantId: user.tenantId,
    }).deleteAndCount()
    if (deleted !== 1) throw new NotFoundException('跟进计划不存在')
    return { id: plan.id }
  }

  /** 每日 09:00 扫描当天到期的未结束计划。 */
  @Cron('0 0 9 * * *')
  async scheduledReminder(): Promise<void> {
    const now = new Date()
    if (!this.coordinator) return void (await this.runDueReminders(now))
    await this.coordinator.runScheduledOnce('follow-plan-reminder', 'DAILY', () =>
      this.runDueReminders(now),
    )
  }

  async runDueReminders(now: Date): Promise<number> {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const plans = await this.loadDueReminderPlans(start, end)
    const names = await this.targetNamesPrisma8(plans)
    let notified = 0
    for (const plan of plans) {
      if (!(await this.claimDueReminder(plan.id, start, now))) continue
      try {
        await this.notifications.notify(plan.tenantId, plan.ownerId, {
          type: 'follow_plan',
          event: this.followPlanReminderEvent(plan.targetType as TargetType),
          title: '跟进计划到期提醒',
          content: `${names.get(`${plan.targetType}:${plan.targetId}`) ?? '业务对象'}：${plan.content}`,
          link: `/follow-plans?id=${plan.id}`,
        })
        notified += 1
      } catch (error) {
        await this.releaseDueReminder(plan.id, now)
        throw error
      }
    }
    return notified
  }

  private async loadDueReminderPlans(start: Date, end: Date) {
    const startTemporal = prisma8TimestampFromDate(start)
    const endTemporal = prisma8TimestampFromDate(end)
    return this.prisma8.client.orm.public.FollowUpPlans.where((plan) =>
      plan.estimatedAt.gte(startTemporal),
    )
      .where((plan) => plan.estimatedAt.lt(endTemporal))
      .where((plan) => plan.status.in(['PREPARED', 'UNDERWAY']))
      .where((plan) => or(plan.dueNotifiedAt.isNull(), plan.dueNotifiedAt.lt(startTemporal)))
      .select('id', 'tenantId', 'ownerId', 'targetType', 'targetId', 'content')
      .orderBy((plan) => plan.estimatedAt.asc())
      .all()
  }

  private async claimDueReminder(id: string, start: Date, now: Date): Promise<boolean> {
    const client = this.prisma8.client
    const startIso = start.toISOString()
    const nowIso = now.toISOString()
    const query = client.raw.sql`UPDATE follow_up_plans
      SET "dueNotifiedAt" = (${nowIso}::timestamptz AT TIME ZONE 'UTC'),
          "updatedAt" = (${nowIso}::timestamptz AT TIME ZONE 'UTC')
      WHERE id = ${id}
        AND (
          "dueNotifiedAt" IS NULL
          OR "dueNotifiedAt" < (${startIso}::timestamptz AT TIME ZONE 'UTC')
        )
      RETURNING id`.returnsRow({ id: client.sql.public.follow_up_plans.columns.id })
    for await (const _row of client.runtime().query(query.build())) return true
    return false
  }

  private async releaseDueReminder(id: string, claimedAt: Date): Promise<void> {
    const claimedTemporal = prisma8TimestampFromDate(claimedAt)
    await this.prisma8.client.orm.public.FollowUpPlans.where({ id })
      .where((plan) => plan.dueNotifiedAt.eq(claimedTemporal))
      .updateAll({
        dueNotifiedAt: null,
        updatedAt: prisma8TimestampFromDate(new Date()),
      })
  }

  private async targetNamesPrisma8(
    plans: ReadonlyArray<{ targetType: string; targetId: string }>,
  ): Promise<Map<string, string>> {
    const groups = {
      lead: plans.filter((plan) => plan.targetType === 'lead').map((plan) => plan.targetId),
      customer: plans.filter((plan) => plan.targetType === 'customer').map((plan) => plan.targetId),
      opportunity: plans
        .filter((plan) => plan.targetType === 'opportunity')
        .map((plan) => plan.targetId),
    }
    const leads = groups.lead.length
      ? await this.prisma8.client.orm.public.Clue.where((row) =>
          row.id.in(prisma8Varchars(groups.lead, 32)),
        )
          .select('id', 'name')
          .all()
      : []
    const customers = groups.customer.length
      ? await this.prisma8.client.orm.public.Customer.where((row) =>
          row.id.in(prisma8Varchars(groups.customer, 32)),
        )
          .select('id', 'name')
          .all()
      : []
    const opportunities = groups.opportunity.length
      ? await this.prisma8.client.orm.public.Opportunity.where((row) =>
          row.id.in(prisma8Varchars(groups.opportunity, 32)),
        )
          .select('id', 'name')
          .all()
      : []
    return new Map([
      ...leads.map((item) => [`lead:${item.id}`, item.name] as const),
      ...customers.map((item) => [`customer:${item.id}`, item.name] as const),
      ...opportunities.map((item) => [`opportunity:${item.id}`, item.name] as const),
    ])
  }

  private followPlanReminderEvent(targetType: TargetType): MessageTaskEvent {
    if (targetType === 'lead') return 'CLUE_FOLLOW_UP_PLAN_DUE'
    if (targetType === 'opportunity') return 'BUSINESS_FOLLOW_UP_PLAN_DUE'
    return 'CUSTOMER_FOLLOW_UP_PLAN_DUE'
  }

  private async ensurePlan(user: AuthUser, id: string): Promise<FollowUpPlan> {
    const row = await this.prisma8.client.orm.public.FollowUpPlans.where({
      id,
      tenantId: user.tenantId,
    }).first()
    if (!row) throw new NotFoundException('跟进计划不存在')
    return this.legacyPlan(row)
  }

  private async ensureManageablePlan(user: AuthUser, id: string): Promise<FollowUpPlan> {
    const plan = await this.ensurePlan(user, id)
    if (plan.ownerId !== user.id && !hasPermission(user.permissions, '*')) {
      throw new ForbiddenException('只有计划负责人可以执行此操作')
    }
    return plan
  }

  private async assertTargetAccess(
    user: AuthUser,
    type: TargetType,
    id: string,
    write: boolean,
  ): Promise<TargetContext> {
    if (type === 'customer') {
      const permission = write ? 'customer:update' : 'customer:read'
      if (!hasPermission(user.permissions, permission)) throw new ForbiddenException('无客户权限')
      const access = write
        ? await this.customerAccess.assertCollaborateWrite(user, id, permission)
        : await this.customerAccess.assertRead(user, id)
      return {
        name: access.customer.name,
        customerId: id,
        collaboratorOnly: !access.dataScope && access.collaborationType !== null,
      }
    }
    if (type === 'lead') {
      const permission = write ? 'lead:update' : 'menu:lead'
      if (!hasPermission(user.permissions, permission)) throw new ForbiddenException('无线索权限')
      const lead = await this.prisma8.client.orm.public.Clue.where({
        id: prisma8Varchar(id, 32),
        organizationId: prisma8Varchar(user.tenantId, 32),
      }).first()
      if (!lead) throw new NotFoundException('线索不存在')
      if (lead.inSharedPool) {
        const poolIds = (await this.pools.options(user, 'lead')).map((pool) => String(pool.id))
        if (!lead.poolId || !poolIds.includes(lead.poolId))
          throw new NotFoundException('线索不存在或无权访问')
      } else if (!(await this.dataScope.matchesDirectOwner(user, lead.owner, permission))) {
        throw new NotFoundException('线索不存在或不在你的数据范围内')
      }
      return { name: lead.name, customerId: null, collaboratorOnly: false }
    }
    const permission = write ? 'opportunity:update' : 'menu:opportunity'
    if (!hasPermission(user.permissions, permission)) throw new ForbiddenException('无商机权限')
    const opportunity = await this.prisma8.client.orm.public.Opportunity.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).first()
    if (
      !opportunity ||
      !(await this.dataScope.matchesDirectOwner(user, opportunity.owner, permission))
    ) {
      throw new NotFoundException('商机不存在或不在你的数据范围内')
    }
    return { name: opportunity.name, customerId: opportunity.customerId, collaboratorOnly: false }
  }

  private async assertContact(
    tenantId: string,
    type: TargetType,
    targetId: string,
    contactId?: string,
  ): Promise<void> {
    if (!contactId) return
    let customerId: string | null = type === 'customer' ? targetId : null
    if (type === 'opportunity') {
      customerId =
        (
          await this.prisma8.client.orm.public.Opportunity.where({
            id: prisma8Varchar(targetId, 32),
            organizationId: prisma8Varchar(tenantId, 32),
          })
            .select('customerId')
            .first()
        )?.customerId ?? null
    }
    if (!customerId) throw new BadRequestException('当前业务对象不能关联客户联系人')
    const contact = await this.prisma8.client.orm.public.CustomerContact.where({
      id: prisma8Varchar(contactId, 32),
      organizationId: prisma8Varchar(tenantId, 32),
      customerId: prisma8Varchar(customerId, 32),
    }).first()
    if (!contact) throw new BadRequestException('联系人不属于当前客户')
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id, deptId: user.deptId }
    const owner = await this.prisma8.client.orm.public.Users.where({
      id: ownerId,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id', 'deptId')
      .first()
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner
  }

  private legacyPlan(row: Prisma8FollowUpPlanRow): FollowUpPlan {
    return {
      id: row.id,
      tenantId: row.tenantId,
      targetType: row.targetType,
      targetId: row.targetId,
      contactId: row.contactId,
      content: row.content,
      method: row.method,
      estimatedAt: row.estimatedAt ? this.timestampToDate(row.estimatedAt) : null,
      status: row.status,
      converted: row.converted,
      convertedRecordId: row.convertedRecordId,
      ownerId: row.ownerId,
      deptId: row.deptId,
      createdById: row.createdById,
      dueNotifiedAt: row.dueNotifiedAt ? this.timestampToDate(row.dueNotifiedAt) : null,
      commentCount: row.commentCount,
      customData: row.customData,
      createdAt: this.timestampToDate(row.createdAt),
      updatedAt: this.timestampToDate(row.updatedAt),
    }
  }

  private timestampToDate(value: ReturnType<typeof prisma8Now> | Date): Date {
    return value instanceof Date ? value : prisma8TimestampToDate(value)
  }

  private async applyGlobalAccess(
    collection: FollowUpPlanCollection,
    user: AuthUser,
  ): Promise<FollowUpPlanCollection> {
    const [lead, customer, opportunity, collaborationRows] = await Promise.all([
      this.dataScope.resolveScope(user, 'menu:lead'),
      this.dataScope.resolveScope(user, 'customer:read'),
      this.dataScope.resolveScope(user, 'menu:opportunity'),
      this.prisma8.client.orm.public.CustomerCollaboration.where({
        userId: prisma8Varchar(user.id, 32),
      })
        .select('customerId')
        .all(),
    ])
    const collaborationCustomerIds = collaborationRows.length
      ? await this.prisma8.client.orm.public.Customer.where({
          organizationId: prisma8Varchar(user.tenantId, 32),
        })
          .where((row) => row.id.in(collaborationRows.map((item) => item.customerId)))
          .select('id')
          .all()
      : []
    const collaborated = collaborationCustomerIds.map((item) => String(item.id))

    return collection.where((plan) =>
      or(
        lead.hasPermission
          ? lead.all
            ? plan.targetType.eq('lead')
            : and(
                plan.targetType.eq('lead'),
                lead.deptIds.length
                  ? or(plan.ownerId.eq(user.id), plan.deptId.in(lead.deptIds))
                  : plan.ownerId.eq(user.id),
              )
          : plan.id.eq('__permission_scope_denied_lead__'),
        customer.hasPermission
          ? customer.all
            ? plan.targetType.eq('customer')
            : and(
                plan.targetType.eq('customer'),
                customer.deptIds.length
                  ? or(plan.ownerId.eq(user.id), plan.deptId.in(customer.deptIds))
                  : plan.ownerId.eq(user.id),
              )
          : plan.id.eq('__permission_scope_denied_customer__'),
        opportunity.hasPermission
          ? opportunity.all
            ? plan.targetType.eq('opportunity')
            : and(
                plan.targetType.eq('opportunity'),
                opportunity.deptIds.length
                  ? or(plan.ownerId.eq(user.id), plan.deptId.in(opportunity.deptIds))
                  : plan.ownerId.eq(user.id),
              )
          : plan.id.eq('__permission_scope_denied_opportunity__'),
        collaborated.length
          ? and(
              plan.targetType.eq('customer'),
              plan.targetId.in(collaborated),
              plan.createdById.eq(user.id),
            )
          : plan.id.eq('__no_customer_collaboration__'),
      ),
    )
  }

  private async keywordTargetIds(tenantId: string, keyword: string) {
    const organizationId = prisma8Varchar(tenantId, 32)
    const [leads, customers, opportunities] = await Promise.all([
      this.prisma8.client.orm.public.Clue.where({ organizationId })
        .where((row) => row.name.ilike(`%${keyword}%`))
        .select('id')
        .all(),
      this.prisma8.client.orm.public.Customer.where({ organizationId })
        .where((row) => row.name.ilike(`%${keyword}%`))
        .select('id')
        .all(),
      this.prisma8.client.orm.public.Opportunity.where({ organizationId })
        .where((row) => row.name.ilike(`%${keyword}%`))
        .select('id')
        .all(),
    ])
    return {
      lead: leads.map((item) => String(item.id)),
      customer: customers.map((item) => String(item.id)),
      opportunity: opportunities.map((item) => String(item.id)),
    }
  }

  private async filterIds(tenantId: string, conditions: FilterCondition[]): Promise<string[]> {
    const fields = await this.moduleForms.listFields(tenantId, 'followPlan')
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
    const direct: Array<{ field: FieldVO; condition: FilterCondition }> = []
    const dynamic: FilterCondition[] = []

    for (const condition of conditions) {
      const field = fieldMap.get(condition.key)
      if (!field) throw new BadRequestException(`筛选字段不存在：${condition.key}`)
      if (!filterOpsForType(field.type).includes(condition.op)) {
        throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
      }
      if (field.system) direct.push({ field, condition })
      else dynamic.push(condition)
    }

    let directQuery = this.prisma8.client.orm.public.FollowUpPlans.where({ tenantId })
    for (const item of direct) directQuery = this.applySystemFilter(directQuery, item.field, item.condition)
    const [directRows, dynamicIds] = await Promise.all([
      direct.length ? directQuery.select('id').all() : null,
      dynamic.length ? this.fieldValues.filterResourceIds(tenantId, 'followPlan', dynamic) : null,
    ])

    let selected: string[] | null = directRows?.map((row) => row.id) ?? null
    if (dynamicIds !== null) {
      if (selected === null) selected = dynamicIds
      else {
        const dynamicSet = new Set(dynamicIds)
        selected = selected.filter((id) => dynamicSet.has(id))
      }
    }
    return selected ?? []
  }

  private applySystemFilter(
    collection: FollowUpPlanCollection,
    field: FieldVO,
    condition: FilterCondition,
  ): FollowUpPlanCollection {
    const key = field.key
    const allowed = new Set([
      'targetType',
      'targetId',
      'ownerId',
      'contactId',
      'estimatedAt',
      'content',
      'method',
      'status',
    ])
    if (!allowed.has(key)) throw new BadRequestException(`筛选字段不支持：${key}`)

    if (key === 'estimatedAt') {
      if (condition.op === 'isEmpty') return collection.where((row) => row.estimatedAt.isNull())
      if (condition.op === 'notEmpty') return collection.where((row) => row.estimatedAt.isNotNull())
      if (condition.value === undefined || condition.value === null || condition.value === '') {
        throw new BadRequestException(`「${field.label}」筛选值不能为空`)
      }
      const value = new Date(String(condition.value))
      if (Number.isNaN(value.getTime())) throw new BadRequestException('计划时间筛选值不合法')
      const temporal = prisma8TimestampFromDate(value)
      if (condition.op === 'gte') return collection.where((row) => row.estimatedAt.gte(temporal))
      if (condition.op === 'lte') return collection.where((row) => row.estimatedAt.lte(temporal))
      throw new BadRequestException('计划时间不支持该筛选操作')
    }
    if (key === 'status') {
      if (condition.op === 'isEmpty') return collection.where((row) => row.id.eq('__empty_status__'))
      if (condition.op === 'notEmpty') return collection
      if (condition.value === undefined || condition.value === null || condition.value === '') {
        throw new BadRequestException(`「${field.label}」筛选值不能为空`)
      }
      if (!FOLLOW_UP_PLAN_STATUSES.includes(condition.value as never)) {
        throw new BadRequestException('计划状态筛选值不合法')
      }
      const status = condition.value as FollowUpPlanStatus
      if (condition.op === 'eq') return collection.where((row) => row.status.eq(status))
      if (condition.op === 'ne') return collection.where((row) => row.status.neq(status))
      throw new BadRequestException('计划状态不支持该筛选操作')
    }
    if (condition.op === 'isEmpty') {
      if (key === 'contactId') {
        return collection.where((row) => or(row.contactId.isNull(), row.contactId.eq('')))
      }
      if (key === 'method') {
        return collection.where((row) => or(row.method.isNull(), row.method.eq('')))
      }
      return collection.where((row) => {
        const column =
          key === 'targetType'
            ? row.targetType
            : key === 'targetId'
              ? row.targetId
              : key === 'ownerId'
                ? row.ownerId
                : row.content
        return column.eq('')
      })
    }
    if (condition.op === 'notEmpty') {
      if (key === 'contactId') {
        return collection.where((row) => and(row.contactId.isNotNull(), row.contactId.neq('')))
      }
      if (key === 'method') {
        return collection.where((row) => and(row.method.isNotNull(), row.method.neq('')))
      }
      return collection.where((row) => {
        const column =
          key === 'targetType'
            ? row.targetType
            : key === 'targetId'
              ? row.targetId
              : key === 'ownerId'
                ? row.ownerId
                : row.content
        return column.neq('')
      })
    }

    if (condition.value === undefined || condition.value === null || condition.value === '') {
      throw new BadRequestException(`「${field.label}」筛选值不能为空`)
    }
    if (key === 'targetType' && !FOLLOW_UP_PLAN_TARGET_TYPES.includes(condition.value as never)) {
      throw new BadRequestException('关联类型筛选值不合法')
    }

    const value = String(condition.value)
    if (key === 'contactId') {
      if (condition.op === 'contains') return collection.where((row) => row.contactId.ilike(`%${value}%`))
      if (condition.op === 'eq') return collection.where((row) => row.contactId.eq(value))
      if (condition.op === 'ne') return collection.where((row) => row.contactId.neq(value))
    }
    if (key === 'method') {
      if (condition.op === 'contains') return collection.where((row) => row.method.ilike(`%${value}%`))
      if (condition.op === 'eq') return collection.where((row) => row.method.eq(value))
      if (condition.op === 'ne') return collection.where((row) => row.method.neq(value))
    }
    return collection.where((row) => {
      const column =
        key === 'targetType'
          ? row.targetType
          : key === 'targetId'
            ? row.targetId
            : key === 'ownerId'
              ? row.ownerId
              : row.content
      if (condition.op === 'contains') return column.ilike(`%${value}%`)
      if (condition.op === 'eq') return column.eq(value)
      if (condition.op === 'ne') return column.neq(value)
      return column.eq('__unsupported_filter__')
    })
  }

  private async moduleFieldsToDynamicValues(
    tenantId: string,
    moduleFields: Array<{ fieldId: string; fieldValue?: unknown }>,
  ): Promise<Record<string, unknown>> {
    if (!moduleFields.length) return {}
    const fields = await this.moduleForms.listFields(tenantId, 'followPlan')
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
    const values: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = fieldMap.get(item.fieldId)
      if (!field) throw new BadRequestException(`跟进计划字段不存在：${item.fieldId}`)
      if (field.system) continue
      values[field.key] = item.fieldValue
    }
    return values
  }

  private async toVOs(user: AuthUser, plans: FollowUpPlan[]): Promise<FollowUpPlanVO[]> {
    if (plans.length === 0) return []
    const names = await this.targetNamesPrisma8(plans)
    const ownerIds = [...new Set(plans.map((plan) => plan.ownerId))]
    const contactIds = plans.flatMap((plan) => (plan.contactId ? [plan.contactId] : []))
    const opportunityIds = plans
      .filter((plan) => plan.targetType === 'opportunity')
      .map((plan) => plan.targetId)
    const [owners, contacts, opportunities, fields, dynamic] = await Promise.all([
      ownerIds.length
        ? this.prisma8.client.orm.public.Users.where({ tenantId: user.tenantId })
            .where((row) => row.id.in(ownerIds))
            .select('id', 'name')
            .all()
        : [],
      contactIds.length
        ? this.prisma8.client.orm.public.CustomerContact.where({
            organizationId: prisma8Varchar(user.tenantId, 32),
          })
            .where((row) => row.id.in(prisma8Varchars(contactIds, 32)))
            .select('id', 'name')
            .all()
        : [],
      opportunityIds.length
        ? this.prisma8.client.orm.public.Opportunity.where({
            organizationId: prisma8Varchar(user.tenantId, 32),
          })
            .where((row) => row.id.in(prisma8Varchars(opportunityIds, 32)))
            .select('id', 'customerId')
            .all()
        : [],
      this.moduleForms.listFields(user.tenantId, 'followPlan'),
      this.fieldValues.load(
        user.tenantId,
        'followPlan',
        plans.map((plan) => plan.id),
      ),
    ])
    const ownerMap = new Map(owners.map((item) => [String(item.id), String(item.name)]))
    const contactMap = new Map(contacts.map((item) => [String(item.id), String(item.name)]))
    const opportunityCustomerMap = new Map(
      opportunities.map((item) => [String(item.id), item.customerId ? String(item.customerId) : null]),
    )
    const admin = hasPermission(user.permissions, '*')
    return plans.map((plan) => {
      const dynamicValues = dynamic.get(plan.id) ?? {}
      return {
        id: plan.id,
        targetType: plan.targetType as FollowUpPlanVO['targetType'],
        targetId: plan.targetId,
        targetName: names.get(`${plan.targetType}:${plan.targetId}`) ?? '已删除业务对象',
        customerId:
          plan.targetType === 'customer'
            ? plan.targetId
            : plan.targetType === 'opportunity'
              ? (opportunityCustomerMap.get(plan.targetId) ?? null)
              : null,
        contactId: plan.contactId,
        contactName: plan.contactId ? (contactMap.get(plan.contactId) ?? null) : null,
        content: plan.content,
        method: plan.method,
        estimatedAt: plan.estimatedAt?.toISOString() ?? null,
        status: plan.status,
        converted: plan.converted,
        convertedRecordId: plan.convertedRecordId,
        commentCount: plan.commentCount,
        ownerId: plan.ownerId,
        ownerName: ownerMap.get(plan.ownerId) ?? '已停用成员',
        createdById: plan.createdById,
        moduleFields: fields
          .filter(
            (field) =>
              !field.system && Object.prototype.hasOwnProperty.call(dynamicValues, field.key),
          )
          .map((field) => ({ fieldId: field.id, fieldValue: dynamicValues[field.key] })),
        canManage: admin || plan.ownerId === user.id,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
      }
    })
  }
}
