import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { PrismaService } from '../../prisma/prisma.service'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RETENTION_DAYS = 180
const DEFAULT_BATCH_SIZE = 1_000
const DEFAULT_MAX_BATCHES = 20
const MAX_BATCH_SIZE = 10_000
const MAX_BATCHES = 100

export interface OperationLogCleanupConfig {
  retentionDays: number
  batchSize: number
  maxBatches: number
}

function positiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  max?: number,
): number {
  const value = raw?.trim()
  if (!value) return fallback
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
    const suffix = max === undefined ? '' : ` not greater than ${max}`
    throw new Error(`${name} must be a positive integer${suffix}`)
  }
  return parsed
}

export function resolveOperationLogCleanupConfig(
  env: NodeJS.ProcessEnv = process.env,
): OperationLogCleanupConfig {
  return {
    retentionDays: positiveInteger(
      'OPERATION_LOG_RETENTION_DAYS',
      env.OPERATION_LOG_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
    ),
    batchSize: positiveInteger(
      'OPERATION_LOG_CLEANUP_BATCH_SIZE',
      env.OPERATION_LOG_CLEANUP_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      MAX_BATCH_SIZE,
    ),
    maxBatches: positiveInteger(
      'OPERATION_LOG_CLEANUP_MAX_BATCHES',
      env.OPERATION_LOG_CLEANUP_MAX_BATCHES,
      DEFAULT_MAX_BATCHES,
      MAX_BATCHES,
    ),
  }
}

@Injectable()
export class OperationLogCleanupService {
  private readonly logger = new Logger(OperationLogCleanupService.name)
  private readonly config = resolveOperationLogCleanupConfig()

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  /** 每天 04:15 尝试清理一次；多实例由 DAILY slot 去重。 */
  @Cron('0 15 4 * * *')
  async scheduledCleanup(now = new Date()): Promise<void> {
    try {
      if (!this.coordinator) return void (await this.cleanup(now))
      await this.coordinator.runScheduledOnce('operation-log-cleanup', 'DAILY', () =>
        this.cleanup(now),
      )
    } catch (error) {
      this.logger.error(
        `操作日志自动清理失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async cleanup(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.retentionDays * DAY_MS)
    let deleted = 0

    for (let batch = 0; batch < this.config.maxBatches; batch += 1) {
      const rows = await this.prisma.operationLog.findMany({
        where: { createdAt: { lt: cutoff } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: this.config.batchSize,
        select: { id: true },
      })
      if (rows.length === 0) break

      const result = await this.prisma.operationLog.deleteMany({
        where: { id: { in: rows.map(({ id }) => id) } },
      })
      deleted += result.count
      if (rows.length < this.config.batchSize) break
    }

    if (deleted > 0) {
      this.logger.log(
        `操作日志清理完成: deleted=${deleted}, cutoff=${cutoff.toISOString()}, retentionDays=${this.config.retentionDays}`,
      )
    }
    return deleted
  }
}
