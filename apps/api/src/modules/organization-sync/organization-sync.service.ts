import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import type {
  OrganizationSyncBatchVO,
  OrganizationSyncCounts,
  OrganizationSyncGateVO,
  OrganizationSyncItemVO,
  PaginatedResult,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import {
  prisma8Now,
  prisma8TimestampFromDate,
  prisma8TimestampToISOString,
} from '../../prisma/prisma8-temporal'
import { prisma8JsonValue } from '../../prisma/prisma8-values'
import {
  EnterpriseIntegrationsService,
  type EnterpriseIntegrationRow,
} from '../enterprise-integrations/enterprise-integrations.service'
import {
  DingTalkClient,
  type DingTalkConnectionInput,
} from '../enterprise-integrations/dingtalk.client'
import { LarkClient, type LarkConnectionInput } from '../enterprise-integrations/lark.client'
import {
  OrganizationSnapshotError,
  type OrganizationSnapshot,
} from '../enterprise-integrations/organization-snapshot'
import { WeComClient, type WeComConnectionInput } from '../enterprise-integrations/wecom.client'
import type {
  CreateOrganizationSyncPreviewDto,
  QueryOrganizationSyncBatchesDto,
  QueryOrganizationSyncItemsDto,
  ResolveOrganizationSyncDto,
} from './dto/organization-sync.dto'
import { OrganizationSyncCoordinationService } from './organization-sync-coordination.service'
import { OrganizationSyncPlanner, type OrganizationSyncPlanItem } from './organization-sync.planner'

export type OrganizationSyncProvider = 'WECOM' | 'DINGTALK' | 'LARK'

type OrganizationSyncBatchRow = NonNullable<
  Awaited<ReturnType<Prisma8Service['client']['orm']['public']['OrganizationSyncBatches']['first']>>
>
type OrganizationSyncItemRow = NonNullable<
  Awaited<ReturnType<Prisma8Service['client']['orm']['public']['OrganizationSyncItems']['first']>>
>
type OrganizationSyncAction = OrganizationSyncItemRow['action']
type OrganizationSyncItemCreate = Parameters<
  Prisma8Service['client']['orm']['public']['OrganizationSyncItems']['createAll']
>[0][number]
type Prisma8Transaction = Parameters<
  Parameters<Prisma8Service['client']['transaction']>[0]
>[0]

type ProviderSyncContext =
  | {
      provider: 'WECOM'
      integration: EnterpriseIntegrationRow
      credentials: WeComConnectionInput
    }
  | {
      provider: 'DINGTALK'
      integration: EnterpriseIntegrationRow
      credentials: DingTalkConnectionInput
    }
  | {
      provider: 'LARK'
      integration: EnterpriseIntegrationRow
      credentials: LarkConnectionInput
    }

const EMPTY_COUNTS: OrganizationSyncCounts = {
  create: 0,
  update: 0,
  disable: 0,
  unchanged: 0,
  conflict: 0,
  skip: 0,
  failed: 0,
}

@Injectable()
export class OrganizationSyncService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly weComClient: WeComClient,
    private readonly planner: OrganizationSyncPlanner,
    @Optional() private readonly coordination?: OrganizationSyncCoordinationService,
    @Optional() private readonly dingTalkClient?: DingTalkClient,
    @Optional() private readonly larkClient?: LarkClient,
  ) {}

  async gate(
    tenantId: string,
    provider: OrganizationSyncProvider = 'WECOM',
  ): Promise<OrganizationSyncGateVO> {
    const runtime = await this.coordination?.runtimeStatus(tenantId, provider)
    const integration =
      provider === 'DINGTALK'
        ? await this.integrations.getDingTalk(tenantId)
        : provider === 'LARK'
          ? await this.integrations.getLark(tenantId)
          : await this.integrations.getWeCom(tenantId)
    const activePlatform = await this.integrations.getActivePlatform(tenantId)
    const providerName = this.providerName(provider)
    let active: OrganizationSyncBatchRow | null = null
    let latest: OrganizationSyncBatchRow | null = null

    if (runtime?.batchId) {
      const runtimeBatch = await this.prisma8.client.orm.public.OrganizationSyncBatches.where({
        id: runtime.batchId,
        tenantId,
        provider,
      }).first()
      if (
        runtimeBatch &&
        (runtimeBatch.status === 'FETCHING' || runtimeBatch.status === 'APPLYING')
      ) {
        active = runtimeBatch
        latest = runtimeBatch
      }
    }
    if (!latest && runtime) {
      latest = await this.prisma8.client.orm.public.OrganizationSyncBatches.where({ tenantId, provider })
        .orderBy((row) => row.createdAt.desc())
        .first()
    }
    if (!runtime) {
      ;[active, latest] = await Promise.all([
        this.prisma8.client.orm.public.OrganizationSyncBatches.where({ tenantId, provider })
          .where((row) => row.status.in(['FETCHING', 'APPLYING']))
          .orderBy((row) => row.createdAt.desc())
          .first(),
        this.prisma8.client.orm.public.OrganizationSyncBatches.where({ tenantId, provider })
          .orderBy((row) => row.createdAt.desc())
          .first(),
      ])
    }

    const runningPhase = runtime?.phase ?? active?.status
    const disabledReason =
      activePlatform.syncResource !== provider
        ? `当前企业协同平台为${this.providerName(activePlatform.syncResource)}，请先在企业设置中切换平台`
        : !integration.configured
          ? `请先配置${providerName}`
          : integration.lastTestSucceeded !== true
            ? `请先完成${providerName}连接测试`
            : !integration.syncEnabled
              ? '请先在企业设置中开启同步组织架构'
              : !integration.syncDefaultRoleId
                ? '请选择新成员默认角色'
                : runningPhase === 'FETCHING'
                  ? `正在获取${providerName}组织数据`
                  : runningPhase === 'APPLYING'
                    ? '正在应用组织同步'
                    : null
    return {
      configured: integration.configured,
      verified: integration.lastTestSucceeded === true,
      enabled: integration.syncEnabled,
      defaultRoleId: integration.syncDefaultRoleId,
      disabledReason,
      activeBatch: active ? this.toBatchVO(active) : null,
      latestBatch: latest ? this.toBatchVO(latest) : null,
    }
  }

  async createPreview(
    user: AuthUser,
    dto: CreateOrganizationSyncPreviewDto,
    provider: OrganizationSyncProvider = 'WECOM',
  ): Promise<OrganizationSyncBatchVO> {
    if (!this.coordination) return this.createPreviewCore(user, dto, undefined, provider)
    const result = await this.coordination.run(
      user.tenantId,
      user.id,
      'FETCHING',
      null,
      (runtime) => this.createPreviewCore(user, dto, runtime, provider),
      provider,
    )
    if (!result.executed) throw new ConflictException('当前正在执行组织同步任务')
    return result.value
  }

  private async createPreviewCore(
    user: AuthUser,
    dto: CreateOrganizationSyncPreviewDto,
    runtime?: { setBatchId(batchId: string): Promise<void> },
    provider: OrganizationSyncProvider = 'WECOM',
  ): Promise<OrganizationSyncBatchVO> {
    const context = await this.getProviderSyncContext(user.tenantId, provider)
    const { integration } = context
    await this.assertDefaultRole(user.tenantId, integration.syncDefaultRoleId)
    const targetDepartment = await this.prisma8.client.orm.public.Departments.where({
      id: dto.targetDepartmentId,
      tenantId: user.tenantId,
    })
      .select('id')
      .first()
    if (!targetDepartment) throw new BadRequestException('同步目标部门不存在或不属于当前企业')
    const staleBefore = new Date(Date.now() - 30 * 60_000)
    const staleNow = prisma8Now()
    await this.prisma8.client.orm.public.OrganizationSyncBatches.where({
      tenantId: user.tenantId,
      provider,
      status: 'FETCHING',
    })
      .where((row) => row.updatedAt.lt(prisma8TimestampFromDate(staleBefore)))
      .updateAndCount({
        status: 'FAILED',
        errorCode: 'FETCH_TIMEOUT',
        errorMessage: '同步预览获取超时，请重新生成',
        finishedAt: staleNow,
        updatedAt: staleNow,
      })
    const invalidatedAt = prisma8Now()
    await this.prisma8.client.orm.public.OrganizationSyncBatches.where({
      tenantId: user.tenantId,
      provider,
      status: 'PREVIEW_READY',
    }).updateAndCount({
        status: 'INVALIDATED',
        errorCode: 'NEW_PREVIEW_CREATED',
        errorMessage: '已生成新的同步预览',
        finishedAt: invalidatedAt,
        updatedAt: invalidatedAt,
      })

    let batch: OrganizationSyncBatchRow
    try {
      const now = prisma8Now()
      batch = await this.prisma8.client.orm.public.OrganizationSyncBatches.create({
          tenantId: user.tenantId,
          integrationId: integration.id,
          provider,
          status: 'FETCHING',
          targetDepartmentId: targetDepartment.id,
          credentialVersion: integration.credentialVersion,
          counts: prisma8JsonValue(EMPTY_COUNTS),
          createdById: user.id,
          fetchStartedAt: now,
          updatedAt: now,
      })
    } catch (error) {
      if ((error as { sqlState?: string }).sqlState === '23505') {
        throw new ConflictException('当前正在执行组织同步任务')
      }
      throw error
    }
    await runtime?.setBatchId(batch.id)

    try {
      const snapshot = await this.getProviderSnapshot(context)
      const [departments, users, departmentMappings, userMappings] = await Promise.all([
        this.prisma8.client.orm.public.Departments.where({ tenantId: user.tenantId }).all(),
        this.prisma8.client.orm.public.Users.where({ tenantId: user.tenantId }).all(),
        this.prisma8.client.orm.public.ExternalDepartmentMappings.where({
          tenantId: user.tenantId,
          provider,
        }).all(),
        this.prisma8.client.orm.public.ExternalUserMappings.where({
          tenantId: user.tenantId,
          provider,
        }).all(),
      ])
      const snapshotRoot = snapshot.departments.find((department) => department.isRoot)!
      this.assertTargetOutsideMappedTree(
        targetDepartment.id,
        snapshotRoot.externalKey,
        departments,
        departmentMappings,
        provider,
      )
      const plan = this.planner.plan({
        tenantId: user.tenantId,
        targetDepartmentId: targetDepartment.id,
        snapshot,
        departments,
        users,
        departmentMappings,
        userMappings,
      })

      const current = await this.prisma8.client.orm.public.EnterpriseIntegrations.where({
        id: integration.id,
        tenantId: user.tenantId,
      })
        .select('credentialVersion', 'syncEnabled')
        .first()
      if (
        !current ||
        !current.syncEnabled ||
        current.credentialVersion !== integration.credentialVersion
      ) {
        const now = prisma8Now()
        const invalidated = await this.prisma8.client.orm.public.OrganizationSyncBatches.where({
          id: batch.id,
        }).update({
            status: 'INVALIDATED',
            errorCode: 'CREDENTIALS_CHANGED',
            errorMessage: `${this.providerName(provider)}配置已变化，请重新生成同步预览`,
            finishedAt: now,
            updatedAt: now,
        })
        if (!invalidated) throw new NotFoundException('同步批次不存在')
        return this.toBatchVO(invalidated)
      }

      batch = await this.prisma8.client.transaction(async (tx) => {
        if (plan.items.length) {
          await tx.orm.public.OrganizationSyncItems.createAll(
            plan.items.map((item) => this.toItemCreate(user.tenantId, batch.id, item)),
          )
        }
        const now = prisma8Now()
        const updated = await tx.orm.public.OrganizationSyncBatches.where({ id: batch.id }).update({
            status: 'PREVIEW_READY',
            counts: prisma8JsonValue(plan.counts),
            previewedAt: now,
            errorCode: null,
            errorMessage: null,
            updatedAt: now,
        })
        if (!updated) throw new NotFoundException('同步批次不存在')
        return updated
      })
      return this.toBatchVO(batch)
    } catch (error) {
      const code = error instanceof OrganizationSnapshotError ? error.code : 'PREVIEW_FAILED'
      const message =
        error instanceof OrganizationSnapshotError
          ? error.message.slice(0, 500)
          : '生成组织同步预览失败，请稍后重试'
      const now = prisma8Now()
      await this.prisma8.client.orm.public.OrganizationSyncBatches.where({
        id: batch.id,
        tenantId: user.tenantId,
        status: 'FETCHING',
      }).updateAndCount({
        status: 'FAILED',
        errorCode: code,
        errorMessage: message,
        finishedAt: now,
        updatedAt: now,
      })
      throw new ServiceUnavailableException(message)
    }
  }

  async batches(
    tenantId: string,
    query: QueryOrganizationSyncBatchesDto,
    provider: OrganizationSyncProvider = 'WECOM',
  ): Promise<PaginatedResult<OrganizationSyncBatchVO>> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 10
    let batches = this.prisma8.client.orm.public.OrganizationSyncBatches.where({ tenantId, provider })
    if (query.status) batches = batches.where({ status: query.status })
    const [items, aggregate] = await Promise.all([
      batches
        .orderBy((row) => row.createdAt.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      batches.aggregate((agg) => ({ count: agg.count() })),
    ])
    return { items: items.map((item) => this.toBatchVO(item)), total: aggregate.count, page, pageSize }
  }

  async batch(
    tenantId: string,
    id: string,
    provider: OrganizationSyncProvider = 'WECOM',
  ): Promise<OrganizationSyncBatchVO> {
    return this.toBatchVO(await this.ensureBatch(tenantId, id, provider))
  }

  async items(
    tenantId: string,
    batchId: string,
    query: QueryOrganizationSyncItemsDto,
    provider: OrganizationSyncProvider = 'WECOM',
  ): Promise<PaginatedResult<OrganizationSyncItemVO>> {
    await this.ensureBatch(tenantId, batchId, provider)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 10
    const keyword = query.keyword?.trim()
    let items: OrganizationSyncItemRow[]
    let total: number
    if (keyword) {
      const result = await this.keywordItems(
        tenantId,
        batchId,
        query.resourceType ?? null,
        query.action ?? null,
        keyword,
        page,
        pageSize,
      )
      total = result.total
      if (result.ids.length === 0) {
        items = []
      } else {
        const rows = await this.prisma8.client.orm.public.OrganizationSyncItems.where((row) =>
          row.id.in(result.ids),
        ).all()
        const rowMap = new Map(rows.map((row) => [row.id, row]))
        items = result.ids.flatMap((id) => {
          const row = rowMap.get(id)
          return row ? [row] : []
        })
      }
    } else {
      let collection = this.prisma8.client.orm.public.OrganizationSyncItems.where({ tenantId, batchId })
      if (query.resourceType) collection = collection.where({ resourceType: query.resourceType })
      if (query.action) collection = collection.where({ action: query.action })
      const [rows, aggregate] = await Promise.all([
        collection
          .orderBy([(row) => row.sort.asc(), (row) => row.createdAt.asc()])
          .offset((page - 1) * pageSize)
          .limit(pageSize)
          .all(),
        collection.aggregate((agg) => ({ count: agg.count() })),
      ])
      items = rows
      total = aggregate.count
    }
    return { items: items.map((item) => this.toItemVO(item)), total, page, pageSize }
  }

  async resolve(
    user: AuthUser,
    batchId: string,
    dto: ResolveOrganizationSyncDto,
    provider: OrganizationSyncProvider = 'WECOM',
  ): Promise<OrganizationSyncBatchVO> {
    const batch = await this.ensureBatch(user.tenantId, batchId, provider)
    if (batch.status !== 'PREVIEW_READY') throw new BadRequestException('当前批次不能处理冲突')
    const ids = [...new Set(dto.items.map(({ itemId }) => itemId))]
    if (ids.length !== dto.items.length) throw new BadRequestException('冲突项不能重复提交')
    const rows = await this.prisma8.client.orm.public.OrganizationSyncItems.where({
      tenantId: user.tenantId,
      batchId,
      action: 'CONFLICT',
    })
      .where((row) => row.id.in(ids))
      .all()
    if (rows.length !== ids.length) throw new BadRequestException('冲突项不存在或已处理')
    const rowMap = new Map(rows.map((row) => [row.id, row]))

    await this.prisma8.client.transaction(async (tx) => {
      const skippedDepartmentKeys = new Set<string>()
      for (const input of dto.items) {
        const row = rowMap.get(input.itemId)!
        if (input.resolution === 'BIND') {
          if (!input.localId) throw new BadRequestException('绑定现有资源时必须选择目标')
          await this.assertBindingAvailable(tx, user.tenantId, row, input.localId, provider)
        }
        const now = prisma8Now()
        await tx.orm.public.OrganizationSyncItems.where({ id: row.id }).update({
            resolution: input.resolution,
            resolvedLocalId: input.resolution === 'BIND' ? input.localId : null,
            localId: input.resolution === 'BIND' ? input.localId : row.localId,
            action: input.resolution === 'BIND' ? 'UPDATE' : 'SKIP',
            result: 'RESOLVED',
            updatedAt: now,
        })
        if (row.resourceType === 'DEPARTMENT' && input.resolution === 'SKIP') {
          skippedDepartmentKeys.add(row.externalKey)
        }
      }
      if (skippedDepartmentKeys.size) {
        const departmentItems = await tx.orm.public.OrganizationSyncItems.where({
          tenantId: user.tenantId,
          batchId,
          resourceType: 'DEPARTMENT',
        })
          .select('externalKey', 'parentExternalKey')
          .all()
        let changed = true
        while (changed) {
          changed = false
          for (const item of departmentItems) {
            if (
              item.parentExternalKey &&
              skippedDepartmentKeys.has(item.parentExternalKey) &&
              !skippedDepartmentKeys.has(item.externalKey)
            ) {
              skippedDepartmentKeys.add(item.externalKey)
              changed = true
            }
          }
        }
        const now = prisma8Now()
        const skipped = [...skippedDepartmentKeys]
        const resolved = {
          action: 'SKIP' as const,
          result: 'RESOLVED' as const,
          resolution: 'SKIP' as const,
          resolvedLocalId: null,
          updatedAt: now,
        }
        await tx.orm.public.OrganizationSyncItems.where({
          tenantId: user.tenantId,
          batchId,
          resourceType: 'DEPARTMENT',
        })
          .where((row) => row.externalKey.in(skipped))
          .updateAndCount(resolved)
        await tx.orm.public.OrganizationSyncItems.where({
          tenantId: user.tenantId,
          batchId,
          resourceType: 'USER',
        })
          .where((row) => row.parentExternalKey.in(skipped))
          .updateAndCount(resolved)
      }
      const allItems = await tx.orm.public.OrganizationSyncItems.where({
        tenantId: user.tenantId,
        batchId,
      })
        .select('action')
        .all()
      await tx.orm.public.OrganizationSyncBatches.where({ id: batchId }).update({
        counts: prisma8JsonValue(this.countRows(allItems.map((row) => row.action))),
        updatedAt: prisma8Now(),
      })
    })
    return this.batch(user.tenantId, batchId, provider)
  }

  private async keywordItems(
    tenantId: string,
    batchId: string,
    resourceType: NonNullable<QueryOrganizationSyncItemsDto['resourceType']> | null,
    action: NonNullable<QueryOrganizationSyncItemsDto['action']> | null,
    keyword: string,
    page: number,
    pageSize: number,
  ): Promise<{ ids: string[]; total: number }> {
    const pattern = `%${keyword}%`
    const resourceTypeFilter = resourceType ?? ''
    const actionFilter = action ?? ''
    const offset = (page - 1) * pageSize
    const pageQuery = this.prisma8.client.raw.sql`
      SELECT id
      FROM organization_sync_items
      WHERE "tenantId" = ${tenantId}
        AND "batchId" = ${batchId}
        AND (${resourceTypeFilter} = '' OR "resourceType"::text = ${resourceTypeFilter})
        AND (${actionFilter} = '' OR "action"::text = ${actionFilter})
        AND (
          "externalId" ILIKE ${pattern}
          OR COALESCE("conflictMessage", '') ILIKE ${pattern}
          OR COALESCE("sourceData" ->> 'name', '') ILIKE ${pattern}
        )
      ORDER BY sort ASC, "createdAt" ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `.returnsRow({ id: 'pg/text@1' })
    const countQuery = this.prisma8.client.raw.sql`
      SELECT COUNT(*)::int4 AS total
      FROM organization_sync_items
      WHERE "tenantId" = ${tenantId}
        AND "batchId" = ${batchId}
        AND (${resourceTypeFilter} = '' OR "resourceType"::text = ${resourceTypeFilter})
        AND (${actionFilter} = '' OR "action"::text = ${actionFilter})
        AND (
          "externalId" ILIKE ${pattern}
          OR COALESCE("conflictMessage", '') ILIKE ${pattern}
          OR COALESCE("sourceData" ->> 'name', '') ILIKE ${pattern}
        )
    `.returnsRow({ total: 'pg/int4@1' })
    const ids: string[] = []
    for await (const row of this.prisma8.client.runtime().query(pageQuery.build())) ids.push(row.id)
    let total = 0
    for await (const row of this.prisma8.client.runtime().query(countQuery.build())) total = row.total
    return { ids, total }
  }

  private async assertBindingAvailable(
    tx: Prisma8Transaction,
    tenantId: string,
    item: OrganizationSyncItemRow,
    localId: string,
    provider: OrganizationSyncProvider,
  ): Promise<void> {
    if (item.resourceType === 'DEPARTMENT') {
      const [local, occupied] = await Promise.all([
        tx.orm.public.Departments.where({ id: localId, tenantId }).select('id').first(),
        tx.orm.public.ExternalDepartmentMappings.where({ tenantId, provider, departmentId: localId })
          .where((row) => row.externalKey.neq(item.externalKey))
          .select('id')
          .first(),
      ])
      if (!local) throw new BadRequestException('绑定部门不存在或不属于当前企业')
      if (occupied)
        throw new ConflictException(`该部门已绑定其他${this.providerName(provider)}部门`)
      return
    }
    const [local, occupied] = await Promise.all([
      tx.orm.public.Users.where({ id: localId, tenantId }).select('id').first(),
      tx.orm.public.ExternalUserMappings.where({ tenantId, provider, userId: localId })
        .where((row) => row.externalKey.neq(item.externalKey))
        .select('id')
        .first(),
    ])
    if (!local) throw new BadRequestException('绑定成员不存在或不属于当前企业')
    if (occupied) throw new ConflictException(`该成员已绑定其他${this.providerName(provider)}成员`)
  }

  private async assertDefaultRole(tenantId: string, roleId: string | null): Promise<void> {
    if (!roleId) throw new BadRequestException('请选择新成员默认角色')
    const role = await this.prisma8.client.orm.public.Roles.where({ id: roleId, tenantId })
      .select('id')
      .first()
    if (!role) throw new BadRequestException('默认角色不存在或不属于当前企业')
  }

  private assertTargetOutsideMappedTree(
    targetDepartmentId: string,
    rootExternalKey: string,
    departments: Array<{ id: string; parentId: string | null }>,
    mappings: Array<{ externalKey: string; departmentId: string }>,
    provider: OrganizationSyncProvider,
  ): void {
    const mappedRootId = mappings.find(
      (mapping) => mapping.externalKey === rootExternalKey,
    )?.departmentId
    if (!mappedRootId) return
    const parentById = new Map(
      departments.map((department) => [department.id, department.parentId]),
    )
    let cursor: string | null | undefined = targetDepartmentId
    while (cursor) {
      if (cursor === mappedRootId) {
        throw new OrganizationSnapshotError(
          'INVALID_TARGET_DEPARTMENT',
          `同步目标不能选择已同步${this.providerName(provider)}根部门或其下级部门`,
        )
      }
      cursor = parentById.get(cursor)
    }
  }

  private async ensureBatch(
    tenantId: string,
    id: string,
    provider: OrganizationSyncProvider,
  ): Promise<OrganizationSyncBatchRow> {
    const row = await this.prisma8.client.orm.public.OrganizationSyncBatches.where({
      id,
      tenantId,
      provider,
    }).first()
    if (!row) throw new NotFoundException('同步批次不存在')
    return row
  }

  private async getProviderSyncContext(
    tenantId: string,
    provider: OrganizationSyncProvider,
  ): Promise<ProviderSyncContext> {
    if (provider === 'DINGTALK') {
      const context = await this.integrations.getDingTalkSyncContext(tenantId)
      return { provider, integration: context.integration, credentials: context.credentials }
    }
    if (provider === 'LARK') {
      const context = await this.integrations.getLarkSyncContext(tenantId)
      return { provider, integration: context.integration, credentials: context.credentials }
    }
    const context = await this.integrations.getWeComSyncContext(tenantId)
    return { provider, integration: context.integration, credentials: context.credentials }
  }

  private async getProviderSnapshot(context: ProviderSyncContext): Promise<OrganizationSnapshot> {
    if (context.provider === 'DINGTALK') {
      if (!this.dingTalkClient) throw new BadRequestException('钉钉 Provider 未加载')
      return this.dingTalkClient.getOrganizationSnapshot(context.credentials)
    }
    if (context.provider === 'LARK') {
      if (!this.larkClient) throw new BadRequestException('飞书 Provider 未加载')
      return this.larkClient.getOrganizationSnapshot(context.credentials)
    }
    return this.weComClient.getOrganizationSnapshot(context.credentials)
  }

  private providerName(provider: OrganizationSyncProvider): string {
    return provider === 'DINGTALK' ? '钉钉' : provider === 'LARK' ? '飞书' : '企业微信'
  }

  private toItemCreate(
    tenantId: string,
    batchId: string,
    item: OrganizationSyncPlanItem,
  ): OrganizationSyncItemCreate {
    const now = prisma8Now()
    return {
      tenantId,
      batchId,
      resourceType: item.resourceType,
      externalId: item.externalId,
      externalKey: item.externalKey,
      action: item.action,
      localId: item.localId,
      parentExternalKey: item.parentExternalKey,
      sourceData: prisma8JsonValue(item.sourceData),
      changes: item.changes === undefined ? null : prisma8JsonValue(item.changes),
      conflictType: item.conflictType,
      conflictMessage: item.conflictMessage,
      sort: item.sort,
      updatedAt: now,
    }
  }

  private countRows(actions: OrganizationSyncAction[]): OrganizationSyncCounts {
    const counts = { ...EMPTY_COUNTS }
    for (const action of actions) counts[action.toLowerCase() as keyof OrganizationSyncCounts]++
    return counts
  }

  private toBatchVO(row: OrganizationSyncBatchRow): OrganizationSyncBatchVO {
    return {
      id: row.id,
      provider: row.provider,
      status: row.status,
      targetDepartmentId: row.targetDepartmentId,
      credentialVersion: row.credentialVersion,
      counts: this.parseCounts(row.counts),
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdById: row.createdById,
      appliedById: row.appliedById,
      fetchStartedAt: row.fetchStartedAt ? prisma8TimestampToISOString(row.fetchStartedAt) : null,
      previewedAt: row.previewedAt ? prisma8TimestampToISOString(row.previewedAt) : null,
      applyStartedAt: row.applyStartedAt ? prisma8TimestampToISOString(row.applyStartedAt) : null,
      finishedAt: row.finishedAt ? prisma8TimestampToISOString(row.finishedAt) : null,
      createdAt: prisma8TimestampToISOString(row.createdAt),
      updatedAt: prisma8TimestampToISOString(row.updatedAt),
    }
  }

  private toItemVO(row: OrganizationSyncItemRow): OrganizationSyncItemVO {
    return {
      id: row.id,
      resourceType: row.resourceType,
      externalId: row.externalId,
      action: row.action,
      result: row.result,
      localId: row.localId,
      sourceData: this.jsonObject(row.sourceData),
      changes: row.changes
        ? (this.jsonObject(row.changes) as Record<string, { before: unknown; after: unknown }>)
        : null,
      conflictType: row.conflictType,
      conflictMessage: row.conflictMessage,
      resolution: row.resolution,
      resolvedLocalId: row.resolvedLocalId,
      errorMessage: row.errorMessage,
    }
  }

  private parseCounts(value: unknown): OrganizationSyncCounts {
    const data = this.jsonObject(value)
    return {
      create: this.safeCount(data['create']),
      update: this.safeCount(data['update']),
      disable: this.safeCount(data['disable']),
      unchanged: this.safeCount(data['unchanged']),
      conflict: this.safeCount(data['conflict']),
      skip: this.safeCount(data['skip']),
      failed: this.safeCount(data['failed']),
    }
  }

  private jsonObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private safeCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
}
