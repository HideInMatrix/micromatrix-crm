/**
 * Shared, bounded execution queue for one application process. A delivery must
 * already be persisted before submission. Overflow is deliberately left in the
 * database for the existing scheduled recovery; this queue is not the outbox.
 */
export class DeliveryExecutor {
  private readonly pending: Array<{
    id: string
    resolve: () => void
    reject: (error: unknown) => void
  }> = []
  private readonly outstanding = new Map<string, Promise<void>>()
  private active = 0

  constructor(
    private readonly processOne: (id: string) => Promise<void>,
    private readonly concurrency: number,
    private readonly maxOutstanding: number,
  ) {
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      !Number.isInteger(maxOutstanding) ||
      maxOutstanding < concurrency
    ) {
      throw new RangeError('Invalid delivery executor limits')
    }
  }

  async run(ids: readonly string[]): Promise<{ accepted: number; deferred: number }> {
    const tasks: Promise<void>[] = []
    let deferred = 0
    for (const id of new Set(ids)) {
      const existing = this.outstanding.get(id)
      if (existing) {
        tasks.push(existing)
        continue
      }
      if (this.outstanding.size >= this.maxOutstanding) {
        deferred++
        continue
      }
      let resolve!: () => void
      let reject!: (error: unknown) => void
      const task = new Promise<void>((done, fail) => {
        resolve = done
        reject = fail
      })
      this.outstanding.set(id, task)
      this.pending.push({ id, resolve, reject })
      tasks.push(task)
    }

    // Register rejection handlers before starting any workers.
    const settled = Promise.allSettled(tasks)
    this.pump()
    const errors = (await settled).flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (errors.length) throw new AggregateError(errors, 'Message delivery processing failed')
    return { accepted: tasks.length, deferred }
  }

  snapshot() {
    return { active: this.active, pending: this.pending.length, outstanding: this.outstanding.size }
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length) {
      const task = this.pending.shift()!
      this.active++
      void this.execute(task)
    }
  }

  private async execute(task: (typeof this.pending)[number]): Promise<void> {
    // Yield before invoking the worker, so even a synchronous failure cannot
    // recursively drain the queue in the current stack.
    await Promise.resolve()
    try {
      await this.processOne(task.id)
      task.resolve()
    } catch (error) {
      task.reject(error)
    } finally {
      this.outstanding.delete(task.id)
      this.active--
      this.pump()
    }
  }
}
