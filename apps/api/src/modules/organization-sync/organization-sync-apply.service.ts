import { randomBytes } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { AuthContextCacheService } from '../../common/services/auth-context-cache.service'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaClient } from '../../prisma/prisma-client.js'
import { nowInstant } from '../../prisma/temporal.js'
import { jsonValue } from '../../prisma/json-value.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { NotificationsService } from '../notifications/notifications.service'
import { OrganizationSyncCoordinationService } from './organization-sync-coordination.service'
import type { OrganizationSyncProvider } from './organization-sync.service'

type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

type OrganizationSyncResourceType = 'DEPARTMENT' | 'USER'
type OrganizationSyncAction = 'CREATE' | 'UPDATE' | 'DISABLE' | 'UNCHANGED' | 'CONFLICT' | 'SKIP'

type InitialSyncBatch = {
  status: string
  integrationId: string
}

type OrganizationSyncItemLike = {
  id: string
  resourceType: OrganizationSyncResourceType
  externalId: string
  externalKey: string
  action: OrganizationSyncAction
  localId: string | null
  parentExternalKey: string | null
  sourceData: unknown
  resolvedLocalId: string | null
}

@Injectable()
export class OrganizationSyncApplyService {
  private readonly logger = new Logger(OrganizationSyncApplyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly authCache?: AuthContextCacheService,
    @Optional() private readonly cache?: TenantDerivedCacheService,
    @Optional() private readonly coordination?: OrganizationSyncCoordinationService,
  ) {}

  async apply(
    user: AuthUser,
    batchId: string,
    provider: OrganizationSyncProvider = 'WECOM',
  ): Promise<void> {
    const initial = await this.prisma.client.orm.public.OrganizationSyncBatches.where({
      id: batchId,
      tenantId: user.tenantId,
      provider,
    })
      .select('status', 'integrationId')
      .first()
    if (!initial) throw new NotFoundException('同步批次不存在')
    if (initial.status === 'SUCCEEDED') return
    if (initial.status !== 'PREVIEW_READY') throw new BadRequestException('当前批次不能应用')
    if (!this.coordination) return this.applyCore(user, batchId, initial, provider)

    const result = await this.coordination.run(
      user.tenantId,
      user.id,
      'APPLYING',
      batchId,
      () => this.applyCore(user, batchId, initial, provider),
      provider,
    )
    if (!result.executed) throw new ConflictException('当前正在执行组织同步任务')
  }

  private async applyCore(
    user: AuthUser,
    batchId: string,
    initial: InitialSyncBatch,
    provider: OrganizationSyncProvider,
  ): Promise<void> {
    const providerName =
      provider === 'DINGTALK' ? '钉钉' : provider === 'LARK' ? '飞书' : '企业微信'
    const disabledUserIds = (
      await this.prisma.client.orm.public.OrganizationSyncItems.where({
        tenantId: user.tenantId,
        batchId,
        resourceType: 'USER',
        action: 'DISABLE',
      })
        .where((item) => item.localId.isNotNull())
        .select('localId')
        .all()
    )
      .map(({ localId }) => localId)
      .filter((id): id is string => Boolean(id))
    const subordinateIds = disabledUserIds.length
      ? (
          await this.prisma.client.orm.public.Users.where({ tenantId: user.tenantId })
            .where((member) => member.leaderId.in(disabledUserIds))
            .select('id')
            .all()
        ).map(({ id }) => id)
      : []

    let applyStarted = false
    try {
      const client = this.prisma.client
      await client.transaction(async (tx) => {
        const lockQuery = client.raw.sql`SELECT pg_advisory_xact_lock(
            hashtextextended(${`${user.tenantId}:${provider}`}, 0)
          )::text AS lock`.returnsRow({ lock: 'pg/text@1' })
        for await (const _row of tx.query(lockQuery.build())) break

        const batch = await tx.orm.public.OrganizationSyncBatches.where({
          id: batchId,
          tenantId: user.tenantId,
          provider,
        }).first()
        if (!batch) throw new NotFoundException('同步批次不存在')
        if (batch.status === 'SUCCEEDED') return
        if (batch.status !== 'PREVIEW_READY') throw new BadRequestException('当前批次不能应用')

        const integration = await tx.orm.public.EnterpriseIntegrations.where({
          id: batch.integrationId,
          tenantId: user.tenantId,
          provider,
        }).first()
        if (!integration?.syncEnabled || integration.lastTestSucceeded !== true) {
          throw new BadRequestException(`${providerName}同步配置当前不可用`)
        }
        if (integration.credentialVersion !== batch.credentialVersion) {
          throw new BadRequestException(`${providerName}配置已变化，请重新生成同步预览`)
        }
        if (!integration.syncDefaultRoleId) throw new BadRequestException('请选择新成员默认角色')
        const role = await tx.orm.public.Roles.where({
          id: integration.syncDefaultRoleId,
          tenantId: user.tenantId,
        })
          .select('id')
          .first()
        if (!role) throw new BadRequestException('默认角色不存在或不属于当前企业')
        const unresolved = await tx.orm.public.OrganizationSyncItems.where({
          tenantId: user.tenantId,
          batchId,
          action: 'CONFLICT',
        })
          .select('id')
          .first()
        if (unresolved) throw new BadRequestException('仍有未处理的同步冲突')

        applyStarted = true
        const applyStartedAt = nowInstant()
        await tx.orm.public.OrganizationSyncBatches.where({ id: batchId }).update({
          status: 'APPLYING',
          appliedById: user.id,
          applyStartedAt,
          updatedAt: applyStartedAt,
        })
        const items = await tx.orm.public.OrganizationSyncItems.where({
          tenantId: user.tenantId,
          batchId,
        })
          .orderBy([(item) => item.sort.asc(), (item) => item.createdAt.asc()])
          .all()
        const departmentItems = items.filter((item) => item.resourceType === 'DEPARTMENT')
        const userItems = items.filter((item) => item.resourceType === 'USER')
        const departmentIds = await this.applyDepartments(
          tx,
          user.tenantId,
          batchId,
          batch.targetDepartmentId,
          departmentItems,
          provider,
        )
        await this.applyUsers(
          tx,
          user.tenantId,
          batchId,
          role.id,
          userItems,
          departmentIds,
          provider,
        )

        const finishedAt = nowInstant()
        await tx.orm.public.OrganizationSyncBatches.where({ id: batchId }).update({
          status: 'SUCCEEDED',
          errorCode: null,
          errorMessage: null,
          finishedAt,
          updatedAt: finishedAt,
        })
        await tx.orm.public.EnterpriseIntegrations.where({ id: integration.id }).update({
          lastSyncStatus: 'SUCCEEDED',
          lastSyncMessage: `${providerName}组织架构同步成功`,
          lastSyncedAt: finishedAt,
          updatedById: user.id,
          updatedAt: finishedAt,
        })
        await tx.orm.public.Tenants.where({
          id: user.tenantId,
          enterpriseSyncResource: provider,
        }).updateAll({ enterpriseSynced: true, updatedAt: finishedAt })
      })
    } catch (error) {
      this.logger.error(
        `组织同步应用失败：${error instanceof Error ? error.message : 'unknown'}`,
        error instanceof Error ? error.stack : undefined,
      )
      if (applyStarted && !(error instanceof BadRequestException)) {
        const failedAt = nowInstant()
        await this.prisma.client.orm.public.OrganizationSyncBatches.where({
          id: batchId,
          tenantId: user.tenantId,
          status: 'PREVIEW_READY',
        }).updateAll({
          status: 'FAILED',
          errorCode: 'APPLY_FAILED',
          errorMessage: '应用组织同步失败，所有变更已回滚',
          finishedAt: failedAt,
          updatedAt: failedAt,
        })
        await this.prisma.client.orm.public.EnterpriseIntegrations.where({
          id: initial.integrationId,
          tenantId: user.tenantId,
        }).updateAll({
          lastSyncStatus: 'FAILED',
          lastSyncMessage: '应用组织同步失败，所有变更已回滚',
          updatedAt: failedAt,
        })
        await this.prisma.client.transaction(async (tx) => {
          const operationLog = await tx.orm.public.OperationLogs.create({
            tenantId: user.tenantId,
            userId: user.id,
            userName: user.name,
            module: 'organizationSync',
            action:
              provider === 'DINGTALK'
                ? 'applyDingTalkFailed'
                : provider === 'LARK'
                  ? 'applyLarkFailed'
                  : 'applyWeComFailed',
            targetId: batchId,
          })
          await tx.orm.public.OperationLogBlobs.create({
            operationLogId: operationLog.id,
            detail: jsonValue({ errorCode: 'APPLY_FAILED' }),
          })
        })
      }
      throw error
    }

    const affectedUsers = await this.prisma.client.orm.public.OrganizationSyncItems.where({
      tenantId: user.tenantId,
      batchId,
      resourceType: 'USER',
      result: 'APPLIED',
    })
      .where((item) => item.localId.isNotNull())
      .select('localId')
      .all()
    await this.authCache?.invalidateMany([
      ...affectedUsers.map(({ localId }) => localId).filter((id): id is string => Boolean(id)),
      ...subordinateIds,
    ])
    await this.cache?.invalidate(user.tenantId, 'directory')

    try {
      await this.notifications.notify(user.tenantId, user.id, {
        type: 'system',
        title: `${providerName}组织架构同步完成`,
        content: '部门和成员数据已按预览结果更新。',
        link: '/system/departments',
      })
    } catch (error) {
      this.logger.warn(
        `组织同步成功通知发送失败: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    }
  }

  private async applyDepartments(
    tx: PrismaTransaction,
    tenantId: string,
    batchId: string,
    targetDepartmentId: string,
    items: OrganizationSyncItemLike[],
    provider: OrganizationSyncProvider,
  ): Promise<Map<string, string>> {
    const resolved = new Map<string, string>()
    const existingMappings = await tx.orm.public.ExternalDepartmentMappings.where({
      tenantId,
      provider,
    }).all()
    for (const mapping of existingMappings) resolved.set(mapping.externalKey, mapping.departmentId)

    for (const item of items) {
      const updatedAt = nowInstant()
      if (item.action === 'SKIP') {
        await this.markItem(tx, item.id, 'SKIPPED')
        continue
      }
      if (item.action === 'DISABLE') {
        await tx.orm.public.ExternalDepartmentMappings.where({
          tenantId,
          provider,
          externalKey: item.externalKey,
        }).updateAll({ active: false, updatedAt })
        await this.markItem(tx, item.id, 'APPLIED')
        resolved.delete(item.externalKey)
        continue
      }

      const source = this.source(item)
      const parentId = item.parentExternalKey
        ? resolved.get(item.parentExternalKey)
        : targetDepartmentId
      if (item.parentExternalKey && !parentId) {
        throw new Error(`同步部门的上级映射不存在：${item.externalId}`)
      }
      let departmentId = item.resolvedLocalId ?? item.localId
      if (item.action === 'CREATE') {
        const created = await tx.orm.public.Departments.create({
          tenantId,
          name: this.requiredString(source, 'name'),
          parentId,
          sort: this.numberValue(source, 'order'),
          updatedAt,
        })
        departmentId = created.id
      } else {
        if (!departmentId) throw new Error(`同步部门缺少本地目标：${item.externalId}`)
        const updated = await tx.orm.public.Departments.where({
          id: departmentId,
          tenantId,
        }).update({
          name: this.requiredString(source, 'name'),
          parentId,
          sort: this.numberValue(source, 'order'),
          updatedAt,
        })
        if (!updated) throw new Error(`同步部门不存在：${item.externalId}`)
      }
      const mapping = await tx.orm.public.ExternalDepartmentMappings.where({
        tenantId,
        provider,
        externalKey: item.externalKey,
      })
        .select('id')
        .first()
      if (mapping) {
        await tx.orm.public.ExternalDepartmentMappings.where({ id: mapping.id }).update({
          externalId: item.externalId,
          departmentId: departmentId!,
          active: true,
          lastSeenBatchId: batchId,
          updatedAt,
        })
      } else {
        await tx.orm.public.ExternalDepartmentMappings.create({
          tenantId,
          provider,
          externalId: item.externalId,
          externalKey: item.externalKey,
          departmentId: departmentId!,
          active: true,
          lastSeenBatchId: batchId,
          updatedAt,
        })
      }
      resolved.set(item.externalKey, departmentId!)
      await this.markItem(tx, item.id, 'APPLIED', departmentId!)
    }
    return resolved
  }

  private async applyUsers(
    tx: PrismaTransaction,
    tenantId: string,
    batchId: string,
    defaultRoleId: string,
    items: OrganizationSyncItemLike[],
    departmentIds: Map<string, string>,
    provider: OrganizationSyncProvider,
  ): Promise<void> {
    const leaderByDepartment = new Map<string, string>()
    const departmentsWithLeaderData = new Set<string>()

    for (const item of items) {
      const updatedAt = nowInstant()
      if (item.action === 'SKIP') {
        await this.markItem(tx, item.id, 'SKIPPED')
        continue
      }
      if (item.action === 'DISABLE') {
        if (item.localId) {
          await tx.orm.public.Departments.where({ tenantId, leaderId: item.localId }).updateAll({
            leaderId: null,
            updatedAt,
          })
          await tx.orm.public.Users.where({ tenantId, leaderId: item.localId }).updateAll({
            leaderId: null,
            updatedAt,
          })
          await tx.orm.public.Users.where({ tenantId, id: item.localId }).updateAll({
            status: 'DISABLED',
            updatedAt,
          })
        }
        await tx.orm.public.ExternalUserMappings.where({
          tenantId,
          provider,
          externalKey: item.externalKey,
        }).updateAll({ active: false, updatedAt })
        await this.markItem(tx, item.id, 'APPLIED')
        continue
      }

      const source = this.source(item)
      const departmentKey = item.parentExternalKey
      const departmentId = departmentKey ? departmentIds.get(departmentKey) : null
      if (!departmentId) throw new Error(`同步成员的主部门不存在：${item.externalId}`)
      departmentsWithLeaderData.add(departmentId)
      let userId = item.resolvedLocalId ?? item.localId
      if (item.action === 'CREATE') {
        const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 10)
        const created = await tx.orm.public.Users.create({
          tenantId,
          email: this.nullableString(source, 'proposedEmail'),
          passwordHash,
          passwordLoginEnabled: false,
          name: this.requiredString(source, 'name'),
          status: 'ACTIVE',
          deptId: departmentId,
          position: this.nullableString(source, 'position'),
          phone: this.nullableString(source, 'mobile'),
          updatedAt,
        })
        await tx.orm.public.UserRoles.create({
          tenantId,
          userId: created.id,
          roleId: defaultRoleId,
          updatedAt,
        })
        userId = created.id
      } else {
        if (!userId) throw new Error(`同步成员缺少本地目标：${item.externalId}`)
        const updated = await tx.orm.public.Users.where({ id: userId, tenantId }).update({
          name: this.requiredString(source, 'name'),
          status: 'ACTIVE',
          deptId: departmentId,
          position: this.nullableString(source, 'position'),
          phone: this.nullableString(source, 'mobile'),
          updatedAt,
        })
        if (!updated) throw new Error(`同步成员不存在：${item.externalId}`)
      }
      const mapping = await tx.orm.public.ExternalUserMappings.where({
        tenantId,
        provider,
        externalKey: item.externalKey,
      })
        .select('id')
        .first()
      if (mapping) {
        await tx.orm.public.ExternalUserMappings.where({ id: mapping.id }).update({
          externalId: item.externalId,
          userId: userId!,
          active: true,
          lastSeenBatchId: batchId,
          updatedAt,
        })
      } else {
        await tx.orm.public.ExternalUserMappings.create({
          tenantId,
          provider,
          externalId: item.externalId,
          externalKey: item.externalKey,
          userId: userId!,
          active: true,
          lastSeenBatchId: batchId,
          updatedAt,
        })
      }
      if (source['isLeader'] === true && !leaderByDepartment.has(departmentId)) {
        leaderByDepartment.set(departmentId, userId!)
      }
      await this.markItem(tx, item.id, 'APPLIED', userId!)
    }

    for (const departmentId of departmentsWithLeaderData) {
      await tx.orm.public.Departments.where({ id: departmentId, tenantId }).updateAll({
        leaderId: leaderByDepartment.get(departmentId) ?? null,
        updatedAt: nowInstant(),
      })
    }
  }

  private markItem(
    tx: PrismaTransaction,
    id: string,
    result: 'APPLIED' | 'SKIPPED',
    localId?: string,
  ) {
    return tx.orm.public.OrganizationSyncItems.where({ id }).update({
      result,
      ...(localId ? { localId } : {}),
      updatedAt: nowInstant(),
    })
  }

  private source(item: OrganizationSyncItemLike): Record<string, unknown> {
    const value = item.sourceData
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`同步项快照无效：${item.id}`)
    }
    return value as Record<string, unknown>
  }

  private requiredString(source: Record<string, unknown>, key: string): string {
    const value = source[key]
    if (typeof value !== 'string' || !value.trim()) throw new Error(`同步字段缺失：${key}`)
    return value.trim()
  }

  private nullableString(source: Record<string, unknown>, key: string): string | null {
    const value = source[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  private numberValue(source: Record<string, unknown>, key: string): number {
    const value = source[key]
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
  }
}
