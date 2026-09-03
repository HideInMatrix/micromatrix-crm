import { Injectable, Logger, ServiceUnavailableException, type OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue, Worker, type ConnectionOptions, type Processor } from 'bullmq'
import Redis, { type RedisOptions } from 'ioredis'

export interface ExportJobData {
  taskId: string
}

interface AsyncJobMetrics {
  enqueueAttempts: number
  enqueued: number
  enqueueFailures: number
  recovered: number
  recoveryKept: number
  cancelAttempts: number
  canceledQueuedJobs: number
  workerStarted: number
  workerActive: number
  workerCompleted: number
  workerFailed: number
}

const QUEUE_NAME = 'export'
const QUEUE_PREFIX = 'micromatrix-crm:bull'

@Injectable()
export class AsyncJobsService implements OnApplicationShutdown {
  private readonly logger = new Logger(AsyncJobsService.name)
  private readonly configured: boolean
  private queue: Queue<ExportJobData> | null = null
  private producerRedis: Redis | null = null
  private queueInit: Promise<Queue<ExportJobData>> | null = null
  private worker: Worker<ExportJobData> | null = null
  private readonly metrics: AsyncJobMetrics = {
    enqueueAttempts: 0,
    enqueued: 0,
    enqueueFailures: 0,
    recovered: 0,
    recoveryKept: 0,
    cancelAttempts: 0,
    canceledQueuedJobs: 0,
    workerStarted: 0,
    workerActive: 0,
    workerCompleted: 0,
    workerFailed: 0,
  }

  constructor(private readonly config: ConfigService) {
    this.configured = this.hasRedisConfig()
    if (!this.configured) {
      this.logger.log('BullMQ 未配置 Redis，异步导出 producer 保持关闭')
    }
  }

  get enabled(): boolean {
    return this.configured
  }

  async snapshot() {
    const base = {
      enabled: this.enabled,
      localWorkerRunning: this.worker?.isRunning() ?? false,
      ...this.metrics,
    }
    if (!this.enabled) {
      return {
        ...base,
        queue: { ready: false, workers: 0, waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
      }
    }
    try {
      const queue = await this.readyQueue()
      const [workers, counts] = await Promise.all([
        queue.getWorkersCount(),
        queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
      ])
      return {
        ...base,
        queue: {
          ready: true,
          workers,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
        },
      }
    } catch {
      await this.resetProducer()
      return {
        ...base,
        queue: { ready: false, workers: 0, waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
      }
    }
  }

  async enqueueExport(taskId: string): Promise<void> {
    this.metrics.enqueueAttempts += 1
    if (!this.enabled) {
      this.metrics.enqueueFailures += 1
      throw new ServiceUnavailableException('异步导出队列未配置，请联系管理员')
    }
    try {
      const queue = await this.readyQueue()
      await queue.add('build-xlsx', { taskId }, { jobId: taskId })
      this.metrics.enqueued += 1
    } catch (error) {
      this.metrics.enqueueFailures += 1
      await this.resetProducer()
      this.logger.warn(`BullMQ export enqueue failed task=${taskId}: ${this.message(error)}`)
      throw new ServiceUnavailableException('异步导出队列暂不可用，请稍后重试')
    }
  }

  async ensureExportJob(taskId: string): Promise<'RECOVERED' | 'KEPT'> {
    if (!this.enabled) throw new ServiceUnavailableException('异步导出队列未配置，请联系管理员')
    const queue = await this.readyQueue()
    const existing = await queue.getJob(taskId)
    if (existing) {
      const state = await existing.getState()
      if (['waiting', 'delayed', 'active', 'prioritized', 'waiting-children'].includes(state)) {
        this.metrics.recoveryKept += 1
        return 'KEPT'
      }
      await existing.remove().catch(() => undefined)
    }
    await this.enqueueExport(taskId)
    this.metrics.recovered += 1
    return 'RECOVERED'
  }

  async cancelExportJob(taskId: string): Promise<void> {
    this.metrics.cancelAttempts += 1
    if (!this.enabled) return
    try {
      const queue = await this.readyQueue()
      const job = await queue.getJob(taskId)
      if (!job) return
      const state = await job.getState()
      if (state === 'active') return
      await job.remove()
      this.metrics.canceledQueuedJobs += 1
    } catch (error) {
      await this.resetProducer()
      this.logger.warn(`BullMQ cancel best-effort failed task=${taskId}: ${this.message(error)}`)
    }
  }

  startExportWorker(processor: Processor<ExportJobData>): Worker<ExportJobData> {
    if (this.worker) return this.worker
    if (!this.hasRedisConfig()) throw new Error('BullMQ worker 无 Redis 配置')
    this.worker = new Worker<ExportJobData>(QUEUE_NAME, processor, {
      connection: this.connection(true),
      prefix: QUEUE_PREFIX,
      concurrency: this.positiveInt('ASYNC_EXPORT_CONCURRENCY', 2),
      maxStalledCount: 1,
    })
    this.metrics.workerStarted += 1
    this.worker.on('active', () => (this.metrics.workerActive += 1))
    this.worker.on('completed', () => (this.metrics.workerCompleted += 1))
    this.worker.on('failed', (job, error) => {
      this.metrics.workerFailed += 1
      this.logger.warn(`BullMQ export worker failed task=${job?.data.taskId ?? '-'}: ${error.message}`)
    })
    this.worker.on('error', (error) => this.logger.warn(`BullMQ worker error: ${error.message}`))
    return this.worker
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined)
    await this.resetProducer()
  }

  private hasRedisConfig(): boolean {
    return Boolean(this.config.get<string>('REDIS_URL')?.trim() || this.config.get<string>('REDIS_HOST')?.trim())
  }

  private connection(worker: boolean): ConnectionOptions {
    const url = this.config.get<string>('REDIS_URL')?.trim()
    const base = {
      ...(url ? { url } : {
        host: this.config.get<string>('REDIS_HOST')?.trim(),
        port: this.positiveInt('REDIS_PORT', 6379),
        password: this.config.get<string>('REDIS_PASSWORD') || undefined,
        db: this.nonNegativeInt('REDIS_DB', 0),
      }),
      connectTimeout: 1_500,
      maxRetriesPerRequest: worker ? null : 1,
    }
    return base
  }

  private producerConnectionOptions(): RedisOptions {
    return {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_500,
      retryStrategy: () => null,
    }
  }

  private createProducerRedis(): Redis {
    const url = this.config.get<string>('REDIS_URL')?.trim()
    const common = this.producerConnectionOptions()
    if (url) return new Redis(url, common)
    return new Redis({
      ...common,
      host: this.config.get<string>('REDIS_HOST')?.trim(),
      port: this.positiveInt('REDIS_PORT', 6379),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db: this.nonNegativeInt('REDIS_DB', 0),
    })
  }

  private async readyQueue(): Promise<Queue<ExportJobData>> {
    if (!this.enabled) throw new Error('BullMQ export queue is disabled')
    if (this.queue && this.producerRedis?.status === 'ready') return this.queue
    if (this.queue || this.producerRedis) await this.resetProducer()
    if (!this.queueInit) this.queueInit = this.initializeQueue()
    try {
      return await this.queueInit
    } finally {
      this.queueInit = null
    }
  }

  private async initializeQueue(): Promise<Queue<ExportJobData>> {
    const redis = this.createProducerRedis()
    redis.on('error', (error) => this.logger.warn(`BullMQ producer Redis error: ${error.message}`))
    const timeoutMs = this.positiveInt('ASYNC_EXPORT_QUEUE_READY_TIMEOUT_MS', 1_500)
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        redis.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`BullMQ producer connect timeout after ${timeoutMs}ms`)), timeoutMs)
        }),
      ])
      const queue = new Queue<ExportJobData>(QUEUE_NAME, {
        connection: redis,
        prefix: QUEUE_PREFIX,
        skipWaitingForReady: true,
        skipMetasUpdate: true,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 24 * 60 * 60, count: 2_000 },
          removeOnFail: { age: 24 * 60 * 60, count: 2_000 },
        },
      })
      queue.on('error', (error) => this.logger.warn(`BullMQ producer error: ${error.message}`))
      this.producerRedis = redis
      this.queue = queue
      return queue
    } catch (error) {
      redis.disconnect(false)
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async resetProducer(): Promise<void> {
    const queue = this.queue
    const redis = this.producerRedis
    this.queue = null
    this.producerRedis = null
    await queue?.close().catch(() => undefined)
    if (redis && redis.status !== 'end') redis.disconnect(false)
  }

  private positiveInt(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key))
    return Number.isInteger(value) && value > 0 ? value : fallback
  }

  private nonNegativeInt(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key))
    return Number.isInteger(value) && value >= 0 ? value : fallback
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
