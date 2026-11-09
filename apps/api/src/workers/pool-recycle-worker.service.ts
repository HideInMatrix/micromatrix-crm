import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import type { Job } from 'bullmq'
import { AsyncJobsService, type PoolRecycleJobData } from '../async-jobs/async-jobs.service'
import { PoolRecycleService } from '../modules/pool-rules/pool-recycle.service'
import { PoolRecycleTaskService } from '../modules/pool-rules/pool-recycle-task.service'

@Injectable()
export class PoolRecycleWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PoolRecycleWorkerService.name)
  private dispatching = false

  constructor(
    private readonly jobs: AsyncJobsService,
    private readonly tasks: PoolRecycleTaskService,
    private readonly recycle: PoolRecycleService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.jobs.startPoolRecycleWorker((job) => this.process(job))
    const backfill = await this.tasks.backfillMissingPlans()
    const recovery = await this.tasks.recoverOutstanding()
    this.logger.log(
      `自动回收 Worker 已启动 backfillLeads=${backfill.leads} backfillCustomers=${backfill.customers} recovered=${recovery.recovered} kept=${recovery.kept} failed=${recovery.failed}`,
    )
  }

  @Interval(5_000)
  async dispatchOutbox(): Promise<void> {
    if (this.dispatching || !this.jobs.enabled) return
    this.dispatching = true
    try {
      const result = await this.tasks.dispatchPending()
      if (result.failed) {
        this.logger.warn(`自动回收 Outbox 投递失败 count=${result.failed}`)
      }
    } catch (error) {
      this.logger.warn(
        `自动回收 Outbox 扫描失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      this.dispatching = false
    }
  }

  private async process(job: Job<PoolRecycleJobData>): Promise<void> {
    const task = await this.tasks.beginTask(job.data.taskId, job.data.generation)
    if (!task) return
    try {
      await this.recycle.processScheduledTask(task)
      await this.tasks.completeTask(task.id, task.generation)
    } catch (error) {
      const attempts = Number(job.opts.attempts ?? 1)
      const finalAttempt = job.attemptsMade + 1 >= attempts
      await this.tasks.failAttempt(
        task.id,
        task.generation,
        error,
        finalAttempt,
        job.attemptsMade + 1,
      )
      throw error
    }
  }
}
