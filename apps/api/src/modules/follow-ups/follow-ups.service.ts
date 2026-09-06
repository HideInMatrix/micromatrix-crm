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
import { FollowUpRecord, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
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

type FollowRecordResolvedSort =
  | { kind: 'system'; orderBy: Prisma.FollowUpRecordOrderByWithRelationInput[] }
  | { kind: 'dynamic'; field: FieldVO; direction: 'asc' | 'desc' }

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
    private readonly prisma: PrismaService,
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

    const accessWhere =
      dto.targetType && dto.targetId
        ? await this.targetAccessWhere(user, dto.targetType, dto.targetId)
        : await this.globalAccessWhere(user)
    const saved = dto.viewId
      ? await this.userViews.resolveFilters(
          user,
          dto.viewId,
          USER_VIEW_RESOURCE_TYPES.follow_record,
        )
      : null
    const [savedIds, adHocIds, keywordWhere] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, saved.conditions, saved.searchMode)
        : null,
      dto.filters?.length
        ? this.filterIds(user.tenantId, dto.filters, dto.filterMode ?? 'AND')
        : null,
      dto.keyword?.trim() ? this.keywordWhere(user.tenantId, dto.keyword.trim()) : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)

    const where: Prisma.FollowUpRecordWhereInput = {
      tenantId: user.tenantId,
      AND: [
        accessWhere,
        ...(dto.targetType ? [{ targetType: dto.targetType }] : []),
        ...(keywordWhere ? [keywordWhere] : []),
        ...(dto.mine ? [{ ownerId: user.id }] : []),
        ...(filteredIds ? [{ id: { in: filteredIds } }] : []),
      ],
    }
    const sort = await this.resolveSort(user.tenantId, dto)
    let records: FollowUpRecord[]
    let total: number
    if (sort.kind === 'dynamic') {
      const candidateRows = await this.prisma.followUpRecord.findMany({
        where,
        select: { id: true },
      })
      total = candidateRows.length
      const orderedIds = await this.sortDynamicRecordIds(
        candidateRows.map((item) => item.id),
        sort.field,
        sort.direction,
      )
      const pageIds = orderedIds.slice((page - 1) * pageSize, page * pageSize)
      const rows = pageIds.length
        ? await this.prisma.followUpRecord.findMany({ where: { ...where, id: { in: pageIds } } })
        : []
      const rowMap = new Map(rows.map((item) => [item.id, item]))
      records = pageIds.flatMap((id) => {
        const row = rowMap.get(id)
        return row ? [row] : []
      })
    } else {
      ;[records, total] = await this.prisma.$transaction([
        this.prisma.followUpRecord.findMany({
          where,
          orderBy: sort.orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.followUpRecord.count({ where }),
      ])
    }
    return {
      items: await this.toVOs(user, records),
      total,
      page,
      pageSize,
    }
  }

  private async resolveSort(
    tenantId: string,
    dto: FollowUpRecordPageDto,
  ): Promise<FollowRecordResolvedSort> {
    if (!dto.sort?.name) {
      return {
        kind: 'system',
        orderBy: [{ followedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      }
    }
    const direction = dto.sort.type
    const systemColumns: Record<string, keyof Prisma.FollowUpRecordOrderByWithRelationInput> = {
      targetType: 'targetType',
      targetId: 'targetId',
      ownerId: 'ownerId',
      contactId: 'contactId',
      followedAt: 'followedAt',
      type: 'type',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    }
    const directColumn = systemColumns[dto.sort.name]
    if (directColumn) {
      return {
        kind: 'system',
        orderBy: [
          { [directColumn]: direction } as Prisma.FollowUpRecordOrderByWithRelationInput,
          { id: 'asc' },
        ],
      }
    }

    const fields = await this.moduleForms.listFields(tenantId, 'followRecord')
    const field = fields.find(
      (candidate) => candidate.id === dto.sort?.name || candidate.key === dto.sort?.name,
    )
    if (!field) throw new BadRequestException(`排序字段不存在：${dto.sort.name}`)
    if (field.system) {
      const column = systemColumns[field.key]
      if (!column) throw new BadRequestException(`「${field.label}」不支持排序`)
      return {
        kind: 'system',
        orderBy: [
          { [column]: direction } as Prisma.FollowUpRecordOrderByWithRelationInput,
          { id: 'asc' },
        ],
      }
    }
    if (!FOLLOW_RECORD_DYNAMIC_SORT_TYPES.has(field.type)) {
      throw new BadRequestException(`「${field.label}」不支持排序`)
    }
    return { kind: 'dynamic', field, direction }
  }

  private async sortDynamicRecordIds(
    recordIds: string[],
    field: FieldVO,
    direction: 'asc' | 'desc',
  ): Promise<string[]> {
    if (recordIds.length <= 1) return recordIds
    const [normalRows, blobRows] = await Promise.all([
      this.prisma.followUpRecordField.findMany({
        where: { resourceId: { in: recordIds }, fieldId: field.id },
        select: { resourceId: true, fieldValue: true },
      }),
      this.prisma.followUpRecordFieldBlob.findMany({
        where: { resourceId: { in: recordIds }, fieldId: field.id },
        select: { resourceId: true, fieldValue: true },
      }),
    ])
    const values = new Map(
      [...normalRows, ...blobRows].map((item) => [item.resourceId, item.fieldValue] as const),
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
    const record = await this.prisma.$transaction(async (tx) => {
      if (sourcePlan) {
        const claimed = await tx.followUpPlan.updateMany({
          where: {
            id: sourcePlan.id,
            tenantId: user.tenantId,
            status: 'COMPLETED',
            converted: false,
          },
          data: { converted: true },
        })
        if (claimed.count !== 1) throw new ConflictException('该计划已转为跟进记录')
      }
      const created = await tx.followUpRecord.create({
        data: {
          tenantId: user.tenantId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          contactId: dto.contactId ?? null,
          type: dto.type ?? null,
          content: dto.content,
          followedAt: dto.followedAt ? new Date(dto.followedAt) : new Date(),
          ownerId: owner.id,
          ownerName: owner.name,
          deptId: owner.deptId,
          createdById: user.id,
        },
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
        await tx.followUpPlan.update({
          where: { id: sourcePlan.id },
          data: { convertedRecordId: created.id },
        })
      }
      return created
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
    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.followUpRecord.update({
        where: { id },
        data: {
          targetType,
          targetId,
          contactId,
          type: dto.type,
          content: dto.content,
          followedAt:
            dto.followedAt === undefined
              ? existing.followedAt
              : dto.followedAt
                ? new Date(dto.followedAt)
                : null,
          ...(owner ? { ownerId: owner.id, ownerName: owner.name, deptId: owner.deptId } : {}),
        },
      })
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
      return record
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
    await this.prisma.followUpRecord.delete({ where: { id } })
    return { id }
  }

  async assertRecordAccess(user: AuthUser, id: string, write = false): Promise<FollowUpRecord> {
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
      const lead = await this.prisma.clue.findFirst({
        where: { id: targetId, organizationId: user.tenantId },
        select: { owner: true, inSharedPool: true, poolId: true },
      })
      if (!lead) throw new NotFoundException('线索不存在')
      if (lead.inSharedPool) {
        const permission = write ? 'leadPool:update' : 'leadPool:read'
        if (!hasPermission(user.permissions, permission))
          throw new ForbiddenException('无线索池跟进权限')
        const poolIds = (await this.pools.options(user, 'lead')).map((pool) => pool.id)
        if (!lead.poolId || !poolIds.includes(lead.poolId)) {
          throw new NotFoundException('线索不存在或无权访问')
        }
        return
      }
      const permission = write ? 'lead:update' : 'menu:lead'
      if (!hasPermission(user.permissions, permission))
        throw new ForbiddenException('无线索跟进权限')
      if (!(await this.dataScope.matchesDirectOwner(user, lead.owner, permission))) {
        throw new NotFoundException('线索不存在或不在你的数据范围内')
      }
      return
    }

    if (targetType === 'opportunity') {
      const permission = write ? 'opportunity:update' : 'menu:opportunity'
      if (!hasPermission(user.permissions, permission))
        throw new ForbiddenException('无商机跟进权限')
      const opportunity = await this.prisma.opportunity.findFirst({
        where: { id: targetId, organizationId: user.tenantId },
        select: { owner: true },
      })
      if (
        !opportunity ||
        !(await this.dataScope.matchesDirectOwner(user, opportunity.owner, permission))
      ) {
        throw new NotFoundException('商机不存在或不在你的数据范围内')
      }
      return
    }
  }

  private async targetAccessWhere(
    user: AuthUser,
    targetType: CreateFollowUpDto['targetType'],
    targetId: string,
  ): Promise<Prisma.FollowUpRecordWhereInput> {
    await this.assertTargetAccess(user, targetType, targetId, false)
    return { targetType, targetId }
  }

  private async globalAccessWhere(user: AuthUser): Promise<Prisma.FollowUpRecordWhereInput> {
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

    const leadPoolIds = leadPoolOptions.map((item) => item.id)
    const customerPoolIds = customerPoolOptions.map((item) => item.id)
    const [
      directLeads,
      poolLeads,
      directCustomers,
      collaborativeCustomers,
      poolCustomers,
      opportunities,
    ] = await Promise.all([
      leadScope
        ? this.prisma.clue.findMany({
            where: {
              organizationId: user.tenantId,
              inSharedPool: false,
              ...leadScope,
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      canLeadPool && leadPoolIds.length
        ? this.prisma.clue.findMany({
            where: {
              organizationId: user.tenantId,
              inSharedPool: true,
              poolId: { in: leadPoolIds },
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      customerScope
        ? this.prisma.customer.findMany({
            where: {
              organizationId: user.tenantId,
              inSharedPool: false,
              ...customerScope,
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      canCustomer
        ? this.prisma.customerCollaboration.findMany({
            where: {
              userId: user.id,
              customer: { organizationId: user.tenantId, inSharedPool: false },
            },
            select: { customerId: true },
          })
        : Promise.resolve([]),
      canCustomerPool && customerPoolIds.length
        ? this.prisma.customer.findMany({
            where: {
              organizationId: user.tenantId,
              inSharedPool: true,
              poolId: { in: customerPoolIds },
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      opportunityScope
        ? this.prisma.opportunity.findMany({
            where: { organizationId: user.tenantId, ...opportunityScope },
            select: { id: true },
          })
        : Promise.resolve([]),
    ])

    const leadIds = [...new Set([...directLeads, ...poolLeads].map((item) => item.id))]
    const customerIds = [
      ...new Set([
        ...directCustomers.map((item) => item.id),
        ...collaborativeCustomers.map((item) => item.customerId),
        ...poolCustomers.map((item) => item.id),
      ]),
    ]
    const opportunityIds = opportunities.map((item) => item.id)
    const clauses: Prisma.FollowUpRecordWhereInput[] = []
    if (leadIds.length) clauses.push({ targetType: 'lead', targetId: { in: leadIds } })
    if (customerIds.length) clauses.push({ targetType: 'customer', targetId: { in: customerIds } })
    if (opportunityIds.length) {
      clauses.push({ targetType: 'opportunity', targetId: { in: opportunityIds } })
    }
    return clauses.length ? { OR: clauses } : { id: { in: [] } }
  }

  private async keywordWhere(
    tenantId: string,
    keyword: string,
  ): Promise<Prisma.FollowUpRecordWhereInput> {
    const contains = { contains: keyword, mode: 'insensitive' as const }
    const [leads, customers, opportunities] = await Promise.all([
      this.prisma.clue.findMany({
        where: { organizationId: tenantId, name: contains },
        select: { id: true },
      }),
      this.prisma.customer.findMany({
        where: { organizationId: tenantId, name: contains },
        select: { id: true },
      }),
      this.prisma.opportunity.findMany({
        where: { organizationId: tenantId, name: contains },
        select: { id: true },
      }),
    ])
    return {
      OR: [
        { content: contains },
        { type: contains },
        { ownerName: contains },
        { targetType: 'lead', targetId: { in: leads.map((item) => item.id) } },
        { targetType: 'customer', targetId: { in: customers.map((item) => item.id) } },
        { targetType: 'opportunity', targetId: { in: opportunities.map((item) => item.id) } },
      ],
    }
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
        const rows = await this.prisma.followUpRecord.findMany({
          where: {
            tenantId,
            ...this.systemFilterClause(field, condition),
          },
          select: { id: true },
        })
        return rows.map((row) => row.id)
      }),
    )
    if (!conditionIds.length) return []
    if (mode === 'OR') {
      return [...new Set(conditionIds.flat())]
    }
    let selected = new Set(conditionIds[0])
    for (const ids of conditionIds.slice(1)) {
      const current = new Set(ids)
      selected = new Set([...selected].filter((id) => current.has(id)))
    }
    return [...selected]
  }

  private systemFilterClause(
    field: FieldVO,
    condition: FilterCondition,
  ): Prisma.FollowUpRecordWhereInput {
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

    const nullableText = new Set(['contactId', 'type'])
    if (condition.op === 'isEmpty') {
      if (key === 'followedAt') return { followedAt: null }
      if (nullableText.has(key)) {
        return {
          OR: [
            { [key]: null } as Prisma.FollowUpRecordWhereInput,
            { [key]: '' } as Prisma.FollowUpRecordWhereInput,
          ],
        }
      }
      return { id: { in: [] } }
    }
    if (condition.op === 'notEmpty') {
      if (key === 'followedAt') return { followedAt: { not: null } }
      if (nullableText.has(key)) {
        return {
          AND: [
            { [key]: { not: null } } as Prisma.FollowUpRecordWhereInput,
            { [key]: { not: '' } } as Prisma.FollowUpRecordWhereInput,
          ],
        }
      }
      return {}
    }

    if (condition.value === undefined || condition.value === null || condition.value === '') {
      throw new BadRequestException(`「${field.label}」筛选值不能为空`)
    }
    if (key === 'followedAt') {
      const value = new Date(String(condition.value))
      if (Number.isNaN(value.getTime())) throw new BadRequestException('跟进时间筛选值不合法')
      if (condition.op === 'gte') return { followedAt: { gte: value } }
      if (condition.op === 'lte') return { followedAt: { lte: value } }
      throw new BadRequestException('跟进时间不支持该筛选操作')
    }

    const listValue = () => {
      if (!Array.isArray(condition.value) || !condition.value.length) {
        throw new BadRequestException(`「${field.label}」筛选值必须是非空数组`)
      }
      return condition.value.map((item) => String(item))
    }
    if (key === 'targetType') {
      const values =
        condition.op === 'in' || condition.op === 'notIn' ? listValue() : [String(condition.value)]
      if (values.some((value) => !['lead', 'customer', 'opportunity'].includes(value))) {
        throw new BadRequestException('关联类型筛选值不合法')
      }
    }

    if (condition.op === 'in') {
      return { [key]: { in: listValue() } } as Prisma.FollowUpRecordWhereInput
    }
    if (condition.op === 'notIn') {
      return { [key]: { notIn: listValue() } } as Prisma.FollowUpRecordWhereInput
    }
    const value = String(condition.value)
    if (condition.op === 'contains') {
      return {
        [key]: { contains: value, mode: 'insensitive' },
      } as Prisma.FollowUpRecordWhereInput
    }
    if (condition.op === 'notContains') {
      return {
        [key]: { not: { contains: value, mode: 'insensitive' } },
      } as Prisma.FollowUpRecordWhereInput
    }
    if (condition.op === 'eq') return { [key]: value } as Prisma.FollowUpRecordWhereInput
    if (condition.op === 'ne') {
      return { [key]: { not: value } } as Prisma.FollowUpRecordWhereInput
    }
    throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
  }

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
  }

  private async ensureRecord(user: AuthUser, id: string): Promise<FollowUpRecord> {
    const record = await this.prisma.followUpRecord.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!record) throw new NotFoundException('跟进记录不存在')
    return record
  }

  private assertManageableRecord(user: AuthUser, record: FollowUpRecord): void {
    if (record.ownerId !== user.id && !hasPermission(user.permissions, '*')) {
      throw new ForbiddenException('只有跟进记录负责人可以执行此操作')
    }
  }

  private async ensureConvertiblePlan(user: AuthUser, id: string) {
    const plan = await this.prisma.followUpPlan.findFirst({
      where: { id, tenantId: user.tenantId },
    })
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
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, deptId: true },
    })
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
      customerId =
        (
          await this.prisma.opportunity.findFirst({
            where: { id: targetId, organizationId: tenantId },
            select: { customerId: true },
          })
        )?.customerId ?? null
    }
    if (!customerId) throw new BadRequestException('当前业务对象不能关联客户联系人')
    const contact = await this.prisma.customerContact.findFirst({
      where: { id: contactId, organizationId: tenantId, customerId },
      select: { id: true },
    })
    if (!contact) throw new BadRequestException('联系人不属于当前客户')
  }

  /** 更新目标对象的最近跟进时间与跟进人；跟记录写入保持同一事务。 */
  private async touchTarget(
    client: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    targetType: string,
    targetId: string,
    ownerId: string,
  ) {
    const now = new Date()
    const directNow = BigInt(now.getTime())
    switch (targetType) {
      case 'lead':
        await client.clue.updateMany({
          where: { id: targetId, organizationId: tenantId },
          data: { followTime: directNow, follower: ownerId, updateTime: directNow },
        })
        break
      case 'customer':
        await client.customer.updateMany({
          where: { id: targetId, organizationId: tenantId },
          data: { followTime: directNow, follower: ownerId, updateTime: directNow },
        })
        break
      case 'opportunity':
        await client.opportunity.updateMany({
          where: { id: targetId, organizationId: tenantId },
          data: { followTime: directNow, follower: ownerId, updateTime: directNow },
        })
        break
      default:
        break
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

  private async toVOs(user: AuthUser, records: FollowUpRecord[]): Promise<FollowUpVO[]> {
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
        ? this.prisma.clue.findMany({
            where: { id: { in: leadIds }, organizationId: user.tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      customerIds.length
        ? this.prisma.customer.findMany({
            where: { id: { in: customerIds }, organizationId: user.tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      opportunityIds.length
        ? this.prisma.opportunity.findMany({
            where: { id: { in: opportunityIds }, organizationId: user.tenantId },
            select: { id: true, name: true, customerId: true },
          })
        : Promise.resolve([]),
      contactIds.length
        ? this.prisma.customerContact.findMany({
            where: { id: { in: contactIds }, organizationId: user.tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ])
    const targetNameMap = new Map<string, string>([
      ...leads.map((item) => [`lead:${item.id}`, item.name] as const),
      ...customers.map((item) => [`customer:${item.id}`, item.name] as const),
      ...opportunities.map((item) => [`opportunity:${item.id}`, item.name] as const),
    ])
    const opportunityCustomerMap = new Map(opportunities.map((item) => [item.id, item.customerId]))
    const contactMap = new Map(contacts.map((item) => [item.id, item.name]))
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
        followedAt: record.followedAt?.toISOString() ?? null,
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
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      }
    })
  }
}
