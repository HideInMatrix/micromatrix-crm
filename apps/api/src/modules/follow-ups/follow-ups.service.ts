import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  filterOpsForType,
  type FieldVO,
  type FieldType,
  type FilterCondition,
  type FollowUpVO,
  hasPermission,
  type PaginatedResult,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { CustomerAccessService } from '../../customers/customer-access.service'
import { not, or } from '@prisma/orm-postgres/orm-client'
import type { Prisma8Client } from '../../prisma/prisma8-client.js'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import {
  prisma8Now,
  prisma8TimestampFromDate,
  prisma8TimestampFromISOString,
  prisma8TimestampToISOString,
} from '../../prisma/prisma8-temporal.js'

import { AttachmentsService } from '../attachments/attachments.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import {
  resourceFieldAttachmentTarget,
  ResourceFieldValueService,
} from '../metadata/resource-field-value.service'
import { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import { UserViewsService } from '../user-views/user-views.service'
import { CreateFollowUpDto, FollowUpRecordPageDto, UpdateFollowUpDto } from './dto/follow-up.dto'

type FollowRecordSystemSort =
  | 'targetType'
  | 'targetId'
  | 'ownerId'
  | 'contactId'
  | 'followedAt'
  | 'type'
  | 'createdAt'
  | 'updatedAt'

type FollowRecordResolvedSort =
  | {
      kind: 'system'
      field: FollowRecordSystemSort
      direction: 'asc' | 'desc'
      defaultSort?: boolean
    }
  | { kind: 'dynamic'; field: FieldVO; direction: 'asc' | 'desc' }

export type FollowRecord = {
  id: string
  tenantId: string
  targetType: string
  targetId: string
  contactId: string | null
  type: string | null
  content: string
  followedAt: ReturnType<typeof prisma8Now> | null
  ownerId: string
  ownerName: string
  deptId: string | null
  createdById: string
  commentCount: number
  createdAt: ReturnType<typeof prisma8Now>
  updatedAt: ReturnType<typeof prisma8Now>
}

type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]

const FOLLOW_RECORD_DYNAMIC_SORT_TYPES = new Set<FieldType>([
  'text',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'select',
  'radio',
  'switch',
  'member',
  'dept',
  'phone',
  'email',
  'location',
  'data_source',
])

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly customerAccess: CustomerAccessService,
    private readonly dataScope: DataScopeService,
    private readonly pools: ResourcePoolsService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly userViews: UserViewsService,
    private readonly attachments: AttachmentsService,
  ) {}

  form(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, 'followRecord')
  }

  async page(user: AuthUser, dto: FollowUpRecordPageDto): Promise<PaginatedResult<FollowUpVO>> {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 20
    if (dto.targetId && !dto.targetType) {
      throw new BadRequestException('指定业务对象时必须同时提供类型')
    }
    if (dto.targetType && dto.targetId) {
      await this.assertTargetAccess(user, dto.targetType, dto.targetId, false)
    }

    const saved = dto.viewId
      ? await this.userViews.resolveFilters(
          user,
          dto.viewId,
          USER_VIEW_RESOURCE_TYPES.follow_record,
        )
      : null
    const [savedIds, adHocIds, keywordIds, accessIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, saved.conditions, saved.searchMode)
        : null,
      dto.filters?.length
        ? this.filterIds(user.tenantId, dto.filters, dto.filterMode ?? 'AND')
        : null,
      dto.keyword?.trim() ? this.keywordRecordIds(user.tenantId, dto.keyword.trim()) : null,
      dto.targetType && dto.targetId ? null : this.globalAccessibleRecordIds(user),
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)
    let query = this.prisma8.client.orm.public.FollowUpRecords.where({ tenantId: user.tenantId })
    if (dto.targetType) query = query.where({ targetType: dto.targetType })
    if (dto.targetId) query = query.where({ targetId: dto.targetId })
    if (accessIds) query = query.where((row) => row.id.in(accessIds))
    if (keywordIds) query = query.where((row) => row.id.in(keywordIds))
    if (dto.mine) query = query.where({ ownerId: user.id })
    if (filteredIds) query = query.where((row) => row.id.in(filteredIds))

    const sort = await this.resolveSort(user.tenantId, dto)
    let records: FollowRecord[]
    let total: number
    if (sort.kind === 'dynamic') {
      const candidateRows = await query.select('id').all()
      total = candidateRows.length
      const orderedIds = await this.sortDynamicRecordIds(
        candidateRows.map((item) => item.id),
        sort.field,
        sort.direction,
      )
      const pageIds = orderedIds.slice((page - 1) * pageSize, page * pageSize)
      const rows = pageIds.length
        ? await this.prisma8.client.orm.public.FollowUpRecords.where({ tenantId: user.tenantId })
            .where((row) => row.id.in(pageIds))
            .all()
        : []
      const rowMap = new Map(rows.map((item) => [item.id, this.toLegacyRecord(item)]))
      records = pageIds.flatMap((id) => {
        const row = rowMap.get(id)
        return row ? [row] : []
      })
    } else {
      const ordered = this.applySystemSort(query, sort)
      const [rows, aggregate] = await Promise.all([
        ordered
          .offset((page - 1) * pageSize)
          .limit(pageSize)
          .all(),
        query.aggregate((value) => ({ count: value.count() })),
      ])
      records = rows.map((row) => this.toLegacyRecord(row))
      total = aggregate.count
    }
    return { items: await this.toVOs(user, records), total, page, pageSize }
  }

  private async resolveSort(
    tenantId: string,
    dto: FollowUpRecordPageDto,
  ): Promise<FollowRecordResolvedSort> {
    if (!dto.sort?.name) {
      return { kind: 'system', field: 'followedAt', direction: 'desc', defaultSort: true }
    }
    const direction = dto.sort.type
    const systemColumns = new Set<FollowRecordSystemSort>([
      'targetType',
      'targetId',
      'ownerId',
      'contactId',
      'followedAt',
      'type',
      'createdAt',
      'updatedAt',
    ])
    if (systemColumns.has(dto.sort.name as FollowRecordSystemSort)) {
      return { kind: 'system', field: dto.sort.name as FollowRecordSystemSort, direction }
    }
    const fields = await this.moduleForms.listFields(tenantId, 'followRecord')
    const field = fields.find(
      (candidate) => candidate.id === dto.sort?.name || candidate.key === dto.sort?.name,
    )
    if (!field) throw new BadRequestException(`排序字段不存在：${dto.sort.name}`)
    if (field.system) {
      if (!systemColumns.has(field.key as FollowRecordSystemSort)) {
        throw new BadRequestException(`「${field.label}」不支持排序`)
      }
      return { kind: 'system', field: field.key as FollowRecordSystemSort, direction }
    }
    if (!FOLLOW_RECORD_DYNAMIC_SORT_TYPES.has(field.type)) {
      throw new BadRequestException(`「${field.label}」不支持排序`)
    }
    return { kind: 'dynamic', field, direction }
  }

  private applySystemSort(
    query: ReturnType<typeof this.prisma8.client.orm.public.FollowUpRecords.where>,
    sort: Extract<FollowRecordResolvedSort, { kind: 'system' }>,
  ) {
    const asc = sort.direction === 'asc'
    if (sort.defaultSort) {
      return query.orderBy([
        (row) => row.followedAt.desc(),
        (row) => row.createdAt.desc(),
        (row) => row.id.asc(),
      ])
    }
    if (sort.field === 'targetType')
      return query.orderBy([
        (row) => (asc ? row.targetType.asc() : row.targetType.desc()),
        (row) => row.id.asc(),
      ])
    if (sort.field === 'targetId')
      return query.orderBy([
        (row) => (asc ? row.targetId.asc() : row.targetId.desc()),
        (row) => row.id.asc(),
      ])
    if (sort.field === 'ownerId')
      return query.orderBy([
        (row) => (asc ? row.ownerId.asc() : row.ownerId.desc()),
        (row) => row.id.asc(),
      ])
    if (sort.field === 'contactId')
      return query.orderBy([
        (row) => (asc ? row.contactId.asc() : row.contactId.desc()),
        (row) => row.id.asc(),
      ])
    if (sort.field === 'followedAt')
      return query.orderBy([
        (row) => (asc ? row.followedAt.asc() : row.followedAt.desc()),
        (row) => row.id.asc(),
      ])
    if (sort.field === 'type')
      return query.orderBy([
        (row) => (asc ? row._type.asc() : row._type.desc()),
        (row) => row.id.asc(),
      ])
    if (sort.field === 'createdAt')
      return query.orderBy([
        (row) => (asc ? row.createdAt.asc() : row.createdAt.desc()),
        (row) => row.id.asc(),
      ])
    return query.orderBy([
      (row) => (asc ? row.updatedAt.asc() : row.updatedAt.desc()),
      (row) => row.id.asc(),
    ])
  }

  private async sortDynamicRecordIds(
    recordIds: string[],
    field: FieldVO,
    direction: 'asc' | 'desc',
  ): Promise<string[]> {
    if (recordIds.length <= 1) return recordIds
    const [normalRows, blobRows] = await Promise.all([
      this.prisma8.client.orm.public.FollowUpRecordField.where({ fieldId: field.id })
        .where((row) => row.resourceId.in(recordIds))
        .select('resourceId', 'fieldValue')
        .all(),
      this.prisma8.client.orm.public.FollowUpRecordFieldBlob.where({ fieldId: field.id })
        .where((row) => row.resourceId.in(recordIds))
        .select('resourceId', 'fieldValue')
        .all(),
    ])
    const values = new Map(
      [...normalRows, ...blobRows].map(
        (item) => [item.resourceId, String(item.fieldValue)] as const,
      ),
    )
    const multiplier = direction === 'asc' ? 1 : -1
    return [...recordIds].sort((leftId, rightId) => {
      const left = values.get(leftId)
      const right = values.get(rightId)
      if (left === undefined && right === undefined) return leftId.localeCompare(rightId)
      if (left === undefined) return -1 * multiplier
      if (right === undefined) return 1 * multiplier
      const compared = this.compareDynamicSortValue(field.type, left, right)
      return compared === 0 ? leftId.localeCompare(rightId) : compared * multiplier
    })
  }

  private compareDynamicSortValue(type: FieldType, left: string, right: string): number {
    if (type === 'number' || type === 'currency' || type === 'percent') {
      const leftNumber = Number(left)
      const rightNumber = Number(right)
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1
      }
    }
    if (type === 'date' || type === 'datetime') {
      const leftTime = Date.parse(left)
      const rightTime = Date.parse(right)
      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
        return leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1
      }
    }
    return left.localeCompare(right, 'zh-CN', { numeric: true })
  }

  async create(user: AuthUser, dto: CreateFollowUpDto): Promise<FollowUpVO> {
    const sourcePlan = dto.sourcePlanId
      ? await this.ensureConvertiblePlan(user, dto.sourcePlanId)
      : null
    if (
      sourcePlan &&
      (sourcePlan.targetType !== dto.targetType || sourcePlan.targetId !== dto.targetId)
    ) {
      throw new BadRequestException('转记录目标必须与来源跟进计划一致')
    }
    await this.assertTargetAccess(user, dto.targetType, dto.targetId, true)
    await this.assertContact(user.tenantId, dto.targetType, dto.targetId, dto.contactId)
    const owner = await this.resolveOwner(user, dto.ownerId ?? sourcePlan?.ownerId)
    const dynamicValues = await this.moduleFieldsToDynamicValues(
      user.tenantId,
      dto.moduleFields ?? [],
    )
    const record = await this.prisma8.client.transaction(async (tx) => {
      if (sourcePlan) {
        const claimed = await tx.orm.public.FollowUpPlans.where({
          id: sourcePlan.id,
          tenantId: user.tenantId,
          status: 'COMPLETED',
          converted: false,
        }).updateAndCount({ converted: true, updatedAt: prisma8Now() })
        if (claimed !== 1) throw new ConflictException('该计划已转为跟进记录')
      }
      const created = await tx.orm.public.FollowUpRecords.create({
        tenantId: user.tenantId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        contactId: dto.contactId ?? null,
        _type: dto.type ?? null,
        content: dto.content,
        followedAt: dto.followedAt ? prisma8TimestampFromISOString(dto.followedAt) : prisma8Now(),
        ownerId: owner.id,
        ownerName: owner.name,
        deptId: owner.deptId,
        createdById: user.id,
        updatedAt: prisma8Now(),
      })
      await this.fieldValues.save(
        user.tenantId,
        'followRecord',
        created.id,
        dynamicValues,
        'create',
        tx,
        user.id,
      )
      await this.touchTarget(tx, user.tenantId, dto.targetType, dto.targetId, owner.id)
      if (sourcePlan) {
        await tx.orm.public.FollowUpPlans.where({ id: sourcePlan.id }).update({
          convertedRecordId: created.id,
          updatedAt: prisma8Now(),
        })
      }
      return this.toLegacyRecord(created)
    })
    return (await this.toVOs(user, [record]))[0]
  }

  async get(user: AuthUser, id: string): Promise<FollowUpVO> {
    const record = await this.ensureRecord(user, id)
    await this.assertTargetAccess(
      user,
      record.targetType as CreateFollowUpDto['targetType'],
      record.targetId,
      false,
    )
    const detail = (await this.toVOs(user, [record]))[0]
    return {
      ...detail,
      attachmentMap: await this.fieldValues.buildAttachmentMap(user.tenantId, 'followRecord', id),
    }
  }

  async viewAttachment(user: AuthUser, id: string, attachmentId: string) {
    await this.assertRecordAccess(user, id, false)
    if (
      !(await this.fieldValues.isAttachmentReferenced(
        user.tenantId,
        'followRecord',
        id,
        attachmentId,
      ))
    ) {
      throw new NotFoundException('附件不存在或已不再关联该跟进记录')
    }
    return this.attachments.viewFromTarget(
      user.tenantId,
      attachmentId,
      resourceFieldAttachmentTarget('followRecord'),
      id,
    )
  }

  async update(user: AuthUser, id: string, dto: UpdateFollowUpDto): Promise<FollowUpVO> {
    const existing = await this.ensureRecord(user, id)
    this.assertManageableRecord(user, existing)
    const currentType = existing.targetType as CreateFollowUpDto['targetType']
    await this.assertTargetAccess(user, currentType, existing.targetId, true)

    const targetType = dto.targetType ?? currentType
    const targetId = dto.targetId ?? existing.targetId
    if (targetType !== currentType || targetId !== existing.targetId) {
      await this.assertTargetAccess(user, targetType, targetId, true)
    }
    const contactId = dto.contactId === undefined ? existing.contactId : dto.contactId || null
    await this.assertContact(user.tenantId, targetType, targetId, contactId ?? undefined)
    const owner = dto.ownerId ? await this.resolveOwner(user, dto.ownerId) : null
    const dynamicValues =
      dto.moduleFields === undefined
        ? null
        : await this.moduleFieldsToDynamicValues(user.tenantId, dto.moduleFields)
    const updated = await this.prisma8.client.transaction(async (tx) => {
      const record = await tx.orm.public.FollowUpRecords.where({ id }).update({
        targetType,
        targetId,
        contactId,
        _type: dto.type,
        content: dto.content,
        followedAt:
          dto.followedAt === undefined
            ? existing.followedAt
            : dto.followedAt
              ? prisma8TimestampFromISOString(dto.followedAt)
              : null,
        ...(owner ? { ownerId: owner.id, ownerName: owner.name, deptId: owner.deptId } : {}),
        updatedAt: prisma8Now(),
      })
      if (!record) throw new NotFoundException('跟进记录不存在')
      if (dynamicValues !== null) {
        await this.fieldValues.save(
          user.tenantId,
          'followRecord',
          id,
          dynamicValues,
          'update',
          tx,
          user.id,
        )
      }
      await this.touchTarget(tx, user.tenantId, targetType, targetId, owner?.id ?? existing.ownerId)
      return this.toLegacyRecord(record)
    })
    return (await this.toVOs(user, [updated]))[0]
  }

  async remove(user: AuthUser, id: string) {
    const record = await this.ensureRecord(user, id)
    this.assertManageableRecord(user, record)
    await this.assertTargetAccess(
      user,
      record.targetType as CreateFollowUpDto['targetType'],
      record.targetId,
      true,
    )
    await this.prisma8.client.orm.public.FollowUpRecords.where({
      id,
      tenantId: user.tenantId,
    }).delete()
    return { id }
  }

  async assertRecordAccess(user: AuthUser, id: string, write = false): Promise<FollowRecord> {
    const record = await this.ensureRecord(user, id)
    await this.assertTargetAccess(
      user,
      record.targetType as CreateFollowUpDto['targetType'],
      record.targetId,
      write,
    )
    return record
  }

  async assertTargetAccess(
    user: AuthUser,
    targetType: CreateFollowUpDto['targetType'],
    targetId: string,
    write: boolean,
  ): Promise<void> {
    if (targetType === 'customer') {
      const access = write
        ? await this.customerAccess.assertFollowWrite(user, targetId)
        : await this.customerAccess.assertFollowRead(user, targetId)
      const permission = access.customer.inSharedPool
        ? write
          ? 'customerPool:update'
          : 'customerPool:read'
        : write
          ? 'customer:update'
          : 'customer:read'
      if (!hasPermission(user.permissions, permission))
        throw new ForbiddenException('无客户跟进权限')
      return
    }
    if (targetType === 'lead') {
      const lead = await this.prisma8.client.orm.public.Clue.where({
        id: targetId,
        organizationId: user.tenantId,
      })
        .select('owner', 'inSharedPool', 'poolId')
        .first()
      if (!lead) throw new NotFoundException('线索不存在')
      if (lead.inSharedPool) {
        const permission = write ? 'leadPool:update' : 'leadPool:read'
        if (!hasPermission(user.permissions, permission))
          throw new ForbiddenException('无线索池跟进权限')
        const poolIds = (await this.pools.options(user, 'lead')).map((pool) => String(pool.id))
        if (!lead.poolId || !poolIds.includes(String(lead.poolId))) {
          throw new NotFoundException('线索不存在或无权访问')
        }
        return
      }
      const permission = write ? 'lead:update' : 'menu:lead'
      if (!hasPermission(user.permissions, permission))
        throw new ForbiddenException('无线索跟进权限')
      if (
        !(await this.dataScope.matchesDirectOwner(
          user,
          lead.owner ? String(lead.owner) : null,
          permission,
        ))
      ) {
        throw new NotFoundException('线索不存在或不在你的数据范围内')
      }
      return
    }
    if (targetType === 'opportunity') {
      const permission = write ? 'opportunity:update' : 'menu:opportunity'
      if (!hasPermission(user.permissions, permission))
        throw new ForbiddenException('无商机跟进权限')
      const opportunity = await this.prisma8.client.orm.public.Opportunity.where({
        id: targetId,
        organizationId: user.tenantId,
      })
        .select('owner')
        .first()
      if (
        !opportunity ||
        !(await this.dataScope.matchesDirectOwner(user, String(opportunity.owner), permission))
      ) {
        throw new NotFoundException('商机不存在或不在你的数据范围内')
      }
    }
  }

  private async globalAccessibleRecordIds(user: AuthUser): Promise<string[]> {
    const canLead = hasPermission(user.permissions, 'menu:lead')
    const canLeadPool = hasPermission(user.permissions, 'leadPool:read')
    const canCustomer = hasPermission(user.permissions, 'customer:read')
    const canCustomerPool = hasPermission(user.permissions, 'customerPool:read')
    const canOpportunity = hasPermission(user.permissions, 'menu:opportunity')
    const [leadScope, customerScope, opportunityScope, leadPoolOptions, customerPoolOptions] =
      await Promise.all([
        canLead ? this.dataScope.directOwnerFilter(user, 'menu:lead') : null,
        canCustomer ? this.dataScope.directOwnerFilter(user, 'customer:read') : null,
        canOpportunity ? this.dataScope.directOwnerFilter(user, 'menu:opportunity') : null,
        canLeadPool ? this.pools.options(user, 'lead') : Promise.resolve([]),
        canCustomerPool ? this.pools.options(user, 'customer') : Promise.resolve([]),
      ])
    const applyOwnerScope = <
      T extends ReturnType<typeof this.prisma8.client.orm.public.Clue.where>,
    >(
      query: T,
      scope: any,
    ): T => {
      const owner = scope?.owner
      if (!owner) return query
      return (
        typeof owner === 'string'
          ? query.where({ owner: owner })
          : query.where((row: any) => row.owner.in(owner.in))
      ) as T
    }
    let directLeadQuery = this.prisma8.client.orm.public.Clue.where({
      organizationId: user.tenantId,
      inSharedPool: false,
    })
    if (leadScope) directLeadQuery = applyOwnerScope(directLeadQuery, leadScope)
    let directCustomerQuery = this.prisma8.client.orm.public.Customer.where({
      organizationId: user.tenantId,
      inSharedPool: false,
    })
    const customerOwner = (customerScope as any)?.owner
    if (customerOwner) {
      directCustomerQuery =
        typeof customerOwner === 'string'
          ? directCustomerQuery.where({ owner: customerOwner })
          : directCustomerQuery.where((row) => row.owner.in(customerOwner.in))
    }
    let opportunityQuery = this.prisma8.client.orm.public.Opportunity.where({
      organizationId: user.tenantId,
    })
    const opportunityOwner = (opportunityScope as any)?.owner
    if (opportunityOwner) {
      opportunityQuery =
        typeof opportunityOwner === 'string'
          ? opportunityQuery.where({ owner: opportunityOwner })
          : opportunityQuery.where((row) => row.owner.in(opportunityOwner.in))
    }
    const collaborationRows = canCustomer
      ? await this.prisma8.client.orm.public.CustomerCollaboration.where({ userId: user.id })
          .select('customerId')
          .all()
      : []
    const collaborationIds = collaborationRows.map((item) => String(item.customerId))
    const [
      directLeads,
      poolLeads,
      directCustomers,
      collaborativeCustomers,
      poolCustomers,
      opportunities,
    ] = await Promise.all([
      leadScope ? directLeadQuery.select('id').all() : Promise.resolve([]),
      canLeadPool && leadPoolOptions.length
        ? this.prisma8.client.orm.public.Clue.where({
            organizationId: user.tenantId,
            inSharedPool: true,
          })
            .where((row) => row.poolId.in(leadPoolOptions.map((item) => String(item.id))))
            .select('id')
            .all()
        : Promise.resolve([]),
      customerScope ? directCustomerQuery.select('id').all() : Promise.resolve([]),
      collaborationIds.length
        ? this.prisma8.client.orm.public.Customer.where({
            organizationId: user.tenantId,
            inSharedPool: false,
          })
            .where((row) => row.id.in(collaborationIds))
            .select('id')
            .all()
        : Promise.resolve([]),
      canCustomerPool && customerPoolOptions.length
        ? this.prisma8.client.orm.public.Customer.where({
            organizationId: user.tenantId,
            inSharedPool: true,
          })
            .where((row) => row.poolId.in(customerPoolOptions.map((item) => String(item.id))))
            .select('id')
            .all()
        : Promise.resolve([]),
      opportunityScope ? opportunityQuery.select('id').all() : Promise.resolve([]),
    ])
    const leadIds = [...new Set([...directLeads, ...poolLeads].map((item) => String(item.id)))]
    const customerIds = [
      ...new Set(
        [...directCustomers, ...collaborativeCustomers, ...poolCustomers].map((item) =>
          String(item.id),
        ),
      ),
    ]
    const opportunityIds = opportunities.map((item) => String(item.id))
    const groups = await Promise.all([
      leadIds.length
        ? this.prisma8.client.orm.public.FollowUpRecords.where({
            tenantId: user.tenantId,
            targetType: 'lead',
          })
            .where((row) => row.targetId.in(leadIds))
            .select('id')
            .all()
        : Promise.resolve([]),
      customerIds.length
        ? this.prisma8.client.orm.public.FollowUpRecords.where({
            tenantId: user.tenantId,
            targetType: 'customer',
          })
            .where((row) => row.targetId.in(customerIds))
            .select('id')
            .all()
        : Promise.resolve([]),
      opportunityIds.length
        ? this.prisma8.client.orm.public.FollowUpRecords.where({
            tenantId: user.tenantId,
            targetType: 'opportunity',
          })
            .where((row) => row.targetId.in(opportunityIds))
            .select('id')
            .all()
        : Promise.resolve([]),
    ])
    return [...new Set(groups.flat().map((item) => item.id))]
  }

  private async keywordRecordIds(tenantId: string, keyword: string): Promise<string[]> {
    const [leads, customers, opportunities, direct] = await Promise.all([
      this.prisma8.client.orm.public.Clue.where({ organizationId: tenantId })
        .where((row) => row.name.ilike(`%${keyword}%`))
        .select('id')
        .all(),
      this.prisma8.client.orm.public.Customer.where({ organizationId: tenantId })
        .where((row) => row.name.ilike(`%${keyword}%`))
        .select('id')
        .all(),
      this.prisma8.client.orm.public.Opportunity.where({ organizationId: tenantId })
        .where((row) => row.name.ilike(`%${keyword}%`))
        .select('id')
        .all(),
      this.prisma8.client.orm.public.FollowUpRecords.where({ tenantId })
        .where((row) =>
          or(
            row.content.ilike(`%${keyword}%`),
            row._type.ilike(`%${keyword}%`),
            row.ownerName.ilike(`%${keyword}%`),
          ),
        )
        .select('id')
        .all(),
    ])
    const [leadRecords, customerRecords, opportunityRecords] = await Promise.all([
      leads.length
        ? this.prisma8.client.orm.public.FollowUpRecords.where({ tenantId, targetType: 'lead' })
            .where((row) => row.targetId.in(leads.map((item) => String(item.id))))
            .select('id')
            .all()
        : Promise.resolve([]),
      customers.length
        ? this.prisma8.client.orm.public.FollowUpRecords.where({ tenantId, targetType: 'customer' })
            .where((row) => row.targetId.in(customers.map((item) => String(item.id))))
            .select('id')
            .all()
        : Promise.resolve([]),
      opportunities.length
        ? this.prisma8.client.orm.public.FollowUpRecords.where({
            tenantId,
            targetType: 'opportunity',
          })
            .where((row) => row.targetId.in(opportunities.map((item) => String(item.id))))
            .select('id')
            .all()
        : Promise.resolve([]),
    ])
    return [
      ...new Set(
        [...direct, ...leadRecords, ...customerRecords, ...opportunityRecords].map(
          (item) => item.id,
        ),
      ),
    ]
  }

  private async filterIds(
    tenantId: string,
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
  ): Promise<string[]> {
    const fields = await this.moduleForms.listFields(tenantId, 'followRecord')
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
    const conditionIds = await Promise.all(
      conditions.map(async (condition) => {
        const field = fieldMap.get(condition.key)
        if (!field) throw new BadRequestException(`筛选字段不存在：${condition.key}`)
        if (!filterOpsForType(field.type).includes(condition.op)) {
          throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
        }
        if (!field.system) {
          return this.fieldValues.filterResourceIds(tenantId, 'followRecord', [condition])
        }
        let query = this.prisma8.client.orm.public.FollowUpRecords.where({ tenantId })
        query = this.applySystemFilter(query, field, condition)
        const rows = await query.select('id').all()
        return rows.map((row) => row.id)
      }),
    )
    if (!conditionIds.length) return []
    if (mode === 'OR') return [...new Set(conditionIds.flat())]
    let selected = new Set(conditionIds[0])
    for (const ids of conditionIds.slice(1)) {
      const current = new Set(ids)
      selected = new Set([...selected].filter((id) => current.has(id)))
    }
    return [...selected]
  }

  private applySystemFilter(
    collection: ReturnType<typeof this.prisma8.client.orm.public.FollowUpRecords.where>,
    field: FieldVO,
    condition: FilterCondition,
  ) {
    const key = field.key
    const allowed = new Set([
      'targetType',
      'targetId',
      'ownerId',
      'contactId',
      'followedAt',
      'content',
      'type',
    ])
    if (!allowed.has(key)) throw new BadRequestException(`筛选字段不支持：${key}`)
    const impossible = () => collection.where((row) => row.id.eq(''))

    if (condition.op === 'isEmpty') {
      if (key === 'followedAt') return collection.where((row) => row.followedAt.isNull())
      if (key === 'contactId') {
        return collection.where((row) => or(row.contactId.isNull(), row.contactId.eq('')))
      }
      if (key === 'type') {
        return collection.where((row) => or(row._type.isNull(), row._type.eq('')))
      }
      return impossible()
    }
    if (condition.op === 'notEmpty') {
      if (key === 'followedAt') return collection.where((row) => row.followedAt.isNotNull())
      if (key === 'contactId') {
        return collection.where((row) => not(or(row.contactId.isNull(), row.contactId.eq(''))))
      }
      if (key === 'type') {
        return collection.where((row) => not(or(row._type.isNull(), row._type.eq(''))))
      }
      return collection
    }
    if (condition.value === undefined || condition.value === null || condition.value === '') {
      throw new BadRequestException(`「${field.label}」筛选值不能为空`)
    }
    if (key === 'followedAt') {
      const value = new Date(String(condition.value))
      if (Number.isNaN(value.getTime())) throw new BadRequestException('跟进时间筛选值不合法')
      const timestamp = prisma8TimestampFromDate(value)
      if (condition.op === 'gte') return collection.where((row) => row.followedAt.gte(timestamp))
      if (condition.op === 'lte') return collection.where((row) => row.followedAt.lte(timestamp))
      throw new BadRequestException('跟进时间不支持该筛选操作')
    }
    const values =
      condition.op === 'in' || condition.op === 'notIn'
        ? (() => {
            if (!Array.isArray(condition.value) || !condition.value.length) {
              throw new BadRequestException(`「${field.label}」筛选值必须是非空数组`)
            }
            return condition.value.map((item) => String(item))
          })()
        : [String(condition.value)]
    if (
      key === 'targetType' &&
      values.some((value) => !['lead', 'customer', 'opportunity'].includes(value))
    ) {
      throw new BadRequestException('关联类型筛选值不合法')
    }
    const value = values[0]!
    return collection.where((row) => {
      const column =
        key === 'targetType'
          ? row.targetType
          : key === 'targetId'
            ? row.targetId
            : key === 'ownerId'
              ? row.ownerId
              : key === 'contactId'
                ? row.contactId
                : key === 'content'
                  ? row.content
                  : row._type
      if (condition.op === 'eq') return column.eq(value)
      if (condition.op === 'ne') return column.neq(value)
      if (condition.op === 'in') return column.in(values)
      if (condition.op === 'notIn') return not(column.in(values))
      if (condition.op === 'contains') return column.ilike(`%${value}%`)
      if (condition.op === 'notContains') return not(column.ilike(`%${value}%`))
      return row.id.eq('')
    })
  }

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
  }

  private async ensureRecord(user: AuthUser, id: string): Promise<FollowRecord> {
    const record = await this.prisma8.client.orm.public.FollowUpRecords.where({
      id,
      tenantId: user.tenantId,
    }).first()
    if (!record) throw new NotFoundException('跟进记录不存在')
    return this.toLegacyRecord(record)
  }

  private assertManageableRecord(user: AuthUser, record: FollowRecord): void {
    if (record.ownerId !== user.id && !hasPermission(user.permissions, '*')) {
      throw new ForbiddenException('只有跟进记录负责人可以执行此操作')
    }
  }

  private async ensureConvertiblePlan(user: AuthUser, id: string) {
    const plan = await this.prisma8.client.orm.public.FollowUpPlans.where({
      id,
      tenantId: user.tenantId,
    }).first()
    if (!plan) throw new NotFoundException('跟进计划不存在')
    if (plan.ownerId !== user.id && !hasPermission(user.permissions, '*')) {
      throw new ForbiddenException('只有跟进计划负责人可以转为记录')
    }
    if (plan.status !== 'COMPLETED') throw new BadRequestException('只有已完成计划才能转为记录')
    if (plan.converted) throw new ConflictException('该计划已转为跟进记录')
    return plan
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) {
      return { id: user.id, name: user.name, deptId: user.deptId }
    }
    const owner = await this.prisma8.client.orm.public.Users.where({
      id: ownerId,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id', 'name', 'deptId')
      .first()
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner
  }

  private async assertContact(
    tenantId: string,
    targetType: CreateFollowUpDto['targetType'],
    targetId: string,
    contactId?: string,
  ): Promise<void> {
    if (!contactId) return
    let customerId: string | null = targetType === 'customer' ? targetId : null
    if (targetType === 'opportunity') {
      const opportunity = await this.prisma8.client.orm.public.Opportunity.where({
        id: targetId,
        organizationId: tenantId,
      })
        .select('customerId')
        .first()
      customerId = opportunity?.customerId ? String(opportunity.customerId) : null
    }
    if (!customerId) throw new BadRequestException('当前业务对象不能关联客户联系人')
    const contact = await this.prisma8.client.orm.public.CustomerContact.where({
      id: contactId,
      organizationId: tenantId,
      customerId: customerId,
    })
      .select('id')
      .first()
    if (!contact) throw new BadRequestException('联系人不属于当前客户')
  }

  /** 更新目标对象的最近跟进时间与跟进人；跟记录写入保持同一事务。 */
  private async touchTarget(
    tx: Prisma8Transaction,
    tenantId: string,
    targetType: string,
    targetId: string,
    ownerId: string,
  ) {
    const directNow = BigInt(Date.now())
    switch (targetType) {
      case 'lead':
        await tx.orm.public.Clue.where({
          id: targetId,
          organizationId: tenantId,
        }).updateAndCount({
          followTime: directNow,
          follower: ownerId,
          updateTime: directNow,
        })
        break
      case 'customer':
        await tx.orm.public.Customer.where({
          id: targetId,
          organizationId: tenantId,
        }).updateAndCount({
          followTime: directNow,
          follower: ownerId,
          updateTime: directNow,
        })
        break
      case 'opportunity':
        await tx.orm.public.Opportunity.where({
          id: targetId,
          organizationId: tenantId,
        }).updateAndCount({
          followTime: directNow,
          follower: ownerId,
          updateTime: directNow,
        })
        break
      default:
        break
    }
  }

  private toLegacyRecord(row: {
    id: string
    tenantId: string
    targetType: string
    targetId: string
    contactId: string | null
    _type: string | null
    content: string
    followedAt: ReturnType<typeof prisma8Now> | null
    ownerId: string
    ownerName: string
    deptId: string | null
    createdById: string
    commentCount: number
    createdAt: ReturnType<typeof prisma8Now>
    updatedAt: ReturnType<typeof prisma8Now>
  }): FollowRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      targetType: row.targetType,
      targetId: row.targetId,
      contactId: row.contactId,
      type: row._type,
      content: row.content,
      followedAt: row.followedAt,
      ownerId: row.ownerId,
      ownerName: row.ownerName,
      deptId: row.deptId,
      createdById: row.createdById,
      commentCount: row.commentCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private async moduleFieldsToDynamicValues(
    tenantId: string,
    moduleFields: Array<{ fieldId: string; fieldValue?: unknown }>,
  ): Promise<Record<string, unknown>> {
    if (!moduleFields.length) return {}
    const fields = await this.moduleForms.listFields(tenantId, 'followRecord')
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
    const values: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = fieldMap.get(item.fieldId)
      if (!field) throw new BadRequestException(`跟进记录字段不存在：${item.fieldId}`)
      if (field.system) continue
      values[field.key] = item.fieldValue
    }
    return values
  }

  private async toVOs(user: AuthUser, records: FollowRecord[]): Promise<FollowUpVO[]> {
    if (!records.length) return []
    const ids = records.map((record) => record.id)
    const leadIds = records
      .filter((record) => record.targetType === 'lead')
      .map((record) => record.targetId)
    const customerIds = records
      .filter((record) => record.targetType === 'customer')
      .map((record) => record.targetId)
    const opportunityIds = records
      .filter((record) => record.targetType === 'opportunity')
      .map((record) => record.targetId)
    const contactIds = records.flatMap((record) => (record.contactId ? [record.contactId] : []))
    const [fields, dynamic, leads, customers, opportunities, contacts] = await Promise.all([
      this.moduleForms.listFields(user.tenantId, 'followRecord'),
      this.fieldValues.load(user.tenantId, 'followRecord', ids),
      leadIds.length
        ? this.prisma8.client.orm.public.Clue.where({
            organizationId: user.tenantId,
          })
            .where((row) => row.id.in(leadIds))
            .select('id', 'name')
            .all()
        : Promise.resolve([]),
      customerIds.length
        ? this.prisma8.client.orm.public.Customer.where({
            organizationId: user.tenantId,
          })
            .where((row) => row.id.in(customerIds))
            .select('id', 'name')
            .all()
        : Promise.resolve([]),
      opportunityIds.length
        ? this.prisma8.client.orm.public.Opportunity.where({
            organizationId: user.tenantId,
          })
            .where((row) => row.id.in(opportunityIds))
            .select('id', 'name', 'customerId')
            .all()
        : Promise.resolve([]),
      contactIds.length
        ? this.prisma8.client.orm.public.CustomerContact.where({
            organizationId: user.tenantId,
          })
            .where((row) => row.id.in(contactIds))
            .select('id', 'name')
            .all()
        : Promise.resolve([]),
    ])
    const targetNameMap = new Map<string, string>([
      ...leads.map((item) => [`lead:${String(item.id)}`, item.name] as const),
      ...customers.map((item) => [`customer:${String(item.id)}`, item.name] as const),
      ...opportunities.map((item) => [`opportunity:${String(item.id)}`, item.name] as const),
    ])
    const opportunityCustomerMap = new Map(
      opportunities.map((item) => [
        String(item.id),
        item.customerId ? String(item.customerId) : null,
      ]),
    )
    const contactMap = new Map(contacts.map((item) => [String(item.id), item.name]))
    return records.map((record) => {
      const dynamicValues = dynamic.get(record.id) ?? {}
      return {
        id: record.id,
        targetType: record.targetType as FollowUpVO['targetType'],
        targetId: record.targetId,
        targetName:
          targetNameMap.get(`${record.targetType}:${record.targetId}`) ?? '已删除业务对象',
        customerId:
          record.targetType === 'customer'
            ? record.targetId
            : record.targetType === 'opportunity'
              ? (opportunityCustomerMap.get(record.targetId) ?? null)
              : null,
        contactId: record.contactId,
        contactName: record.contactId ? (contactMap.get(record.contactId) ?? null) : null,
        type: record.type,
        content: record.content,
        followedAt: record.followedAt ? prisma8TimestampToISOString(record.followedAt) : null,
        ownerId: record.ownerId,
        ownerName: record.ownerName,
        canManage: record.ownerId === user.id || hasPermission(user.permissions, '*'),
        commentCount: record.commentCount,
        moduleFields: fields
          .filter(
            (field) =>
              !field.system && Object.prototype.hasOwnProperty.call(dynamicValues, field.key),
          )
          .map((field) => ({ fieldId: field.id, fieldValue: dynamicValues[field.key] })),
        createdAt: prisma8TimestampToISOString(record.createdAt),
        updatedAt: prisma8TimestampToISOString(record.updatedAt),
      }
    })
  }
}
