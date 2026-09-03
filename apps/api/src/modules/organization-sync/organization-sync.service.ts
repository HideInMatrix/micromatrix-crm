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
import {
  type OrganizationSyncBatch,
  type OrganizationSyncItem,
  Prisma,
} from '../../generated/prisma/client'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import { WeComClient, WeComSnapshotError } from '../enterprise-integrations/wecom.client'
import type {
  CreateOrganizationSyncPreviewDto,
  QueryOrganizationSyncBatchesDto,
  QueryOrganizationSyncItemsDto,
  ResolveOrganizationSyncDto,
} from './dto/organization-sync.dto'
import { OrganizationSyncCoordinationService } from './organization-sync-coordination.service'
import { OrganizationSyncPlanner, type OrganizationSyncPlanItem } from './organization-sync.planner'

const PROVIDER = 'WECOM' as const
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
    private readonly prisma: PrismaService,
    private readonly integrations: EnterpriseIntegrationsService,
    private readonly weComClient: WeComClient,
    private readonly planner: OrganizationSyncPlanner,
    @Optional() private readonly coordination?: OrganizationSyncCoordinationService,
  ) {}

  async gate(tenantId: string): Promise<OrganizationSyncGateVO> {
    const runtime = await this.coordination?.runtimeStatus(tenantId)
    const integration = await this.integrations.getWeCom(tenantId)
    let active: OrganizationSyncBatch | null = null
    let latest: OrganizationSyncBatch | null = null

    if (runtime?.batchId) {
      const runtimeBatch = await this.prisma.organizationSyncBatch.findFirst({
        where: { id: runtime.batchId, tenantId, provider: PROVIDER },
      })
      if (runtimeBatch && (runtimeBatch.status === 'FETCHING' || runtimeBatch.status === 'APPLYING')) {
        active = runtimeBatch
        latest = runtimeBatch
      }
    }
    if (!latest && runtime) {
      latest = await this.prisma.organizationSyncBatch.findFirst({
        where: { tenantId, provider: PROVIDER },
        orderBy: { createdAt: 'desc' },
      })
    }
    if (!runtime) {
      ;[active, latest] = await Promise.all([
        this.prisma.organizationSyncBatch.findFirst({
          where: { tenantId, provider: PROVIDER, status: { in: ['FETCHING', 'APPLYING'] } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.organizationSyncBatch.findFirst({
          where: { tenantId, provider: PROVIDER },
          orderBy: { createdAt: 'desc' },
        }),
      ])
    }

    const runningPhase = runtime?.phase ?? active?.status
    const disabledReason = !integration.configured
      ? '请先配置企业微信'
      : integration.lastTestSucceeded !== true
        ? '请先完成企业微信连接测试'
        : !integration.syncEnabled
          ? '请先在企业设置中开启同步组织架构'
          : !integration.syncDefaultRoleId
            ? '请选择新成员默认角色'
            : runningPhase === 'FETCHING'
              ? '正在获取企业微信组织数据'
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
  ): Promise<OrganizationSyncBatchVO> {
    if (!this.coordination) return this.createPreviewCore(user, dto)
    const result = await this.coordination.run(
      user.tenantId,
      user.id,
      'FETCHING',
      null,
      (runtime) => this.createPreviewCore(user, dto, runtime),
    )
    if (!result.executed) throw new ConflictException('当前正在执行组织同步任务')
    return result.value
  }

  private async createPreviewCore(
    user: AuthUser,
    dto: CreateOrganizationSyncPreviewDto,
    runtime?: { setBatchId(batchId: string): Promise<void> },
  ): Promise<OrganizationSyncBatchVO> {
    const { integration, credentials } = await this.integrations.getWeComSyncContext(user.tenantId)
    await this.assertDefaultRole(user.tenantId, integration.syncDefaultRoleId)
    const targetDepartment = await this.prisma.department.findFirst({
      where: { id: dto.targetDepartmentId, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!targetDepartment) throw new BadRequestException('同步目标部门不存在或不属于当前企业')
    const staleBefore = new Date(Date.now() - 30 * 60_000)
    await this.prisma.organizationSyncBatch.updateMany({
      where: {
        tenantId: user.tenantId,
        provider: PROVIDER,
        status: 'FETCHING',
        updatedAt: { lt: staleBefore },
      },
      data: {
        status: 'FAILED',
        errorCode: 'FETCH_TIMEOUT',
        errorMessage: '同步预览获取超时，请重新生成',
        finishedAt: new Date(),
      },
    })
    await this.prisma.organizationSyncBatch.updateMany({
      where: { tenantId: user.tenantId, provider: PROVIDER, status: 'PREVIEW_READY' },
      data: {
        status: 'INVALIDATED',
        errorCode: 'NEW_PREVIEW_CREATED',
        errorMessage: '已生成新的同步预览',
        finishedAt: new Date(),
      },
    })

    let batch: OrganizationSyncBatch
    try {
      batch = await this.prisma.organizationSyncBatch.create({
        data: {
          tenantId: user.tenantId,
          integrationId: integration.id,
          provider: PROVIDER,
          status: 'FETCHING',
          targetDepartmentId: targetDepartment.id,
          credentialVersion: integration.credentialVersion,
          counts: EMPTY_COUNTS as unknown as Prisma.InputJsonValue,
          createdById: user.id,
          fetchStartedAt: new Date(),
        },
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('当前正在执行组织同步任务')
      }
      throw error
    }
    await runtime?.setBatchId(batch.id)

    try {
      const snapshot = await this.weComClient.getOrganizationSnapshot(credentials)
      const [departments, users, departmentMappings, userMappings] = await Promise.all([
        this.prisma.department.findMany({ where: { tenantId: user.tenantId } }),
        this.prisma.user.findMany({ where: { tenantId: user.tenantId } }),
        this.prisma.externalDepartmentMapping.findMany({
          where: { tenantId: user.tenantId, provider: PROVIDER },
        }),
        this.prisma.externalUserMapping.findMany({
          where: { tenantId: user.tenantId, provider: PROVIDER },
        }),
      ])
      const snapshotRoot = snapshot.departments.find((department) => department.isRoot)!
      this.assertTargetOutsideMappedTree(
        targetDepartment.id,
        snapshotRoot.externalKey,
        departments,
        departmentMappings,
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

      const current = await this.prisma.enterpriseIntegration.findFirst({
        where: { id: integration.id, tenantId: user.tenantId },
        select: { credentialVersion: true, syncEnabled: true },
      })
      if (
        !current ||
        !current.syncEnabled ||
        current.credentialVersion !== integration.credentialVersion
      ) {
        const invalidated = await this.prisma.organizationSyncBatch.update({
          where: { id: batch.id },
          data: {
            status: 'INVALIDATED',
            errorCode: 'CREDENTIALS_CHANGED',
            errorMessage: '企业微信配置已变化，请重新生成同步预览',
            finishedAt: new Date(),
          },
        })
        return this.toBatchVO(invalidated)
      }

      batch = await this.prisma.$transaction(async (tx) => {
        if (plan.items.length) {
          await tx.organizationSyncItem.createMany({
            data: plan.items.map((item) => this.toItemCreate(user.tenantId, batch.id, item)),
          })
        }
        return tx.organizationSyncBatch.update({
          where: { id: batch.id },
          data: {
            status: 'PREVIEW_READY',
            counts: plan.counts as unknown as Prisma.InputJsonValue,
            previewedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        })
      })
      return this.toBatchVO(batch)
    } catch (error) {
      const code = error instanceof WeComSnapshotError ? error.code : 'PREVIEW_FAILED'
      const message =
        error instanceof WeComSnapshotError
          ? error.message.slice(0, 500)
          : '生成组织同步预览失败，请稍后重试'
      await this.prisma.organizationSyncBatch.updateMany({
        where: { id: batch.id, tenantId: user.tenantId, status: 'FETCHING' },
        data: { status: 'FAILED', errorCode: code, errorMessage: message, finishedAt: new Date() },
      })
      throw new ServiceUnavailableException(message)
    }
  }

  async batches(
    tenantId: string,
    query: QueryOrganizationSyncBatchesDto,
  ): Promise<PaginatedResult<OrganizationSyncBatchVO>> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 10
    const where = {
      tenantId,
      provider: PROVIDER,
      ...(query.status ? { status: query.status } : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.organizationSyncBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.organizationSyncBatch.count({ where }),
    ])
    return { items: items.map((item) => this.toBatchVO(item)), total, page, pageSize }
  }

  async batch(tenantId: string, id: string): Promise<OrganizationSyncBatchVO> {
    return this.toBatchVO(await this.ensureBatch(tenantId, id))
  }

  async items(
    tenantId: string,
    batchId: string,
    query: QueryOrganizationSyncItemsDto,
  ): Promise<PaginatedResult<OrganizationSyncItemVO>> {
    await this.ensureBatch(tenantId, batchId)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 10
    const keyword = query.keyword?.trim()
    const where = {
      tenantId,
      batchId,
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(keyword
        ? {
            OR: [
              { externalId: { contains: keyword, mode: 'insensitive' as const } },
              { conflictMessage: { contains: keyword, mode: 'insensitive' as const } },
              { sourceData: { path: ['name'], string_contains: keyword } },
            ],
          }
        : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.organizationSyncItem.findMany({
        where,
        orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.organizationSyncItem.count({ where }),
    ])
    return { items: items.map((item) => this.toItemVO(item)), total, page, pageSize }
  }

  async resolve(
    user: AuthUser,
    batchId: string,
    dto: ResolveOrganizationSyncDto,
  ): Promise<OrganizationSyncBatchVO> {
    const batch = await this.ensureBatch(user.tenantId, batchId)
    if (batch.status !== 'PREVIEW_READY') throw new BadRequestException('当前批次不能处理冲突')
    const ids = [...new Set(dto.items.map(({ itemId }) => itemId))]
    if (ids.length !== dto.items.length) throw new BadRequestException('冲突项不能重复提交')
    const rows = await this.prisma.organizationSyncItem.findMany({
      where: { tenantId: user.tenantId, batchId, id: { in: ids }, action: 'CONFLICT' },
    })
    if (rows.length !== ids.length) throw new BadRequestException('冲突项不存在或已处理')
    const rowMap = new Map(rows.map((row) => [row.id, row]))

    await this.prisma.$transaction(async (tx) => {
      const skippedDepartmentKeys = new Set<string>()
      for (const input of dto.items) {
        const row = rowMap.get(input.itemId)!
        if (input.resolution === 'BIND') {
          if (!input.localId) throw new BadRequestException('绑定现有资源时必须选择目标')
          await this.assertBindingAvailable(tx, user.tenantId, row, input.localId)
        }
        await tx.organizationSyncItem.update({
          where: { id: row.id },
          data: {
            resolution: input.resolution,
            resolvedLocalId: input.resolution === 'BIND' ? input.localId : null,
            localId: input.resolution === 'BIND' ? input.localId : row.localId,
            action: input.resolution === 'BIND' ? 'UPDATE' : 'SKIP',
            result: 'RESOLVED',
          },
        })
        if (row.resourceType === 'DEPARTMENT' && input.resolution === 'SKIP') {
          skippedDepartmentKeys.add(row.externalKey)
        }
      }
      if (skippedDepartmentKeys.size) {
        const departmentItems = await tx.organizationSyncItem.findMany({
          where: { tenantId: user.tenantId, batchId, resourceType: 'DEPARTMENT' },
          select: { externalKey: true, parentExternalKey: true },
        })
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
        await tx.organizationSyncItem.updateMany({
          where: {
            tenantId: user.tenantId,
            batchId,
            OR: [
              { resourceType: 'DEPARTMENT', externalKey: { in: [...skippedDepartmentKeys] } },
              { resourceType: 'USER', parentExternalKey: { in: [...skippedDepartmentKeys] } },
            ],
          },
          data: {
            action: 'SKIP',
            result: 'RESOLVED',
            resolution: 'SKIP',
            resolvedLocalId: null,
          },
        })
      }
      const allItems = await tx.organizationSyncItem.findMany({
        where: { tenantId: user.tenantId, batchId },
      })
      await tx.organizationSyncBatch.update({
        where: { id: batchId },
        data: {
          counts: this.countRows(
            allItems.map((row) => row.action),
          ) as unknown as Prisma.InputJsonValue,
        },
      })
    })
    return this.batch(user.tenantId, batchId)
  }

  private async assertBindingAvailable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    item: OrganizationSyncItem,
    localId: string,
  ): Promise<void> {
    if (item.resourceType === 'DEPARTMENT') {
      const [local, occupied] = await Promise.all([
        tx.department.findFirst({ where: { id: localId, tenantId }, select: { id: true } }),
        tx.externalDepartmentMapping.findFirst({
          where: {
            tenantId,
            provider: PROVIDER,
            departmentId: localId,
            externalKey: { not: item.externalKey },
          },
          select: { id: true },
        }),
      ])
      if (!local) throw new BadRequestException('绑定部门不存在或不属于当前企业')
      if (occupied) throw new ConflictException('该部门已绑定其他企业微信部门')
      return
    }
    const [local, occupied] = await Promise.all([
      tx.user.findFirst({ where: { id: localId, tenantId }, select: { id: true } }),
      tx.externalUserMapping.findFirst({
        where: {
          tenantId,
          provider: PROVIDER,
          userId: localId,
          externalKey: { not: item.externalKey },
        },
        select: { id: true },
      }),
    ])
    if (!local) throw new BadRequestException('绑定成员不存在或不属于当前企业')
    if (occupied) throw new ConflictException('该成员已绑定其他企业微信成员')
  }

  private async assertDefaultRole(tenantId: string, roleId: string | null): Promise<void> {
    if (!roleId) throw new BadRequestException('请选择新成员默认角色')
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId },
      select: { id: true },
    })
    if (!role) throw new BadRequestException('默认角色不存在或不属于当前企业')
  }

  private assertTargetOutsideMappedTree(
    targetDepartmentId: string,
    rootExternalKey: string,
    departments: Array<{ id: string; parentId: string | null }>,
    mappings: Array<{ externalKey: string; departmentId: string }>,
  ): void {
    const mappedRootId = mappings.find(
      (mapping) => mapping.externalKey === rootExternalKey,
    )?.departmentId
    if (!mappedRootId) return
    const parentById = new Map(departments.map((department) => [department.id, department.parentId]))
    let cursor: string | null | undefined = targetDepartmentId
    while (cursor) {
      if (cursor === mappedRootId) {
        throw new WeComSnapshotError(
          'INVALID_TARGET_DEPARTMENT',
          '同步目标不能选择已同步企微根部门或其下级部门',
        )
      }
      cursor = parentById.get(cursor)
    }
  }

  private async ensureBatch(tenantId: string, id: string): Promise<OrganizationSyncBatch> {
    const row = await this.prisma.organizationSyncBatch.findFirst({
      where: { id, tenantId, provider: PROVIDER },
    })
    if (!row) throw new NotFoundException('同步批次不存在')
    return row
  }

  private toItemCreate(
    tenantId: string,
    batchId: string,
    item: OrganizationSyncPlanItem,
  ): Prisma.OrganizationSyncItemCreateManyInput {
    return {
      tenantId,
      batchId,
      resourceType: item.resourceType,
      externalId: item.externalId,
      externalKey: item.externalKey,
      action: item.action,
      localId: item.localId,
      parentExternalKey: item.parentExternalKey,
      sourceData: item.sourceData as Prisma.InputJsonValue,
      changes: item.changes as Prisma.InputJsonValue | undefined,
      conflictType: item.conflictType,
      conflictMessage: item.conflictMessage,
      sort: item.sort,
    }
  }

  private countRows(actions: OrganizationSyncItem['action'][]): OrganizationSyncCounts {
    const counts = { ...EMPTY_COUNTS }
    for (const action of actions) counts[action.toLowerCase() as keyof OrganizationSyncCounts]++
    return counts
  }

  private toBatchVO(row: OrganizationSyncBatch): OrganizationSyncBatchVO {
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
      fetchStartedAt: row.fetchStartedAt?.toISOString() ?? null,
      previewedAt: row.previewedAt?.toISOString() ?? null,
      applyStartedAt: row.applyStartedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private toItemVO(row: OrganizationSyncItem): OrganizationSyncItemVO {
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

  private parseCounts(value: Prisma.JsonValue): OrganizationSyncCounts {
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

  private jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private safeCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
}
