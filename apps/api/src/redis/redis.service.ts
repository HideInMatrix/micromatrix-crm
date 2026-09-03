import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import Redis, { type RedisOptions } from 'ioredis'

const REDIS_KEY_PREFIX = 'micromatrix-crm:'
const REDIS_EVENT_CHANNEL_PREFIX = 'micromatrix-crm:event:'
const ERROR_LOG_INTERVAL_MS = 30_000

type RedisMessageHandler = (message: string) => void | Promise<void>

export type RedisCoordinationAcquireResult =
  | { status: 'ACQUIRED'; token: string }
  | { status: 'BUSY' }
  | { status: 'UNAVAILABLE' }

interface RedisCoordinationMetrics {
  leaseAcquired: number
  leaseBusy: number
  leaseUnavailable: number
  renewFailures: number
  releaseFailures: number
  slotAcquired: number
  slotBusy: number
  slotUnavailable: number
}

interface RedisPubSubMetrics {
  publishAttempts: number
  publishedMessages: number
  deliveredSubscriptions: number
  publishFailures: number
  receivedMessages: number
  unhandledMessages: number
  handlerErrors: number
  subscribeErrors: number
}

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name)
  private readonly client: Redis | null
  private subscriber: Redis | null = null
  private readonly channelHandlers = new Map<string, Set<RedisMessageHandler>>()
  private readonly subscribedChannels = new Set<string>()
  private readonly pubSubMetrics: RedisPubSubMetrics = {
    publishAttempts: 0,
    publishedMessages: 0,
    deliveredSubscriptions: 0,
    publishFailures: 0,
    receivedMessages: 0,
    unhandledMessages: 0,
    handlerErrors: 0,
    subscribeErrors: 0,
  }
  private readonly coordinationMetrics: RedisCoordinationMetrics = {
    leaseAcquired: 0,
    leaseBusy: 0,
    leaseUnavailable: 0,
    renewFailures: 0,
    releaseFailures: 0,
    slotAcquired: 0,
    slotBusy: 0,
    slotUnavailable: 0,
  }
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

  get pubSubReady(): boolean {
    return this.subscriber?.status === 'ready' && this.subscribedChannels.size > 0
  }

  pubSubSnapshot() {
    return {
      enabled: this.enabled,
      ready: this.pubSubReady,
      channels: this.channelHandlers.size,
      handlers: [...this.channelHandlers.values()].reduce((sum, handlers) => sum + handlers.size, 0),
      ...this.pubSubMetrics,
    }
  }

  coordinationSnapshot() {
    return { enabled: this.enabled, ready: this.ready, ...this.coordinationMetrics }
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

  async acquireLease(key: string, ttlMs: number): Promise<RedisCoordinationAcquireResult> {
    if (!this.client || this.client.status !== 'ready') {
      this.coordinationMetrics.leaseUnavailable += 1
      return { status: 'UNAVAILABLE' }
    }
    const token = randomUUID()
    try {
      const result = await this.client.set(key, token, 'PX', ttlMs, 'NX')
      if (result === 'OK') {
        this.coordinationMetrics.leaseAcquired += 1
        return { status: 'ACQUIRED', token }
      }
      this.coordinationMetrics.leaseBusy += 1
      return { status: 'BUSY' }
    } catch (error) {
      this.coordinationMetrics.leaseUnavailable += 1
      this.logError(error)
      return { status: 'UNAVAILABLE' }
    }
  }

  async renewLease(key: string, token: string, ttlMs: number): Promise<boolean | null> {
    if (!this.client || this.client.status !== 'ready') {
      this.coordinationMetrics.renewFailures += 1
      return null
    }
    try {
      const result = await this.client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        key,
        token,
        String(ttlMs),
      )
      const renewed = Number(result) === 1
      if (!renewed) this.coordinationMetrics.renewFailures += 1
      return renewed
    } catch (error) {
      this.coordinationMetrics.renewFailures += 1
      this.logError(error)
      return null
    }
  }

  async releaseLease(key: string, token: string): Promise<boolean | null> {
    if (!this.client || this.client.status !== 'ready') {
      this.coordinationMetrics.releaseFailures += 1
      return null
    }
    try {
      const result = await this.client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      )
      const released = Number(result) === 1
      if (!released) this.coordinationMetrics.releaseFailures += 1
      return released
    } catch (error) {
      this.coordinationMetrics.releaseFailures += 1
      this.logError(error)
      return null
    }
  }

  async claimOnce(key: string, ttlMs: number): Promise<RedisCoordinationAcquireResult> {
    if (!this.client || this.client.status !== 'ready') {
      this.coordinationMetrics.slotUnavailable += 1
      return { status: 'UNAVAILABLE' }
    }
    const token = randomUUID()
    try {
      const result = await this.client.set(key, token, 'PX', ttlMs, 'NX')
      if (result === 'OK') {
        this.coordinationMetrics.slotAcquired += 1
        return { status: 'ACQUIRED', token }
      }
      this.coordinationMetrics.slotBusy += 1
      return { status: 'BUSY' }
    } catch (error) {
      this.coordinationMetrics.slotUnavailable += 1
      this.logError(error)
      return { status: 'UNAVAILABLE' }
    }
  }

  async publish(channel: string, payload: string): Promise<number | null> {
    this.pubSubMetrics.publishAttempts += 1
    if (!this.client || this.client.status !== 'ready') {
      this.pubSubMetrics.publishFailures += 1
      return null
    }
    try {
      const delivered = await this.client.publish(this.eventChannel(channel), payload)
      this.pubSubMetrics.publishedMessages += 1
      this.pubSubMetrics.deliveredSubscriptions += delivered
      return delivered
    } catch (error) {
      this.pubSubMetrics.publishFailures += 1
      this.logError(error)
      return null
    }
  }

  async subscribe(
    channel: string,
    handler: RedisMessageHandler,
  ): Promise<() => Promise<void>> {
    if (!this.client) return async () => undefined
    const fullChannel = this.eventChannel(channel)
    const handlers = this.channelHandlers.get(fullChannel) ?? new Set<RedisMessageHandler>()
    handlers.add(handler)
    this.channelHandlers.set(fullChannel, handlers)

    const subscriber = this.ensureSubscriber()
    if (subscriber?.status === 'ready') await this.subscribeChannel(fullChannel)

    return async () => {
      const current = this.channelHandlers.get(fullChannel)
      if (!current) return
      current.delete(handler)
      if (current.size > 0) return
      this.channelHandlers.delete(fullChannel)
      this.subscribedChannels.delete(fullChannel)
      if (this.subscriber?.status !== 'ready') return
      try {
        await this.subscriber.unsubscribe(fullChannel)
      } catch (error) {
        this.pubSubMetrics.subscribeErrors += 1
        this.logError(error)
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.closeClient(this.subscriber)
    await this.closeClient(this.client)
  }

  private ensureSubscriber(): Redis | null {
    if (!this.client) return null
    if (this.subscriber) return this.subscriber
    const subscriber = this.client.duplicate({ enableOfflineQueue: false })
    subscriber.on('ready', () => {
      this.logger.log('Redis Pub/Sub 订阅连接已就绪')
      this.subscribedChannels.clear()
      void this.resubscribeChannels()
    })
    subscriber.on('close', () => this.subscribedChannels.clear())
    subscriber.on('error', (error) => this.logError(error))
    subscriber.on('message', (channel, message) => this.dispatchMessage(channel, message))
    this.subscriber = subscriber
    return subscriber
  }

  private async resubscribeChannels(): Promise<void> {
    for (const channel of this.channelHandlers.keys()) await this.subscribeChannel(channel)
  }

  private async subscribeChannel(channel: string): Promise<void> {
    if (!this.subscriber || this.subscriber.status !== 'ready' || this.subscribedChannels.has(channel))
      return
    try {
      await this.subscriber.subscribe(channel)
      this.subscribedChannels.add(channel)
    } catch (error) {
      this.pubSubMetrics.subscribeErrors += 1
      this.logError(error)
    }
  }

  private dispatchMessage(channel: string, message: string): void {
    this.pubSubMetrics.receivedMessages += 1
    const handlers = this.channelHandlers.get(channel)
    if (!handlers?.size) {
      this.pubSubMetrics.unhandledMessages += 1
      return
    }
    for (const handler of handlers) {
      Promise.resolve(handler(message)).catch((error) => {
        this.pubSubMetrics.handlerErrors += 1
        this.logError(error)
      })
    }
  }

  private eventChannel(channel: string): string {
    return `${REDIS_EVENT_CHANNEL_PREFIX}${channel}`
  }

  private async closeClient(client: Redis | null): Promise<void> {
    if (!client) return
    try {
      if (client.status !== 'end') await client.quit()
    } catch {
      client.disconnect(false)
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
