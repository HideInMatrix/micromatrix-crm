import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'

export type CoordinationSlot = 'DAILY' | 'MINUTE'
export type CoordinationSource = 'REDIS' | 'POSTGRES' | 'UNCOORDINATED'

export interface CoordinationContext {
  source: CoordinationSource
  token: string | null
}

export type CoordinationRunResult<T> =
  | { executed: true; source: CoordinationSource; value: T }
  | { executed: false; source: 'REDIS' | 'POSTGRES'; reason: 'BUSY' }

interface CoordinatorMetrics {
  exclusiveAcquired: number
  exclusiveBusy: number
  exclusiveUnavailable: number
  renewWarnings: number
  scheduledAcquired: number
  scheduledBusy: number
  postgresFallback: number
  postgresAcquired: number
  postgresSkipped: number
}

const DAILY_SLOT_TTL_MS = 36 * 60 * 60 * 1000
const MINUTE_SLOT_TTL_MS = 10 * 60 * 1000
const FALLBACK_TRANSACTION_TIMEOUT_MS = 15 * 60 * 1000

@Injectable()
export class DistributedCoordinatorService {
  private readonly logger = new Logger(DistributedCoordinatorService.name)
  private readonly metrics: CoordinatorMetrics = {
    exclusiveAcquired: 0,
    exclusiveBusy: 0,
    exclusiveUnavailable: 0,
    renewWarnings: 0,
    scheduledAcquired: 0,
    scheduledBusy: 0,
    postgresFallback: 0,
    postgresAcquired: 0,
    postgresSkipped: 0,
  }

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  snapshot() {
    return { ...this.metrics, redis: this.redis.coordinationSnapshot() }
  }

  async runExclusive<T>(
    key: string,
    task: (context: CoordinationContext) => Promise<T>,
    options: { ttlMs?: number; renewEveryMs?: number } = {},
  ): Promise<CoordinationRunResult<T>> {
    const ttlMs = Math.max(1_000, options.ttlMs ?? 60_000)
    const renewEveryMs = Math.max(500, options.renewEveryMs ?? Math.floor(ttlMs / 3))
    const result = await this.redis.acquireLease(this.leaseKey(key), ttlMs)
    if (result.status === 'BUSY') {
      this.metrics.exclusiveBusy += 1
      return { executed: false, source: 'REDIS', reason: 'BUSY' }
    }
    if (result.status === 'UNAVAILABLE') {
      this.metrics.exclusiveUnavailable += 1
      return {
        executed: true,
        source: 'UNCOORDINATED',
        value: await task({ source: 'UNCOORDINATED', token: null }),
      }
    }

    this.metrics.exclusiveAcquired += 1
    const timer = setInterval(() => {
      void this.redis.renewLease(this.leaseKey(key), result.token, ttlMs).then((renewed) => {
        if (renewed === true) return
        this.metrics.renewWarnings += 1
        this.logger.warn(`Redis coordination lease 续租失败，任务继续依赖数据库最终保护：${key}`)
      })
    }, renewEveryMs)
    timer.unref()

    try {
      return {
        executed: true,
        source: 'REDIS',
        value: await task({ source: 'REDIS', token: result.token }),
      }
    } finally {
      clearInterval(timer)
      await this.redis.releaseLease(this.leaseKey(key), result.token)
    }
  }

  async runScheduledOnce<T>(
    job: string,
    slot: CoordinationSlot,
    task: () => Promise<T>,
    now = new Date(),
  ): Promise<CoordinationRunResult<T>> {
    const slotId = this.slotId(slot, now)
    const key = `coord:cron:${job}:${slotId}`
    const ttlMs = slot === 'DAILY' ? DAILY_SLOT_TTL_MS : MINUTE_SLOT_TTL_MS
    const claimed = await this.redis.claimOnce(key, ttlMs)
    if (claimed.status === 'ACQUIRED') {
      this.metrics.scheduledAcquired += 1
      return { executed: true, source: 'REDIS', value: await task() }
    }
    if (claimed.status === 'BUSY') {
      this.metrics.scheduledBusy += 1
      return { executed: false, source: 'REDIS', reason: 'BUSY' }
    }
    return this.runScheduledWithPostgresFallback(key, task)
  }

  async currentLeaseToken(key: string): Promise<string | null> {
    return this.redis.get(this.leaseKey(key))
  }

  leaseKey(key: string): string {
    return `coord:lease:${key}`
  }

  private slotId(slot: CoordinationSlot, now: Date): string {
    const iso = now.toISOString()
    return slot === 'DAILY' ? iso.slice(0, 10) : iso.slice(0, 16)
  }

  private async runScheduledWithPostgresFallback<T>(
    key: string,
    task: () => Promise<T>,
  ): Promise<CoordinationRunResult<T>> {
    this.metrics.postgresFallback += 1
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`,
        )
        if (rows[0]?.locked !== true) {
          this.metrics.postgresSkipped += 1
          return { executed: false, source: 'POSTGRES', reason: 'BUSY' } as const
        }
        this.metrics.postgresAcquired += 1
        return { executed: true, source: 'POSTGRES', value: await task() } as const
      },
      { maxWait: 5_000, timeout: FALLBACK_TRANSACTION_TIMEOUT_MS },
    )
  }
}
