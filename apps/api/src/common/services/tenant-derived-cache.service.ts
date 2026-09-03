import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { RedisService } from '../../redis/redis.service'

const VERSION_TTL_SECONDS = 7 * 24 * 60 * 60

export interface DerivedCacheMetrics {
  hit: number
  miss: number
  bypass: number
  write: number
}

export interface DerivedCacheRememberOptions<T> {
  tenantId: string
  namespace: string
  key: string
  ttlSeconds: number
  loader: () => Promise<T>
  versioned?: boolean
}

@Injectable()
export class TenantDerivedCacheService {
  private readonly metrics = new Map<string, DerivedCacheMetrics>()

  constructor(private readonly redis: RedisService) {}

  async remember<T>(options: DerivedCacheRememberOptions<T>): Promise<T> {
    if (!this.redis.ready) {
      this.metric(options.namespace).bypass += 1
      return options.loader()
    }

    const version =
      options.versioned === false ? '0' : await this.version(options.tenantId, options.namespace)
    const cacheKey = this.cacheKey(options.tenantId, options.namespace, version, options.key)
    const cached = await this.redis.getJson<T>(cacheKey)
    if (cached !== null) {
      this.metric(options.namespace).hit += 1
      return cached
    }

    this.metric(options.namespace).miss += 1
    const value = await options.loader()
    if (await this.redis.setJson(cacheKey, value, options.ttlSeconds)) {
      this.metric(options.namespace).write += 1
    }
    return value
  }

  async invalidate(tenantId: string, namespace: string): Promise<void> {
    await this.redis.increment(this.versionKey(tenantId, namespace), VERSION_TTL_SECONDS)
  }

  fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(this.normalize(value))).digest('hex').slice(0, 24)
  }

  snapshot(): Record<string, DerivedCacheMetrics> {
    return Object.fromEntries(
      [...this.metrics.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([namespace, value]) => [namespace, { ...value }]),
    )
  }

  private async version(tenantId: string, namespace: string): Promise<string> {
    return (await this.redis.get(this.versionKey(tenantId, namespace))) ?? '0'
  }

  private versionKey(tenantId: string, namespace: string): string {
    return `derived-version:${namespace}:${tenantId}`
  }

  private cacheKey(tenantId: string, namespace: string, version: string, key: string): string {
    return `derived:${namespace}:${tenantId}:v${version}:${key}`
  }

  private metric(namespace: string): DerivedCacheMetrics {
    const current = this.metrics.get(namespace)
    if (current) return current
    const created: DerivedCacheMetrics = { hit: 0, miss: 0, bypass: 0, write: 0 }
    this.metrics.set(namespace, created)
    return created
  }

  private normalize(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'bigint') return value.toString()
    if (Array.isArray(value)) return value.map((item) => this.normalize(item))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, this.normalize(item)]),
    )
  }
}
