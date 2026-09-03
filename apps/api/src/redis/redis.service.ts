import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis, { type RedisOptions } from 'ioredis'

const REDIS_KEY_PREFIX = 'micromatrix-crm:'
const ERROR_LOG_INTERVAL_MS = 30_000

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name)
  private readonly client: Redis | null
  private lastErrorLogAt = 0

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL')?.trim()
    const host = this.config.get<string>('REDIS_HOST')?.trim()
    if (!url && !host) {
      this.client = null
      this.logger.log('Redis 未配置，缓存能力保持关闭并自动回退数据库')
      return
    }

    const options: RedisOptions = {
      keyPrefix: REDIS_KEY_PREFIX,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_500,
      retryStrategy: (times) => Math.min(times * 250, 2_000),
    }
    this.client = url
      ? new Redis(url, options)
      : new Redis({
          ...options,
          host,
          port: this.numberConfig('REDIS_PORT', 6379),
          password: this.config.get<string>('REDIS_PASSWORD') || undefined,
          db: this.numberConfig('REDIS_DB', 0),
        })
    this.client.on('ready', () => this.logger.log('Redis 连接已就绪'))
    this.client.on('error', (error) => this.logError(error))
  }

  get enabled(): boolean {
    return this.client !== null
  }

  get ready(): boolean {
    return this.client?.status === 'ready'
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null
    try {
      return await this.client.get(key)
    } catch (error) {
      this.logError(error)
      return null
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch (error) {
      this.logError(error)
      await this.delete(key)
      return null
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    if (!this.client) return false
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds)
      return true
    } catch (error) {
      this.logError(error)
      return false
    }
  }

  async increment(key: string, ttlSeconds: number): Promise<number | null> {
    if (!this.client) return null
    try {
      const result = await this.client.multi().incr(key).expire(key, ttlSeconds).exec()
      const incremented = result?.[0]
      if (!incremented || incremented[0]) return null
      return typeof incremented[1] === 'number' ? incremented[1] : Number(incremented[1])
    } catch (error) {
      this.logError(error)
      return null
    }
  }

  async delete(...keys: string[]): Promise<boolean> {
    if (!this.client || keys.length === 0) return false
    try {
      await this.client.del(...keys)
      return true
    } catch (error) {
      this.logError(error)
      return false
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) return
    try {
      if (this.client.status !== 'end') await this.client.quit()
    } catch {
      this.client.disconnect(false)
    }
  }

  private numberConfig(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key))
    return Number.isInteger(value) && value >= 0 ? value : fallback
  }

  private logError(error: unknown): void {
    const now = Date.now()
    if (now - this.lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return
    this.lastErrorLogAt = now
    this.logger.warn(
      `Redis 暂不可用，当前请求已降级使用数据库：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
