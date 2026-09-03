import { Injectable } from '@nestjs/common'
import { DistributedCoordinatorService, type CoordinationRunResult } from '../../common/services/distributed-coordinator.service'
import { RedisService } from '../../redis/redis.service'

export type OrganizationSyncRuntimePhase = 'FETCHING' | 'APPLYING'

export interface OrganizationSyncRuntimeStatus {
  phase: OrganizationSyncRuntimePhase
  operatorId: string
  batchId: string | null
  startedAt: string
}

interface OrganizationSyncRuntimeContext {
  setBatchId(batchId: string): Promise<void>
}

const STATUS_TTL_SECONDS = 60 * 60
const LEASE_TTL_MS = 60_000
const LEASE_RENEW_MS = 20_000

@Injectable()
export class OrganizationSyncCoordinationService {
  constructor(
    private readonly coordinator: DistributedCoordinatorService,
    private readonly redis: RedisService,
  ) {}

  async run<T>(
    tenantId: string,
    operatorId: string,
    phase: OrganizationSyncRuntimePhase,
    batchId: string | null,
    task: (context: OrganizationSyncRuntimeContext) => Promise<T>,
  ): Promise<CoordinationRunResult<T>> {
    const startedAt = new Date().toISOString()
    return this.coordinator.runExclusive(
      this.logicalKey(tenantId),
      async ({ token }) => {
        const writeStatus = async (nextBatchId: string | null) => {
          if (!token) return
          await this.redis.setJson(
            this.statusKey(tenantId, token),
            { phase, operatorId, batchId: nextBatchId, startedAt } satisfies OrganizationSyncRuntimeStatus,
            STATUS_TTL_SECONDS,
          )
        }
        await writeStatus(batchId)
        return task({ setBatchId: (nextBatchId) => writeStatus(nextBatchId) })
      },
      { ttlMs: LEASE_TTL_MS, renewEveryMs: LEASE_RENEW_MS },
    )
  }

  async runtimeStatus(tenantId: string): Promise<OrganizationSyncRuntimeStatus | null> {
    const token = await this.coordinator.currentLeaseToken(this.logicalKey(tenantId))
    if (!token) return null
    const status = await this.redis.getJson<unknown>(this.statusKey(tenantId, token))
    return this.parseStatus(status)
  }

  private logicalKey(tenantId: string): string {
    return `organization-sync:WECOM:${tenantId}`
  }

  private statusKey(tenantId: string, token: string): string {
    return `coord:organization-sync:status:${tenantId}:${token}`
  }

  private parseStatus(value: unknown): OrganizationSyncRuntimeStatus | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    if (row['phase'] !== 'FETCHING' && row['phase'] !== 'APPLYING') return null
    if (typeof row['operatorId'] !== 'string' || typeof row['startedAt'] !== 'string') return null
    if (row['batchId'] !== null && typeof row['batchId'] !== 'string') return null
    return {
      phase: row['phase'],
      operatorId: row['operatorId'],
      batchId: row['batchId'] as string | null,
      startedAt: row['startedAt'],
    }
  }
}
