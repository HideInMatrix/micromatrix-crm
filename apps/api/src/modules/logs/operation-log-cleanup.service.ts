import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type {
  LogCategory,
  OperationLogCleanupResultVO,
  OperationLogClearResultVO,
} from '@micromatrix/shared'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { PrismaService } from '../../prisma.service.js'
import { resolveOperationLogCleanupConfig } from './operation-log-config'
import {
  type OperationLogCleanupSource,
  OperationLogCleanupSources,
  OperationLogSettingsService,
} from './operation-log-settings.service'

export { resolveOperationLogCleanupConfig } from './operation-log-config'

const DAY_MS = 24 * 60 * 60 * 1000

@Injectable()
export class OperationLogCleanupService {
  private readonly logger = new Logger(OperationLogCleanupService.name)
  private readonly config = resolveOperationLogCleanupConfig()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OperationLogSettingsService,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  /** 每天 04:15 清理操作、外部事件及登录日志；多实例由 DAILY slot 去重。 */
  @Cron('0 15 4 * * *')
  async scheduledCleanup(now = new Date()): Promise<void> {
    try {
      if (!this.coordinator) return void (await this.cleanupAllTenants(now))
      await this.coordinator.runScheduledOnce('operation-log-cleanup', 'DAILY', () =>
        this.cleanupAllTenants(now),
      )
    } catch (error) {
      this.logger.error(
        `系统日志自动清理失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async cleanupAllTenants(now = new Date()): Promise<number> {
    const tenants = await this.prisma.client.orm.public.Tenants.select('id').all()
    let deleted = 0

    for (const tenant of tenants) {
      for (const category of ['operation', 'event', 'login'] as const) {
        try {
          deleted += (
            await this.cleanupTenant(tenant.id, now, OperationLogCleanupSources.AUTO, category)
          ).deleted
        } catch (error) {
          this.logger.error(
            '租户日志清理失败: tenant=' +
              tenant.id +
              ', category=' +
              category +
              ', error=' +
              (error instanceof Error ? error.message : String(error)),
          )
        }
      }
    }

    // 认证失败时无法确定租户的记录，按部署默认保留期统一清理。
    // 该范围只在定时全局任务中处理，不纳入租户手动清理。
    try {
      const cutoff = new Date(now.getTime() - this.config.retentionDays * DAY_MS)
      for (let batch = 0; batch < this.config.maxBatches; batch += 1) {
        const count = await this.deleteUnattributedLoginBatch(cutoff, this.config.batchSize)
        deleted += count
        if (count < this.config.batchSize) break
      }
    } catch (error) {
      this.logger.error(
        '无租户登录日志自动清理失败: ' + (error instanceof Error ? error.message : String(error)),
      )
    }

    return deleted
  }

  async cleanupTenant(
    tenantId: string,
    now = new Date(),
    source: OperationLogCleanupSource = OperationLogCleanupSources.MANUAL,
    category: LogCategory = 'operation',
  ): Promise<OperationLogCleanupResultVO> {
    const policy = await this.settings.resolvePolicy(tenantId, category)
    if (policy.retentionDays === null) {
      const setting = await this.settings.recordCleanup(tenantId, 0, source, now, category)
      return { skipped: true, deleted: 0, cutoff: null, setting }
    }

    const cutoff = new Date(now.getTime() - policy.retentionDays * DAY_MS)
    let deleted = 0
    const deleteBatch =
      category === 'login'
        ? this.deleteLoginBatch.bind(this)
        : category === 'event'
          ? this.deleteEventBatch.bind(this)
          : this.deleteBatch.bind(this)
    for (let batch = 0; batch < this.config.maxBatches; batch += 1) {
      const count = await deleteBatch(tenantId, cutoff, this.config.batchSize)
      deleted += count
      if (count < this.config.batchSize) break
    }

    const setting = await this.settings.recordCleanup(tenantId, deleted, source, now, category)
    if (deleted > 0) {
      this.logger.log(
        '日志清理完成: tenant=' +
          tenantId +
          ', category=' +
          category +
          ', deleted=' +
          deleted +
          ', retentionDays=' +
          policy.retentionDays,
      )
    }
    return { skipped: false, deleted, cutoff: cutoff.toISOString(), setting }
  }

  /** 高风险人工操作：清空当前租户全部操作日志，不计入 retention 清理状态。 */
  async clearTenant(
    tenantId: string,
    category: 'operation' | 'event' = 'operation',
  ): Promise<OperationLogClearResultVO> {
    const client = this.prisma.client
    const query =
      category === 'event'
        ? client.raw.sql`DELETE FROM operation_logs WHERE "tenantId" = ${tenantId}
          AND "module" = 'externalEvent' RETURNING id`.returnsRow({
            id: client.sql.public.operation_logs.columns.id,
          })
        : client.raw.sql`DELETE FROM operation_logs WHERE "tenantId" = ${tenantId}
          AND "module" <> 'externalEvent' RETURNING id`.returnsRow({
            id: client.sql.public.operation_logs.columns.id,
          })
    let deleted = 0
    for await (const _row of client.runtime().query(query.build())) deleted += 1
    this.logger.warn(`当前租户操作日志已全部清空: tenantId=${tenantId}, deleted=${deleted}`)
    return { deleted }
  }

  private async deleteLoginBatch(tenantId: string, cutoff: Date, limit: number): Promise<number> {
    const client = this.prisma.client
    const cutoffIso = cutoff.toISOString()
    const query = client.raw.sql`WITH candidates AS (
        SELECT id
        FROM login_logs
        WHERE "tenantId" = ${tenantId}
          AND "createdAt" < ${cutoffIso}::timestamptz
        ORDER BY "createdAt" ASC, id ASC
        LIMIT ${limit}
      )
      DELETE FROM login_logs AS log
      USING candidates
      WHERE log.id = candidates.id
      RETURNING log.id`.returnsRow({ id: client.sql.public.login_logs.columns.id })
    let deleted = 0
    for await (const _row of client.runtime().query(query.build())) deleted += 1
    return deleted
  }

  private async deleteUnattributedLoginBatch(cutoff: Date, limit: number): Promise<number> {
    const client = this.prisma.client
    const cutoffIso = cutoff.toISOString()
    const query = client.raw.sql`WITH candidates AS (
        SELECT id
        FROM login_logs
        WHERE "tenantId" IS NULL
          AND "createdAt" < ${cutoffIso}::timestamptz
        ORDER BY "createdAt" ASC, id ASC
        LIMIT ${limit}
      )
      DELETE FROM login_logs AS log
      USING candidates
      WHERE log.id = candidates.id
      RETURNING log.id`.returnsRow({ id: client.sql.public.login_logs.columns.id })
    let deleted = 0
    for await (const _row of client.runtime().query(query.build())) deleted += 1
    return deleted
  }

  private async deleteEventBatch(tenantId: string, cutoff: Date, limit: number): Promise<number> {
    const client = this.prisma.client
    const cutoffIso = cutoff.toISOString()
    const query = client.raw.sql`WITH candidates AS (
        SELECT id
        FROM operation_logs
        WHERE "tenantId" = ${tenantId}
          AND "module" = 'externalEvent'
          AND "createdAt" < ${cutoffIso}::timestamptz
        ORDER BY "createdAt" ASC, id ASC
        LIMIT ${limit}
      )
      DELETE FROM operation_logs AS log
      USING candidates
      WHERE log.id = candidates.id
      RETURNING log.id`.returnsRow({ id: client.sql.public.operation_logs.columns.id })
    let deleted = 0
    for await (const _row of client.runtime().query(query.build())) deleted += 1
    return deleted
  }

  private async deleteBatch(tenantId: string, cutoff: Date, limit: number): Promise<number> {
    const client = this.prisma.client
    const cutoffIso = cutoff.toISOString()
    const query = client.raw.sql`WITH candidates AS (
        SELECT id
        FROM operation_logs
        WHERE "tenantId" = ${tenantId}
          AND "module" <> 'externalEvent'
          AND "createdAt" < ${cutoffIso}::timestamptz
        ORDER BY "createdAt" ASC, id ASC
        LIMIT ${limit}
      )
      DELETE FROM operation_logs AS log
      USING candidates
      WHERE log.id = candidates.id
      RETURNING log.id`.returnsRow({ id: client.sql.public.operation_logs.columns.id })
    let deleted = 0
    for await (const _row of client.runtime().query(query.build())) deleted += 1
    return deleted
  }
}
