import { randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { Prisma, type OrganizationSyncItem } from '../../generated/prisma/client'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

const PROVIDER = 'WECOM' as const

@Injectable()
export class OrganizationSyncApplyService {
  private readonly logger = new Logger(OrganizationSyncApplyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async apply(user: AuthUser, batchId: string): Promise<void> {
    const initial = await this.prisma.organizationSyncBatch.findFirst({
      where: { id: batchId, tenantId: user.tenantId, provider: PROVIDER },
    })
    if (!initial) throw new NotFoundException('同步批次不存在')
    if (initial.status === 'SUCCEEDED') return
    if (initial.status !== 'PREVIEW_READY') throw new BadRequestException('当前批次不能应用')

    let applyStarted = false
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${user.tenantId}:${PROVIDER}`}, 0))::text AS lock`
          const batch = await tx.organizationSyncBatch.findFirst({
            where: { id: batchId, tenantId: user.tenantId, provider: PROVIDER },
          })
          if (!batch) throw new NotFoundException('同步批次不存在')
          if (batch.status === 'SUCCEEDED') return
          if (batch.status !== 'PREVIEW_READY') throw new BadRequestException('当前批次不能应用')

          const integration = await tx.enterpriseIntegration.findFirst({
            where: { id: batch.integrationId, tenantId: user.tenantId, provider: PROVIDER },
          })
          if (!integration?.syncEnabled || integration.lastTestSucceeded !== true) {
            throw new BadRequestException('企业微信同步配置当前不可用')
          }
          if (integration.credentialVersion !== batch.credentialVersion) {
            throw new BadRequestException('企业微信配置已变化，请重新生成同步预览')
          }
          if (!integration.syncDefaultRoleId) throw new BadRequestException('请选择新成员默认角色')
          const role = await tx.role.findFirst({
            where: { id: integration.syncDefaultRoleId, tenantId: user.tenantId },
            select: { id: true },
          })
          if (!role) throw new BadRequestException('默认角色不存在或不属于当前企业')
          const unresolved = await tx.organizationSyncItem.count({
            where: { tenantId: user.tenantId, batchId, action: 'CONFLICT' },
          })
          if (unresolved > 0) throw new BadRequestException('仍有未处理的同步冲突')

          applyStarted = true
          await tx.organizationSyncBatch.update({
            where: { id: batchId },
            data: { status: 'APPLYING', appliedById: user.id, applyStartedAt: new Date() },
          })
          const items = await tx.organizationSyncItem.findMany({
            where: { tenantId: user.tenantId, batchId },
            orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
          })
          const departmentItems = items.filter((item) => item.resourceType === 'DEPARTMENT')
          const userItems = items.filter((item) => item.resourceType === 'USER')
          const departmentIds = await this.applyDepartments(
            tx,
            user.tenantId,
            batchId,
            departmentItems,
          )
          await this.applyUsers(tx, user.tenantId, batchId, role.id, userItems, departmentIds)

          const finishedAt = new Date()
          await tx.organizationSyncBatch.update({
            where: { id: batchId },
            data: {
              status: 'SUCCEEDED',
              errorCode: null,
              errorMessage: null,
              finishedAt,
            },
          })
          await tx.enterpriseIntegration.update({
            where: { id: integration.id },
            data: {
              lastSyncStatus: 'SUCCEEDED',
              lastSyncMessage: '企业微信组织架构同步成功',
              lastSyncedAt: finishedAt,
              updatedById: user.id,
            },
          })
        },
        { maxWait: 10_000, timeout: 60_000 },
      )
    } catch (error) {
      this.logger.error(
        `组织同步应用失败：${error instanceof Error ? error.message : 'unknown'}`,
        error instanceof Error ? error.stack : undefined,
      )
      if (applyStarted && !(error instanceof BadRequestException)) {
        await this.prisma.organizationSyncBatch.updateMany({
          where: { id: batchId, tenantId: user.tenantId, status: 'PREVIEW_READY' },
          data: {
            status: 'FAILED',
            errorCode: 'APPLY_FAILED',
            errorMessage: '应用组织同步失败，所有变更已回滚',
            finishedAt: new Date(),
          },
        })
        await this.prisma.enterpriseIntegration.updateMany({
          where: { id: initial.integrationId, tenantId: user.tenantId },
          data: {
            lastSyncStatus: 'FAILED',
            lastSyncMessage: '应用组织同步失败，所有变更已回滚',
          },
        })
        await this.prisma.operationLog.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            userName: user.name,
            module: 'organizationSync',
            action: 'applyWeComFailed',
            targetId: batchId,
            detail: { errorCode: 'APPLY_FAILED' },
          },
        })
      }
      throw error
    }

    try {
      await this.notifications.notify(user.tenantId, user.id, {
        type: 'system',
        title: '企业微信组织架构同步完成',
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
    tx: Prisma.TransactionClient,
    tenantId: string,
    batchId: string,
    items: OrganizationSyncItem[],
  ): Promise<Map<string, string>> {
    const resolved = new Map<string, string>()
    const existingMappings = await tx.externalDepartmentMapping.findMany({
      where: { tenantId, provider: PROVIDER },
    })
    for (const mapping of existingMappings) resolved.set(mapping.externalKey, mapping.departmentId)

    for (const item of items) {
      if (item.action === 'SKIP') {
        await this.markItem(tx, item.id, 'SKIPPED')
        continue
      }
      if (item.action === 'DISABLE') {
        await tx.externalDepartmentMapping.updateMany({
          where: { tenantId, provider: PROVIDER, externalKey: item.externalKey },
          data: { active: false },
        })
        await this.markItem(tx, item.id, 'APPLIED')
        resolved.delete(item.externalKey)
        continue
      }

      const source = this.source(item)
      const parentId = item.parentExternalKey ? resolved.get(item.parentExternalKey) : null
      if (item.parentExternalKey && !parentId) {
        throw new Error(`同步部门的上级映射不存在：${item.externalId}`)
      }
      let departmentId = item.resolvedLocalId ?? item.localId
      if (item.action === 'CREATE') {
        const created = await tx.department.create({
          data: {
            tenantId,
            name: this.requiredString(source, 'name'),
            parentId,
            sort: this.numberValue(source, 'order'),
          },
        })
        departmentId = created.id
      } else {
        if (!departmentId) throw new Error(`同步部门缺少本地目标：${item.externalId}`)
        const updated = await tx.department.updateMany({
          where: { id: departmentId, tenantId },
          data: {
            name: this.requiredString(source, 'name'),
            parentId,
            sort: this.numberValue(source, 'order'),
          },
        })
        if (updated.count !== 1) throw new Error(`同步部门不存在：${item.externalId}`)
      }
      await tx.externalDepartmentMapping.upsert({
        where: {
          tenantId_provider_externalKey: {
            tenantId,
            provider: PROVIDER,
            externalKey: item.externalKey,
          },
        },
        create: {
          tenantId,
          provider: PROVIDER,
          externalId: item.externalId,
          externalKey: item.externalKey,
          departmentId: departmentId!,
          active: true,
          lastSeenBatchId: batchId,
        },
        update: {
          externalId: item.externalId,
          departmentId: departmentId!,
          active: true,
          lastSeenBatchId: batchId,
        },
      })
      resolved.set(item.externalKey, departmentId!)
      await this.markItem(tx, item.id, 'APPLIED', departmentId!)
    }
    return resolved
  }

  private async applyUsers(
    tx: Prisma.TransactionClient,
    tenantId: string,
    batchId: string,
    defaultRoleId: string,
    items: OrganizationSyncItem[],
    departmentIds: Map<string, string>,
  ): Promise<void> {
    const leaderByDepartment = new Map<string, string>()
    const departmentsWithLeaderData = new Set<string>()

    for (const item of items) {
      if (item.action === 'SKIP') {
        await this.markItem(tx, item.id, 'SKIPPED')
        continue
      }
      if (item.action === 'DISABLE') {
        if (item.localId) {
          await Promise.all([
            tx.department.updateMany({
              where: { tenantId, leaderId: item.localId },
              data: { leaderId: null },
            }),
            tx.user.updateMany({
              where: { tenantId, leaderId: item.localId },
              data: { leaderId: null },
            }),
            tx.user.updateMany({
              where: { tenantId, id: item.localId },
              data: { status: 'DISABLED' },
            }),
          ])
        }
        await tx.externalUserMapping.updateMany({
          where: { tenantId, provider: PROVIDER, externalKey: item.externalKey },
          data: { active: false },
        })
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
        const created = await tx.user.create({
          data: {
            tenantId,
            email: this.nullableString(source, 'proposedEmail'),
            passwordHash,
            passwordLoginEnabled: false,
            name: this.requiredString(source, 'name'),
            status: 'ACTIVE',
            deptId: departmentId,
            position: this.nullableString(source, 'position'),
            phone: this.nullableString(source, 'mobile'),
            userRoles: { create: { tenantId, roleId: defaultRoleId } },
          },
        })
        userId = created.id
      } else {
        if (!userId) throw new Error(`同步成员缺少本地目标：${item.externalId}`)
        const updated = await tx.user.updateMany({
          where: { id: userId, tenantId },
          data: {
            name: this.requiredString(source, 'name'),
            status: 'ACTIVE',
            deptId: departmentId,
            position: this.nullableString(source, 'position'),
            phone: this.nullableString(source, 'mobile'),
          },
        })
        if (updated.count !== 1) throw new Error(`同步成员不存在：${item.externalId}`)
      }
      await tx.externalUserMapping.upsert({
        where: {
          tenantId_provider_externalKey: {
            tenantId,
            provider: PROVIDER,
            externalKey: item.externalKey,
          },
        },
        create: {
          tenantId,
          provider: PROVIDER,
          externalId: item.externalId,
          externalKey: item.externalKey,
          userId: userId!,
          active: true,
          lastSeenBatchId: batchId,
        },
        update: {
          externalId: item.externalId,
          userId: userId!,
          active: true,
          lastSeenBatchId: batchId,
        },
      })
      if (source['isLeader'] === true && !leaderByDepartment.has(departmentId)) {
        leaderByDepartment.set(departmentId, userId!)
      }
      await this.markItem(tx, item.id, 'APPLIED', userId!)
    }

    for (const departmentId of departmentsWithLeaderData) {
      await tx.department.updateMany({
        where: { id: departmentId, tenantId },
        data: { leaderId: leaderByDepartment.get(departmentId) ?? null },
      })
    }
  }

  private markItem(
    tx: Prisma.TransactionClient,
    id: string,
    result: 'APPLIED' | 'SKIPPED',
    localId?: string,
  ) {
    return tx.organizationSyncItem.update({
      where: { id },
      data: { result, ...(localId ? { localId } : {}) },
    })
  }

  private source(item: OrganizationSyncItem): Record<string, unknown> {
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
